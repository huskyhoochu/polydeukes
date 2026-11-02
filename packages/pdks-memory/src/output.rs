//! What each command answers, as text and as `--json`.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::LazyLock;

use regress::Regex;
use serde_json::{Value, json};

use crate::corpus::{Corpus, Doc, Link, Section};
use crate::parse::{constant, group, replace_all};
use crate::search::Hit;

fn line(value: &Value) -> String {
    format!("{value}\n")
}

fn lines(rows: &[String]) -> String {
    rows.iter().flat_map(|row| [row.as_str(), "\n"]).collect()
}

fn link_json(link: &Link) -> Value {
    json!({ "from": link.from, "target": link.written(), "to": link.to() })
}

fn sorted(mut links: Vec<&Link>) -> Vec<&Link> {
    links.sort_by_key(|link| (link.from.clone(), link.written()));
    links
}

struct Links<'a> {
    out: Vec<&'a Link>,
    into: Vec<&'a Link>,
}

impl Links<'_> {
    fn json(&self) -> Value {
        json!({
            "out": self.out.iter().map(|link| link_json(link)).collect::<Vec<_>>(),
            "in": self.into.iter().map(|link| link_json(link)).collect::<Vec<_>>(),
        })
    }

    /// The `## links` block, or nothing when no link leaves or arrives.
    fn block(&self) -> String {
        let rows: Vec<String> = self
            .out
            .iter()
            .map(|link| {
                format!(
                    "out  {}  {}  → {}",
                    link.from,
                    link.written(),
                    link.to().unwrap_or("unresolved")
                )
            })
            .chain(
                self.into
                    .iter()
                    .map(|link| format!("in  {}  → {}", link.from, link.to().unwrap_or_default())),
            )
            .collect();
        if rows.is_empty() {
            String::new()
        } else {
            format!("\n## links\n{}", lines(&rows))
        }
    }
}

/// A body without the blank lines that separated it from its heading.
fn trim_body(body: &str) -> &str {
    let mut rest = body;
    while let Some((first, tail)) = rest.split_once('\n')
        && first.chars().all(|c| c == ' ' || c == '\t')
    {
        rest = tail;
    }
    rest.trim_end()
}

static H1_LINE: LazyLock<Regex> = LazyLock::new(|| constant(r"^#[ \t]+(.*?)[ \t#]*$", ""));

/// The preamble row's body keeps the document's H1 line; when that line is the title the
/// rendered `# <title>` heading already shows, it is dropped.
fn shown_body<'a>(doc_title: &str, section_title: &str, body: &'a str) -> &'a str {
    let trimmed = trim_body(body);
    if !section_title.is_empty() {
        return trimmed;
    }
    let (first, rest) = trimmed.split_once('\n').unwrap_or((trimmed, ""));
    match H1_LINE.find(first) {
        Some(found) if group(&found, first, 1) == Some(doc_title) => trim_body(rest),
        _ => trimmed,
    }
}

fn title_of(doc_title: &str, section_title: &str) -> String {
    if section_title.is_empty() {
        doc_title.to_string()
    } else {
        format!("{doc_title} › {section_title}")
    }
}

fn find_section<'a>(corpus: &'a Corpus, id: &str) -> Option<(&'a Doc, &'a Section)> {
    corpus.docs.iter().find_map(|doc| {
        doc.sections
            .iter()
            .find(|section| section.id == id)
            .map(|section| (doc, section))
    })
}

