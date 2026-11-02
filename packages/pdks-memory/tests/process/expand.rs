//! `search` query expansion: an English query with no Hangul also searches the Korean
//! translations of its words, from glosses written in the corpus and from the embedded dictionary.

use serde_json::Value;

use crate::common::{Project, page};

const LOG: &str = ".polydeukes/memory-log.jsonl";

fn topic(body: &str) -> String {
    page("Same doc", &[("Topic", body)])
}

/// Writes `notes/<name>.md` for each pair and adds three documents that hold none of the
/// fixture words, so a term's idf stays positive.
fn corpus(docs: &[(&str, String)]) -> Project {
    let project = Project::notes();
    for (name, text) in docs {
        project.write(&format!("notes/{name}.md"), text);
    }
    for i in 0..3 {
        project.write(
            &format!("notes/filler-{i}.md"),
            &page(
                "Filler",
                &[("One", "nothing here."), ("Two", "nothing here.")],
            ),
        );
    }
    project
}

/// `(id, matchPath)` of every result for the words, ranked.
fn found(project: &Project, words: &[&str]) -> Vec<(String, String)> {
    let mut args = vec!["search", "--limit", "100"];
    args.extend_from_slice(words);
    let answer = project.json(&args);
    answer
        .get("results")
        .and_then(Value::as_array)
        .expect("a search answer has a results list")
        .iter()
        .map(|result| {
            let text = |key: &str| {
                result
                    .get(key)
                    .and_then(Value::as_str)
                    .expect("the result field is a string")
                    .to_string()
            };
            (text("id"), text("matchPath"))
        })
        .collect()
}

fn ids(project: &Project, words: &[&str]) -> Vec<String> {
    let mut list: Vec<String> = found(project, words)
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    list.sort();
    list
}

fn pair(id: &str, path: &str) -> (String, String) {
    (id.to_string(), path.to_string())
}

// Each plural ending is stripped from the dictionary side only when the word itself misses:
// `batteries` needs `ies`->`y`, `witnesses` needs `es`->``, `valves` needs `s`->`` (after `es`
// gives `valv`, which is not a word). A single-suffix implementation misses one of them.
#[test]
fn a_plural_is_reduced_to_a_dictionary_word_by_ies_then_es_then_s() {
    let project = corpus(&[
        ("a", topic("배터리 문서입니다.")),
        ("b", topic("증인 문서입니다.")),
        ("c", topic("밸브 문서입니다.")),
    ]);

    assert_eq!(ids(&project, &["batteries"]), ["notes/a#topic"]);
    assert_eq!(ids(&project, &["witnesses"]), ["notes/b#topic"]);
    assert_eq!(ids(&project, &["valves"]), ["notes/c#topic"]);
}

// The logged query is what the user typed, and the logged results are the expanded answer;
// logging the expanded terms would change `usage`'s query counts.
#[test]
fn the_query_log_keeps_the_original_text_and_the_expanded_results() {
    let project = corpus(&[("a", topic("배터리 문서입니다."))]);

    project.ok(&["search", "batteries"]);

    let line = project.read(LOG);
    let entry: Value = serde_json::from_str(line.trim_end()).expect("one JSON log line");
    assert_eq!(
        entry.get("query").and_then(Value::as_str),
        Some("batteries")
    );
    assert_eq!(
        entry.pointer("/results/0/id").and_then(Value::as_str),
        Some("notes/a#topic")
    );
}

// A translation from a gloss written in the corpus is used: `약속` is not in the dictionary entry
// for `covenant` (`언약`), so a section holding only `약속` is found only through the gloss.
#[test]
fn a_corpus_gloss_is_a_translation_of_the_word() {
    let project = corpus(&[
        ("gloss", topic("약속(covenant) 은 판정 문서.")),
        ("only-gloss-word", topic("약속 만 있다.")),
        ("only-dictionary-word", topic("언약 만 있다.")),
    ]);

    assert_eq!(
        ids(&project, &["covenant"]),
        [
            "notes/gloss#topic",
            "notes/only-dictionary-word#topic",
            "notes/only-gloss-word#topic"
        ]
    );
}

// At most three translations, corpus glosses first: three glosses fill the group, so the
// dictionary's `언약` is dropped. Putting the dictionary first or lifting the cap finds `d`.
#[test]
fn corpus_glosses_come_before_the_dictionary_and_the_group_holds_three_translations() {
    let project = corpus(&[
        (
            "gloss",
            topic("약속(covenant) 서약(Covenant) 계약(covenant) 이다."),
        ),
        ("a", topic("서약 만 있다.")),
        ("c", topic("계약 만 있다.")),
        ("d", topic("언약 만 있다.")),
    ]);

    assert_eq!(
        ids(&project, &["covenant"]),
        ["notes/a#topic", "notes/c#topic", "notes/gloss#topic"]
    );
}

// A query that has a Hangul syllable is searched as written: `a` holds only the dictionary
// translation of `battery`, `b` holds the Hangul word.
#[test]
fn a_query_with_hangul_is_not_expanded() {
    let project = corpus(&[
        ("a", topic("배터리 문서입니다.")),
        ("b", topic("설명 문서입니다.")),
    ]);

    assert_eq!(
        found(&project, &["battery 설명"]),
        [pair("notes/b#topic", "or")]
    );
}

// A group is matched by a translation in a different section from the original word: `a` holds
// `battery`, `b` holds only `밸브`, `c` holds `배터리` and `밸브`. `c` matches every group, so `and`.
#[test]
fn a_section_matching_every_group_by_translations_is_and() {
    let project = corpus(&[
        ("a", topic("battery here.")),
        ("b", topic("밸브 문서.")),
        ("c", topic("배터리 밸브 문서.")),
    ]);

    let got = found(&project, &["battery", "valve"]);

    assert!(got.contains(&pair("notes/c#topic", "and")), "{got:?}");
    assert!(got.contains(&pair("notes/a#topic", "or")), "{got:?}");
    assert!(got.contains(&pair("notes/b#topic", "or")), "{got:?}");
}
