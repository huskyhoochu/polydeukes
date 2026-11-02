//! Finds sections by the query's terms and ranks them with one bm25 formula over 2,000-character
//! chunks.

use std::cmp::Ordering;
use std::collections::HashMap;

use serde_json::{Value, json};

use crate::config::Settings;
use crate::corpus::{Corpus, Doc, Section};
use crate::expand;
use crate::log::now_millis;
use crate::normalize::{has_hangul, is_js_space, normalize_query, query_words};
use crate::output::pairs;

const MAX_CHUNK: usize = 2000;
const K1: f64 = 1.2;
const B: f64 = 0.75;
const IDF_FLOOR: f64 = 1e-6;
const PROXIMITY_ALPHA: f64 = 0.3;

pub struct Hit {
    pub id: String,
    pub concept_id: String,
    pub doc_title: String,
    pub section_title: String,
    pub status: String,
    pub trust: &'static str,
    pub stale: bool,
    pub match_path: &'static str,
    pub superseded_by: Vec<String>,
}

impl Hit {
    pub fn json(&self) -> Value {
        json!({
            "id": self.id,
            "conceptId": self.concept_id,
            "docTitle": self.doc_title,
            "sectionTitle": self.section_title,
            "status": self.status,
            "trust": self.trust,
            "stale": self.stale,
            "matchPath": self.match_path,
            "supersededBy": self.superseded_by,
        })
    }
}

fn as_f64(count: usize) -> f64 {
    f64::from(u32::try_from(count).unwrap_or(u32::MAX))
}

/// The offsets just after each separator of the level found inside `chars[start..end]`: blank
/// lines, then line breaks, then whitespace runs.
fn cuts(chars: &[char], start: usize, end: usize, level: usize) -> Vec<usize> {
    let mut found = Vec::new();
    let mut at = start;
    while at < end {
        let here = chars.get(at).copied().unwrap_or_default();
        let mut next = at + 1;
        match level {
            0 if here == '\n' => {
                let mut blank = next;
                while blank < end && matches!(chars.get(blank), Some(' ' | '\t')) {
                    blank += 1;
                }
                if blank < end && chars.get(blank) == Some(&'\n') {
                    found.push(blank + 1);
                    next = blank + 1;
                }
            }
            1 if here == '\n' => found.push(next),
            2 if is_js_space(here) => {
                while next < end && chars.get(next).copied().is_some_and(is_js_space) {
                    next += 1;
                }
                found.push(next);
            }
            _ => {}
        }
        at = next;
    }
    found
}

/// Splits `chars[start..end]` into spans of at most 2,000 characters, cutting after a separator
/// and packing pieces greedily. A piece over the limit is re-split at the next level and its parts
/// are packed among themselves only; a run with no whitespace stays whole.
fn place(chars: &[char], start: usize, end: usize, level: usize, spans: &mut Vec<(usize, usize)>) {
    if end - start <= MAX_CHUNK || level > 2 {
        spans.push((start, end));
        return;
    }
    let mut edges = cuts(chars, start, end, level);
    if edges.last() != Some(&end) {
        edges.push(end);
    }
    let mut from = start;
    let mut packed = start;
    for cut in edges {
        if packed > from && cut - from > MAX_CHUNK {
            place(chars, from, packed, level + 1, spans);
            from = packed;
        }
        packed = cut;
    }
    place(chars, from, packed, level + 1, spans);
}

/// One passage of a section body, its ASCII-lowercased text and its trigram count.
struct Chunk {
    text: String,
    len: usize,
}

/// One section with the lowercased fields a term is looked up in.
struct Entry<'a> {
    doc: &'a Doc,
    section: &'a Section,
    id: String,
    concept: String,
    doc_title: String,
    title: String,
    chunks: Vec<Chunk>,
}

fn trigrams(text: &str) -> usize {
    text.chars().count().saturating_sub(2)
}

fn entries(corpus: &Corpus) -> Vec<Entry<'_>> {
    let mut found = Vec::new();
    for doc in &corpus.docs {
        for section in &doc.sections {
            // The newline that ends a body's last line is a terminator, not text to measure.
            let body = section.body.strip_suffix('\n').unwrap_or(&section.body);
            let chars: Vec<char> = body.chars().collect();
            let mut spans = Vec::new();
            place(&chars, 0, chars.len(), 0, &mut spans);
            let titles = trigrams(&doc.title) + trigrams(&section.title);
            let chunks = spans
                .into_iter()
                .map(|(start, end)| {
                    let text: String = chars.get(start..end).unwrap_or_default().iter().collect();
                    Chunk {
                        len: titles + trigrams(&text),
                        text: text.to_ascii_lowercase(),
                    }
                })
                .collect();
            found.push(Entry {
                doc,
                section,
                id: section.id.to_ascii_lowercase(),
                concept: doc.id.to_ascii_lowercase(),
                doc_title: doc.title.to_ascii_lowercase(),
                title: section.title.to_ascii_lowercase(),
                chunks,
            });
        }
    }
    found
}