/// The document or section with exactly this id; a document wins over a section.
pub fn show(corpus: &Corpus, id: &str, json: bool) -> Option<String> {
    if let Some(doc) = corpus.docs.iter().find(|doc| doc.id == id) {
        let links = Links {
            out: sorted(corpus.links.iter().filter(|l| l.doc == doc.id).collect()),
            into: sorted(
                corpus
                    .links
                    .iter()
                    .filter(|l| l.dst_doc.as_deref() == Some(id))
                    .collect(),
            ),
        };
        let related = corpus.related(doc);
        if json {
            let sections: Vec<Value> = doc
                .sections
                .iter()
                .map(|s| json!({ "id": s.id, "ord": s.ord, "title": s.title, "body": s.body }))
                .collect();
            return Some(line(&json!({
                "id": doc.id,
                "title": doc.title,
                "metadata": doc.metadata,
                "sections": sections,
                "links": links.json(),
                "related": related,
            })));
        }
        let blocks = doc.sections.iter().filter_map(|section| {
            let heading = if section.title.is_empty() {
                String::new()
            } else {
                format!("## {}", section.title)
            };
            let body = shown_body(&doc.title, &section.title, &section.body);
            let block = [heading.as_str(), body]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
            (!block.is_empty()).then_some(block)
        });
        let text = std::iter::once(format!("# {}", doc.title))
            .chain(blocks)
            .collect::<Vec<_>>()
            .join("\n\n");
        let related_block = if related.is_empty() {
            String::new()
        } else {
            let rows: Vec<String> = related.iter().map(ToString::to_string).collect();
            format!("\n## related\n{}", lines(&rows))
        };
        return Some(format!("{text}\n{}{related_block}", links.block()));
    }
    let (doc, section) = find_section(corpus, id)?;
    let links = Links {
        out: sorted(corpus.links.iter().filter(|l| l.from == id).collect()),
        into: sorted(
            corpus
                .links
                .iter()
                .filter(|l| l.dst_section.as_deref() == Some(id))
                .collect(),
        ),
    };
    if json {
        return Some(line(&json!({
            "id": section.id,
            "conceptId": doc.id,
            "docTitle": doc.title,
            "sectionTitle": section.title,
            "body": section.body,
            "ord": section.ord,
            "links": links.json(),
        })));
    }
    let body = shown_body(&doc.title, &section.title, &section.body);
    Some(format!(
        "# {}\n\n{body}\n{}",
        title_of(&doc.title, &section.title),
        links.block()
    ))
}

/// The ranked hits: one tab-separated line each, or `{"results":[…]}`.
pub fn search(hits: &[Hit], json: bool) -> String {
    if json {
        let results: Vec<Value> = hits.iter().map(Hit::json).collect();
        return line(&json!({ "results": results }));
    }
    let rows: Vec<String> = hits
        .iter()
        .map(|hit| {
            let stale = if hit.stale {
                format!("{}, stale", hit.status)
            } else {
                hit.status.clone()
            };
            let status = if hit.superseded_by.is_empty() {
                stale
            } else {
                format!("{stale}, superseded by {}", hit.superseded_by.join(" "))
            };
            [
                hit.id.as_str(),
                hit.match_path,
                status.as_str(),
                hit.trust,
                title_of(&hit.doc_title, &hit.section_title).as_str(),
            ]
            .join("\t")
        })
        .collect();
    lines(&rows)
}

/// The obligations filed under `key` and the section ids they came from, in section id then
/// position order.
pub fn obligations(corpus: &Corpus, key: &str, json: bool) -> (String, Vec<String>) {
    let mut rows: Vec<_> = corpus.obligations.iter().filter(|o| o.key == key).collect();
    rows.sort_by(|a, b| (&a.section_id, a.ord).cmp(&(&b.section_id, b.ord)));
    let ids = rows.iter().map(|row| row.section_id.clone()).collect();
    let text = if json {
        let items: Vec<Value> = rows
            .iter()
            .map(|o| {
                json!({
                    "key": o.key,
                    "sectionId": o.section_id,
                    "docTitle": o.doc_title,
                    "sectionTitle": o.section_title,
                    "text": o.text,
                })
            })
            .collect();
        line(&json!({ "obligations": items }))
    } else {
        // A section rule's text starts at the blank line under its heading; a tab in the text
        // would read as a third column.
        let rows: Vec<String> = rows
            .iter()
            .map(|o| {
                let first = o.text.split('\n').find(|l| !l.trim().is_empty());
                format!(
                    "{}\t{}",
                    o.section_id,
                    first.unwrap_or_default().trim().replace('\t', " ")
                )
            })
            .collect();
        lines(&rows)
    };
    (text, ids)
}

