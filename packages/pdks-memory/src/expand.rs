//! Widens each term of an English query into a group of the term and its Korean translations,
//! taken from glosses written in the corpus (`약속(covenant)`) and from an embedded dictionary.

use std::collections::HashMap;

use crate::corpus::Corpus;

const DICTIONARY: &str = include_str!("../models/en-ko.tsv");
const MAX_TRANSLATIONS: usize = 3;
// `s` before `es`: `nodes` is `node`, not `nod`; `es` still reaches `witness` because `witnesse`
// is not a word.
const PLURALS: [(&str, &str); 3] = [("ies", "y"), ("s", ""), ("es", "")];

fn is_syllable(c: char) -> bool {
    matches!(c, '\u{AC00}'..='\u{D7A3}')
}

fn is_english(text: &str) -> bool {
    let mut chars = text.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphabetic() || c == '-')
}

/// Maps each wanted lowercased English word to the Korean words written right before it in
/// parentheses, in the order they first appear.
fn glosses(corpus: &Corpus, wanted: &[String]) -> HashMap<String, Vec<String>> {
    let mut found: HashMap<String, Vec<String>> = HashMap::new();
    for doc in &corpus.docs {
        for section in &doc.sections {
            let mut before = "";
            for (at, part) in section.body.split('(').enumerate() {
                if at > 0
                    && let Some((inner, _)) = part.split_once(')')
                    && is_english(inner)
                    && wanted.iter().any(|word| word.eq_ignore_ascii_case(inner))
                    && let Some(korean) = before.get(before.trim_end_matches(is_syllable).len()..)
                    && !korean.is_empty()
                {
                    let words = found.entry(inner.to_ascii_lowercase()).or_default();
                    if !words.iter().any(|word| word == korean) {
                        words.push(korean.to_string());
                    }
                }
                before = part;
            }
        }
    }
    found
}

fn entry(key: &str) -> Option<Vec<&'static str>> {
    DICTIONARY.lines().find_map(|line| {
        let mut fields = line.split('\t');
        (fields.next()? == key).then(|| fields.collect())
    })
}

fn dictionary(lower: &str) -> Vec<&'static str> {
    entry(lower)
        .or_else(|| {
            PLURALS.iter().find_map(|(ending, with)| {
                let stem = lower.strip_suffix(ending)?;
                entry(&format!("{stem}{with}"))
            })
        })
        .unwrap_or_default()
}

/// One group per term: the term first, then up to three translations.
pub fn groups(corpus: &Corpus, terms: Vec<String>) -> Vec<Vec<String>> {
    let lowered: Vec<String> = terms.iter().map(|term| term.to_ascii_lowercase()).collect();
    let glossed = glosses(corpus, &lowered);
    terms
        .into_iter()
        .map(|term| {
            let lower = term.to_ascii_lowercase();
            let from_corpus = glossed
                .get(&lower)
                .into_iter()
                .flatten()
                .map(String::as_str);
            let mut group = vec![term];
            for word in from_corpus.chain(dictionary(&lower)) {
                if group.len() > MAX_TRANSLATIONS {
                    break;
                }
                if !group.iter().any(|seen| seen == word) {
                    group.push(word.to_string());
                }
            }
            group
        })
        .collect()
}