/// What one term matched: its bm25 score in each chunk it is in, and the sections whose id it
/// starts.
struct TermMatch {
    scores: Vec<Vec<Option<f64>>>,
    by_id: Vec<bool>,
}

impl TermMatch {
    fn in_text(&self, entry: usize) -> bool {
        self.scores
            .get(entry)
            .is_some_and(|chunks| chunks.iter().any(Option::is_some))
    }

    fn by_id(&self, entry: usize) -> bool {
        self.by_id.get(entry).copied().unwrap_or_default()
    }
}

fn term_match(entries: &[Entry], total: f64, avglen: f64, term: &str) -> TermMatch {
    let lower = term.to_ascii_lowercase();
    let counts: Vec<Vec<usize>> = entries
        .iter()
        .map(|entry| {
            let titles =
                2 * (entry.doc_title.matches(&lower).count() + entry.title.matches(&lower).count());
            entry
                .chunks
                .iter()
                .map(|chunk| titles + chunk.text.matches(&lower).count())
                .collect()
        })
        .collect();
    let matched = as_f64(counts.iter().flatten().filter(|count| **count > 0).count());
    let raw_idf = ((total - matched + 0.5) / (matched + 0.5)).ln();
    let idf = if raw_idf <= 0.0 { IDF_FLOOR } else { raw_idf };
    let scores = entries
        .iter()
        .zip(&counts)
        .map(|(entry, counts)| {
            entry
                .chunks
                .iter()
                .zip(counts)
                .map(|(chunk, count)| {
                    if *count == 0 {
                        return None;
                    }
                    let tf = as_f64(*count);
                    let ratio = if avglen > 0.0 {
                        as_f64(chunk.len) / avglen
                    } else {
                        0.0
                    };
                    Some(-idf * tf * (K1 + 1.0) / (tf + K1 * (1.0 - B + B * ratio)))
                })
                .collect()
        })
        .collect();
    let by_id = entries
        .iter()
        .map(|entry| entry.id.starts_with(&lower) || entry.concept.starts_with(&lower))
        .collect();
    TermMatch { scores, by_id }
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn trust_of(doc: &Doc) -> &'static str {
    let verified = doc.metadata.get("verified");
    let entries: Vec<&Value> = match verified {
        Some(Value::Array(items)) => items.iter().collect(),
        Some(value) if truthy(value) => vec![value],
        _ => Vec::new(),
    };
    let mut machine = false;
    for entry in entries {
        let Some(by) = entry.get("by").and_then(Value::as_str) else {
            continue;
        };
        if by.trim().is_empty() {
            continue;
        }
        if by.starts_with("human:") {
            return "human-reviewed";
        }
        machine = true;
    }
    if machine {
        "machine-verified"
    } else {
        "unverified"
    }
}

fn digits(text: &str, len: usize) -> Option<i64> {
    (text.len() == len && text.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| text.parse().ok())
        .flatten()
}

/// Days from 1970-01-01 to a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let of_day = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    era * 146_097 + of_day - 719_468
}