/// Every resolved (newer, older) pair: a `supersedes` row's declaring document is the newer side,
/// a `superseded-by` row's the older one.
pub fn pairs(corpus: &Corpus, declared_only: bool) -> BTreeSet<(String, String)> {
    let mut found = BTreeSet::new();
    for row in &corpus.supersessions {
        let Some(dst) = &row.dst else { continue };
        match row.direction {
            crate::config::Direction::Supersedes => {
                found.insert((row.doc.clone(), dst.clone()));
            }
            crate::config::Direction::SupersededBy if !declared_only => {
                found.insert((dst.clone(), row.doc.clone()));
            }
            crate::config::Direction::SupersededBy => {}
        }
    }
    found
}

/// The pairs met walking from the document to the documents that replaced it and those that
/// replaced them, and to the documents it replaced and those they replaced.
pub fn supersession(corpus: &Corpus, id: &str, json: bool) -> Option<String> {
    corpus.docs.iter().find(|doc| doc.id == id)?;
    let all = pairs(corpus, false);
    let mut found: BTreeSet<&(String, String)> = BTreeSet::new();
    for newer_side in [true, false] {
        let mut visited = HashSet::from([id]);
        let mut pending = vec![id];
        while let Some(current) = pending.pop() {
            for pair in &all {
                let (from, to) = if newer_side {
                    (&pair.1, &pair.0)
                } else {
                    (&pair.0, &pair.1)
                };
                if from != current {
                    continue;
                }
                found.insert(pair);
                if visited.insert(to.as_str()) {
                    pending.push(to);
                }
            }
        }
    }
    if json {
        let items: Vec<Value> = found
            .iter()
            .map(|(newer, older)| json!({ "newer": newer, "older": older }))
            .collect();
        return Some(line(&json!({ "supersession": items })));
    }
    let rows: Vec<String> = found
        .iter()
        .map(|(newer, older)| format!("{newer}\t{older}"))
        .collect();
    Some(lines(&rows))
}

static BLOCKQUOTE: LazyLock<Regex> = LazyLock::new(|| constant(r"^[ \t]*(?:>[ \t]*)+", "m"));
static WIKI_TEXT: LazyLock<Regex> =
    LazyLock::new(|| constant(r"\[\[([^\]|]*)(?:\|([^\]]*))?\]\]", ""));
static MARKDOWN_TEXT: LazyLock<Regex> =
    LazyLock::new(|| constant(r"!?\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])", ""));
static SPACES: LazyLock<Regex> = LazyLock::new(|| constant(r"\s+", ""));

/// The visible text: blockquote markers, link and wikilink syntax, and emphasis, code, and
/// strikethrough markers removed, whitespace runs collapsed to one space, and the ends trimmed.
fn normalize(text: &str) -> String {
    let text = replace_all(&BLOCKQUOTE, text, |_| String::new());
    let text = replace_all(&WIKI_TEXT, &text, |found| {
        group(found, &text, 2)
            .or_else(|| group(found, &text, 1))
            .unwrap_or_default()
            .to_string()
    });
    let text = replace_all(&MARKDOWN_TEXT, &text, |found| {
        group(found, &text, 1).unwrap_or_default().to_string()
    });
    let text: String = text.chars().filter(|c| !"*_`~".contains(*c)).collect();
    replace_all(&SPACES, &text, |_| " ".to_string())
        .trim()
        .to_string()
}

/// The text of every 「…」 and “…” in a body.
fn quoted(body: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut rest = body;
    while let Some((at, open)) = rest.char_indices().find(|(_, c)| *c == '「' || *c == '“') {
        let close = if open == '「' { '」' } else { '”' };
        let after = rest.get(at + open.len_utf8()..).unwrap_or_default();
        if let Some(end) = after.find(close) {
            found.push(after.get(..end).unwrap_or_default());
            rest = after.get(end + close.len_utf8()..).unwrap_or_default();
        } else {
            rest = after;
        }
    }
    found
}

