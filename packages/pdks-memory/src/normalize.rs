//! Reduces a query to the terms a document would hold: Korean words lose their particles and
//! endings, English words their possessive, and function words drop out.

use std::collections::HashSet;

use garu_core::model::Analyzer;

const MODEL: &[u8] = include_bytes!("../models/garu-base.gmdl");

const LEADING: &str = "`'\"()[]{}<>?,!:;";
const TRAILING: &str = "`'\"()[]{}<>?,.!:;";
const ENDINGS: [&str; 4] = ["EP", "EF", "EC", "ETM"];
// `NR` stays out: the analyzer splits `복구하나요` into `복구` · `하나`/NR · `요`, and a numeral
// joined to the run would turn it into `복구하나`, which no document holds.
const CONTENT: [&str; 10] = [
    "NNG", "NNP", "SL", "SH", "SN", "XR", "XSN", "XPN", "VV", "VA",
];
const INTERROGATIVES: [&str; 7] = ["어떻", "얼마", "어디", "언제", "무엇", "누구", "뭔"];
const STOPWORDS: &str = "a an the and or of to in on at by for from with without about into is are \
    was were be been being do does did done have has had i you we they it this that these those \
    what which who whom whose when where why how should would could can will shall may might must \
    not no my our your their its there than then so if as while still let lets";

/// Whether the character is in the Unicode Hangul script.
fn is_hangul(c: char) -> bool {
    matches!(c,
        '\u{1100}'..='\u{11FF}'
        | '\u{302E}'..='\u{302F}'
        | '\u{3131}'..='\u{318E}'
        | '\u{3200}'..='\u{321E}'
        | '\u{3260}'..='\u{327E}'
        | '\u{A960}'..='\u{A97C}'
        | '\u{AC00}'..='\u{D7A3}'
        | '\u{D7B0}'..='\u{D7C6}'
        | '\u{D7CB}'..='\u{D7FB}'
        | '\u{FFA0}'..='\u{FFBE}'
        | '\u{FFC2}'..='\u{FFC7}'
        | '\u{FFCA}'..='\u{FFCF}'
        | '\u{FFD2}'..='\u{FFD7}'
        | '\u{FFDA}'..='\u{FFDC}')
}

fn has_hangul(text: &str) -> bool {
    text.chars().any(is_hangul)
}

fn is_content(pos: &str) -> bool {
    CONTENT.contains(&pos)
}

fn wide_enough(text: &str) -> bool {
    text.chars().nth(1).is_some()
}

fn word_terms(analyzer: Option<&Analyzer>, raw: &str) -> Vec<String> {
    let word = raw
        .trim_start_matches(|c| LEADING.contains(c))
        .trim_end_matches(|c| TRAILING.contains(c));
    let Some(analyzer) = analyzer.filter(|_| has_hangul(word)) else {
        // `·` joins a list inside one word (`field·filter`), so each part is a word of its own.
        return word
            .split('·')
            .filter_map(|part| {
                let bare = part
                    .strip_suffix("'s")
                    .or_else(|| part.strip_suffix('\''))
                    .unwrap_or(part);
                let lower = bare.to_lowercase();
                let stopword = STOPWORDS.split(' ').any(|stop| stop == lower);
                (wide_enough(bare) && !stopword).then(|| bare.to_string())
            })
            .collect();
    };
    let tokens = analyzer.analyze(word).tokens;
    // A particle is spelled as the analyzer returns it, so it comes off the end of the word as
    // written and the rest is read again. Rebuilding the word from tokens would split
    // `packages/memory의` at `/` and turn `잠김을` into `잠기`, which no document holds.
    if let Some(last) = tokens.last()
        && last.pos.as_str().starts_with('J')
        && word.encode_utf16().count() > last.text.encode_utf16().count()
        && let Some(rest) = word.strip_suffix(last.text.as_str())
    {
        return word_terms(Some(analyzer), rest);
    }
    let has_content = tokens.iter().any(|token| is_content(token.pos.as_str()));
    // A word with no particle, ending, or symbol stays whole: the analyzer splits compounds such
    // as `워크트리` into halves the index matches in far more sections than the compound. A
    // symbol (`디스패치(W1)`) still splits the word at that symbol.
    let whole = !tokens.iter().any(|token| {
        let pos = token.pos.as_str();
        pos.starts_with('J') || ENDINGS.contains(&pos) || (pos.starts_with('S') && !is_content(pos))
    });
    if whole {
        return if has_content && !INTERROGATIVES.contains(&word) {
            vec![word.to_string()]
        } else {
            Vec::new()
        };
    }
    let mut runs = Vec::new();
    let mut run = String::new();
    for token in tokens.iter().map(Some).chain([None]) {
        if let Some(token) = token
            && is_content(token.pos.as_str())
        {
            run.push_str(&token.text);
            continue;
        }
        if wide_enough(&run) && !INTERROGATIVES.contains(&run.as_str()) {
            runs.push(std::mem::take(&mut run));
        }
        run.clear();
    }
    runs
}

/// What a JavaScript `\s` matches.
pub fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// The words of a query, split where a JavaScript `\s+` splits.
pub fn query_words(query: &str) -> Vec<&str> {
    query
        .split(is_js_space)
        .filter(|word| !word.is_empty())
        .collect()
}

/// Splits a query on whitespace and reduces each word to the text a document would hold. English
/// words keep their case and ending so an identifier query comes back unchanged. The analyzer is
/// built only when a word holds Hangul.
pub fn normalize_query(query: &str) -> Vec<String> {
    let words = query_words(query);
    let analyzer = words
        .iter()
        .any(|word| has_hangul(word))
        .then(|| Analyzer::from_bytes(MODEL).expect("the embedded garu model loads"));
    let mut seen = HashSet::new();
    words
        .iter()
        .flat_map(|raw| word_terms(analyzer.as_ref(), raw))
        .filter(|term| seen.insert(term.clone()))
        .collect()
}