fn days_in_month(year: i64, month: i64) -> i64 {
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// The milliseconds since the epoch of `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM[:SS[.sss]]` followed by
/// `Z` or `±HH:MM`. A date alone and a time with no zone read as UTC.
fn iso_millis(text: &str) -> Option<i64> {
    let (date, time) = match text.split_once('T') {
        Some((date, time)) => (date, Some(time)),
        None => (text, None),
    };
    let mut parts = date.split('-');
    let (year, month, day) = (
        digits(parts.next()?, 4)?,
        digits(parts.next()?, 2)?,
        digits(parts.next()?, 2)?,
    );
    if parts.next().is_some()
        || !(1..=12).contains(&month)
        || !(1..=days_in_month(year, month)).contains(&day)
    {
        return None;
    }
    let midnight = days_from_civil(year, month, day) * 86_400_000;
    let Some(time) = time else {
        return Some(midnight);
    };
    let (clock, offset) = match time.find(['+', '-', 'Z']) {
        Some(at) => (time.get(..at)?, time.get(at..)?),
        None => (time, ""),
    };
    let offset_minutes = match offset {
        "" | "Z" => 0,
        zone => {
            let sign = if zone.starts_with('-') { -1 } else { 1 };
            let (hours, minutes) = zone.get(1..)?.split_once(':')?;
            let (hours, minutes) = (digits(hours, 2)?, digits(minutes, 2)?);
            if hours > 23 || minutes > 59 {
                return None;
            }
            sign * (hours * 60 + minutes)
        }
    };
    let mut fields = clock.split(':');
    let hours = digits(fields.next()?, 2)?;
    let minutes = digits(fields.next()?, 2)?;
    let (seconds, millis) = match fields.next() {
        None => (0, 0),
        Some(field) => match field.split_once('.') {
            None => (digits(field, 2)?, 0),
            Some((whole, fraction)) => {
                let kept: String = fraction.chars().take(3).collect();
                let padded = format!("{kept:0<3}");
                (
                    digits(whole, 2)?,
                    digits(&padded, 3).filter(|_| digits(fraction, fraction.len()).is_some())?,
                )
            }
        },
    };
    if fields.next().is_some() || hours > 23 || minutes > 59 || seconds > 59 {
        return None;
    }
    Some(midnight + ((hours * 60 + minutes - offset_minutes) * 60 + seconds) * 1000 + millis)
}

fn is_stale(doc: &Doc, now: i64) -> bool {
    doc.metadata
        .get("stale_after")
        .and_then(Value::as_str)
        .and_then(iso_millis)
        .is_some_and(|at| at <= now)
}

/// The terms to search, and whether they are the query's own words (searched as written,
/// where sections holding more of them rank first).
fn query_terms(query: &str) -> (Vec<String>, bool) {
    let words = query_words(query);
    let mut raw: Vec<String> = Vec::new();
    for word in &words {
        if !raw.iter().any(|seen| seen == word) {
            raw.push((*word).to_string());
        }
    }
    let normalized = normalize_query(query);
    let literal = normalized.is_empty()
        || (normalized.len() == words.len()
            && normalized
                .iter()
                .zip(&words)
                .all(|(term, word)| term == word));
    if literal {
        (raw, true)
    } else {
        (normalized, false)
    }
}

struct Ranked<'a> {
    entry: usize,
    match_path: &'static str,
    status: &'a str,
    retired: bool,
    matched: usize,
    score: f64,
}

fn rank(a: &Ranked, b: &Ranked, entries: &[Entry]) -> Ordering {
    let id = |ranked: &Ranked| {
        entries
            .get(ranked.entry)
            .map(|entry| entry.section.id.as_str())
    };
    a.retired
        .cmp(&b.retired)
        .then_with(|| b.matched.cmp(&a.matched))
        .then_with(|| a.score.partial_cmp(&b.score).unwrap_or(Ordering::Equal))
        .then_with(|| id(a).cmp(&id(b)))
}

/// How much a chunk's score is lowered for its two different terms sitting `δ` words apart
/// (Tao & Zhai's `MinDist`, `ln(α + e^-δ)`). `ln α` is subtracted so that a chunk whose terms are
/// far apart is lowered by nothing.
fn proximity(text: &str, terms: &[Vec<String>]) -> f64 {
    let mut last: Vec<Option<usize>> = vec![None; terms.len()];
    let mut nearest: Option<usize> = None;
    for (at, word) in text.split_whitespace().enumerate() {
        let here: Vec<usize> = terms
            .iter()
            .enumerate()
            .filter(|(_, group)| group.iter().any(|term| word.contains(term.as_str())))
            .map(|(k, _)| k)
            .collect();
        if here.len() >= 2 {
            nearest = Some(0);
        }
        for &k in &here {
            for (other, seen) in last.iter().enumerate() {
                if other != k
                    && let Some(from) = seen
                {
                    let gap = at - from;
                    nearest = Some(nearest.map_or(gap, |best| best.min(gap)));
                }
            }
        }
        for &k in &here {
            if let Some(slot) = last.get_mut(k) {
                *slot = Some(at);
            }
        }
    }
    nearest.map_or(0.0, |gap| {
        (PROXIMITY_ALPHA + (-as_f64(gap)).exp()).ln() - PROXIMITY_ALPHA.ln()
    })
}