/// Every 「…」 and “…” of a section, and every blockquote line outside the text before the first
/// H2, whose blockquotes are the document's head: documents written from one template share
/// those lines word for word without quoting each other.
fn quotations(section: &Section) -> Vec<&str> {
    let head = section.id.ends_with('#');
    let blockquotes = section
        .body
        .split('\n')
        .filter(|l| !head && l.trim_start().starts_with('>'));
    blockquotes.chain(quoted(&section.body)).collect()
}

struct Violation {
    rule: &'static str,
    id: String,
    detail: String,
}

impl Violation {
    fn new(rule: &'static str, id: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            rule,
            id: id.into(),
            detail: detail.into(),
        }
    }
}

/// How many documents carry each ticket.
fn ticket_counts(corpus: &Corpus) -> HashMap<&str, usize> {
    let mut counts = HashMap::new();
    for ticket in corpus.docs.iter().filter_map(|doc| doc.ticket.as_deref()) {
        *counts.entry(ticket).or_default() += 1;
    }
    counts
}

/// Whether another document shares the ticket (`Corpus::related` is not empty).
fn has_related(counts: &HashMap<&str, usize>, doc: &Doc) -> bool {
    doc.ticket
        .as_deref()
        .is_some_and(|ticket| counts.get(ticket).is_some_and(|n| *n > 1))
}

pub fn lint(corpus: &Corpus, json: bool) -> (String, bool) {
    let mut violations: Vec<Violation> = Vec::new();
    let counts = ticket_counts(corpus);
    let linking: HashSet<&str> = corpus.links.iter().map(|l| l.doc.as_str()).collect();
    let mut unresolved: Vec<_> = corpus
        .links
        .iter()
        .filter(|l| l.dst_doc.is_none())
        .collect();
    unresolved.sort_by_key(|l| (l.from.clone(), l.written()));
    for link in unresolved {
        violations.push(Violation::new(
            "unresolved",
            link.from.clone(),
            link.written(),
        ));
    }
    for doc in &corpus.docs {
        if let Some(ticket) = &doc.ticket
            && has_related(&counts, doc)
            && !linking.contains(doc.id.as_str())
        {
            violations.push(Violation::new("unlinked", doc.id.clone(), ticket.clone()));
        }
    }
    let is_untyped = |doc: &Doc| {
        doc.metadata
            .get("type")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
    };
    let untyped = corpus.docs.iter().filter(|doc| is_untyped(doc)).count();
    if untyped != corpus.docs.len() {
        for doc in corpus.docs.iter().filter(|doc| is_untyped(doc)) {
            violations.push(Violation::new("untyped", doc.id.clone(), String::new()));
        }
    }
    let mut unresolved_rows: Vec<_> = corpus
        .supersessions
        .iter()
        .filter(|row| row.dst.is_none())
        .map(|row| {
            (
                row.doc.clone(),
                format!("{} {}", row.direction.as_str(), row.raw),
            )
        })
        .collect();
    unresolved_rows.sort();
    for (id, detail) in unresolved_rows {
        violations.push(Violation::new("unresolved-supersession", id, detail));
    }
    let sections_of = |id: &str| -> &[Section] {
        corpus
            .docs
            .iter()
            .find(|doc| doc.id == id)
            .map_or(&[], |doc| doc.sections.as_slice())
    };
    for (newer, older) in pairs(corpus, true) {
        let older_text = normalize(
            &sections_of(&older)
                .iter()
                .map(|s| s.body.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        );
        let quotes_it = sections_of(&newer).iter().flat_map(quotations).any(|q| {
            let text = normalize(q);
            !text.is_empty() && older_text.contains(&text)
        });
        if !quotes_it {
            violations.push(Violation::new("unquoted", newer, older));
        }
    }
    let text = if json {
        let items: Vec<Value> = violations
            .iter()
            .map(|v| json!({ "rule": v.rule, "id": v.id, "detail": v.detail }))
            .collect();
        line(&json!({ "violations": items }))
    } else {
        let rows: Vec<String> = violations
            .iter()
            .map(|v| {
                [v.rule, v.id.as_str(), v.detail.as_str()]
                    .into_iter()
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>()
                    .join("  ")
            })
            .collect();
        lines(&rows)
    };
    (text, !violations.is_empty())
}

pub fn stats(corpus: &Corpus, json: bool) -> String {
    let documents = corpus.docs.len();
    let sections: usize = corpus.docs.iter().map(|doc| doc.sections.len()).sum();
    let links = corpus.links.len();
    let unresolved = corpus.links.iter().filter(|l| l.dst_doc.is_none()).count();
    let mut connected: HashSet<&str> = HashSet::new();
    for link in &corpus.links {
        if let Some(dst) = &link.dst_doc
            && *dst != link.doc
        {
            connected.insert(&link.doc);
            connected.insert(dst);
        }
    }
    let counts = ticket_counts(corpus);
    for doc in &corpus.docs {
        if has_related(&counts, doc) {
            connected.insert(&doc.id);
        }
    }
    let isolated = documents - connected.len();
    if json {
        return line(&json!({
            "documents": documents,
            "sections": sections,
            "links": links,
            "unresolved": unresolved,
            "isolated": isolated,
        }));
    }
    lines(&[
        format!("documents  {documents}"),
        format!("sections  {sections}"),
        format!("links  {links}"),
        format!("unresolved  {unresolved}"),
        format!("isolated  {isolated}/{documents}"),
    ])
}

fn text_of(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map_or_else(|| "null".to_string(), str::to_string)
}

/// Counts, per document the corpus holds now, the log entries that returned it, and the searches
/// that found nothing or only `or`-matched rows, per query.
pub fn usage(corpus: &Corpus, entries: &[Value], json: bool) -> String {
    let mut counts: BTreeMap<&str, usize> =
        corpus.docs.iter().map(|d| (d.id.as_str(), 0)).collect();
    let mut misses: Vec<(String, usize)> = Vec::new();
    for entry in entries {
        let results = entry
            .get("results")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        let documents: HashSet<&str> = results
            .iter()
            .filter_map(|result| result.get("id").and_then(Value::as_str))
            .filter_map(|id| id.split('#').next())
            .collect();
        for id in documents {
            if let Some(count) = counts.get_mut(id) {
                *count += 1;
            }
        }
        let is_miss = entry.get("command").and_then(Value::as_str) == Some("search")
            && results
                .iter()
                .all(|r| r.get("matchPath").and_then(Value::as_str) == Some("or"));
        if is_miss {
            let query = text_of(entry.get("query"));
            match misses.iter_mut().find(|(seen, _)| *seen == query) {
                Some((_, count)) => *count += 1,
                None => misses.push((query, 1)),
            }
        }
    }
    let mut hot: Vec<(&str, usize)> = counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .map(|(id, count)| (*id, *count))
        .collect();
    hot.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    let dead: Vec<&str> = counts
        .iter()
        .filter(|(_, count)| **count == 0)
        .map(|(id, _)| *id)
        .collect();
    misses.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let from = entries
        .first()
        .and_then(|e| e.get("at"))
        .cloned()
        .unwrap_or(Value::Null);
    let to = entries
        .last()
        .and_then(|e| e.get("at"))
        .cloned()
        .unwrap_or(Value::Null);
    if json {
        return line(&json!({
            "from": from,
            "to": to,
            "entries": entries.len(),
            "hot": hot.iter().map(|(id, count)| json!({ "id": id, "count": count })).collect::<Vec<_>>(),
            "dead": dead,
            "misses": misses.iter().map(|(query, count)| json!({ "query": query, "count": count })).collect::<Vec<_>>(),
        }));
    }
    let header = format!(
        "# log {} .. {} · {} entries",
        text_of(Some(&from)),
        text_of(Some(&to)),
        entries.len()
    );
    // A tab or line break in a query would read as another column or line.
    let rows: Vec<String> = std::iter::once(header)
        .chain(hot.iter().map(|(id, count)| format!("hot\t{count}\t{id}")))
        .chain(dead.iter().map(|id| format!("dead\t{id}")))
        .chain(misses.iter().map(|(query, count)| {
            format!("miss\t{count}\t{}", query.replace(['\t', '\n', '\r'], " "))
        }))
        .collect();
    lines(&rows)
}