/// The lowest score among an entry's chunks that hold a matched term, with the proximity lowering
/// applied to chunks holding at least two.
fn best_chunk(
    entry: &Entry,
    index: usize,
    matches: &[Vec<TermMatch>],
    lowered: &[Vec<String>],
) -> f64 {
    entry
        .chunks
        .iter()
        .enumerate()
        .filter_map(|(chunk, body)| {
            let scores: Vec<f64> = matches
                .iter()
                .filter_map(|group| {
                    group
                        .iter()
                        .filter_map(|term| term.scores.get(index)?.get(chunk).copied().flatten())
                        .reduce(f64::min)
                })
                .collect();
            (!scores.is_empty()).then(|| {
                let sum = scores.iter().sum::<f64>();
                if scores.len() < 2 {
                    sum
                } else {
                    sum - proximity(&body.text, lowered)
                }
            })
        })
        .reduce(f64::min)
        .unwrap_or_default()
}

fn group_matches(
    entries: &[Entry],
    total: f64,
    avglen: f64,
    groups: &[Vec<String>],
) -> (Vec<Vec<String>>, Vec<Vec<TermMatch>>) {
    let lowered = groups
        .iter()
        .map(|group| group.iter().map(|term| term.to_ascii_lowercase()).collect())
        .collect();
    let matches = groups
        .iter()
        .map(|group| {
            group
                .iter()
                .map(|term| term_match(entries, total, avglen, term))
                .collect()
        })
        .collect();
    (lowered, matches)
}

/// The sections that match, best first, at most `limit` of them.
pub fn find(corpus: &Corpus, settings: &Settings, query: &str, limit: usize) -> Vec<Hit> {
    if query_words(query).is_empty() {
        return Vec::new();
    }
    let entries = entries(corpus);
    let total = as_f64(entries.iter().map(|entry| entry.chunks.len()).sum());
    if entries.is_empty() {
        return Vec::new();
    }
    let avglen = as_f64(
        entries
            .iter()
            .flat_map(|entry| entry.chunks.iter().map(|chunk| chunk.len))
            .sum(),
    ) / total;
    let (terms, literal) = query_terms(query);
    let groups = if has_hangul(query) {
        terms.into_iter().map(|term| vec![term]).collect()
    } else {
        expand::groups(corpus, terms)
    };
    let (lowered, matches) = group_matches(&entries, total, avglen, &groups);

    let mut superseded_by: HashMap<&str, Vec<String>> = HashMap::new();
    let pairs = pairs(corpus, false);
    for (newer, older) in &pairs {
        superseded_by
            .entry(older.as_str())
            .or_default()
            .push(newer.clone());
    }

    let mut ranked: Vec<Ranked> = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let hits = matches
            .iter()
            .filter(|group| {
                group
                    .iter()
                    .any(|term| term.in_text(index) || term.by_id(index))
            })
            .count();
        if hits == 0 {
            continue;
        }
        let id_only = matches.iter().any(|group| {
            group.iter().any(|term| term.by_id(index))
                && !group.iter().any(|term| term.in_text(index))
        });
        let match_path = if hits < groups.len() {
            "or"
        } else if id_only {
            "like"
        } else {
            "and"
        };
        let best = best_chunk(entry, index, &matches, &lowered);
        let weight = entry
            .doc
            .metadata
            .get("type")
            .and_then(Value::as_str)
            .map(|kind| settings.type_map.get(kind).map_or(kind, String::as_str))
            .and_then(|kind| settings.weights.get(kind))
            .copied()
            .unwrap_or_default();
        let status = status_of(entry.doc);
        ranked.push(Ranked {
            entry: index,
            match_path,
            status,
            retired: status == "deprecated" || superseded_by.contains_key(entry.doc.id.as_str()),
            matched: if literal { hits } else { 0 },
            score: best - weight,
        });
    }
    ranked.sort_by(|a, b| rank(a, b, &entries));
    let now = now_millis();
    ranked
        .iter()
        .take(limit)
        .filter_map(|row| {
            let entry = entries.get(row.entry)?;
            Some(Hit {
                id: entry.section.id.clone(),
                concept_id: entry.doc.id.clone(),
                doc_title: entry.doc.title.clone(),
                section_title: entry.section.title.clone(),
                status: row.status.to_string(),
                trust: trust_of(entry.doc),
                stale: is_stale(entry.doc, now),
                match_path: row.match_path,
                superseded_by: superseded_by
                    .get(entry.doc.id.as_str())
                    .cloned()
                    .unwrap_or_default(),
            })
        })
        .collect()
}

fn status_of(doc: &Doc) -> &str {
    doc.metadata
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("stable")
}
