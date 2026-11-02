//! `usage`: the memory log laid against the documents the corpus holds now.
//!
//! The log is written by hand here, one JSON line per query: when, which command, its query, and
//! the ids it returned. A search entry carries the path that matched each result.

use serde_json::{Value, json};

use crate::common::{Project, assert_refused, line, page};

const LOG: &str = ".polydeukes/memory-log.jsonl";
const NO_LOG: &str = "no memory log at .polydeukes/memory-log.jsonl — run pdks memory search, show, or obligations first";

fn stamp(n: u32) -> String {
    format!("2026-09-28T00:00:{n:02}.000Z")
}

fn entry(n: u32, command: &str, query: &str, results: &Value) -> String {
    json!({ "at": stamp(n), "command": command, "query": query, "results": results }).to_string()
}

fn matched(id: &str, path: &str) -> Value {
    json!({ "id": id, "matchPath": path })
}

fn plain(id: &str) -> Value {
    json!({ "id": id })
}

/// Five documents; `alpha` has two sections so one entry can name it twice.
fn corpus() -> Project {
    let project = Project::notes();
    project.write(
        "notes/alpha.md",
        &page("Alpha", &[("One", "alpha one."), ("Two", "alpha two.")]),
    );
    for name in ["beta", "gamma", "delta", "zed"] {
        project.write(
            &format!("notes/{name}.md"),
            &page(name, &[("One", "text.")]),
        );
    }
    project
}

fn write_log(project: &Project, lines: &[String]) {
    project.write(LOG, &format!("{}\n", lines.join("\n")));
}

// A count over result rows gives `alpha` 3 for two sections in one entry and ties it with `beta`; a
// count keyed on the section id never reaches the document; a hot list in first-seen order puts
// `gamma` before `alpha`, one in count-ascending order puts `beta` last; a dead list that omits a
// document the log never names, or lists it as hot with count 0, hides what the summary is for;
// from and to read from any entry but the first and last drift from the log's span.
#[test]
fn usage_counts_each_document_once_per_entry_and_orders_hot_by_count_then_id() {
    let project = corpus();
    write_log(
        &project,
        &[
            entry(
                1,
                "search",
                "gamma",
                &json!([matched("notes/gamma#one", "and")]),
            ),
            entry(
                2,
                "search",
                "alpha",
                &json!([
                    matched("notes/alpha#one", "and"),
                    matched("notes/alpha#two", "and")
                ]),
            ),
            entry(3, "show", "notes/beta", &json!([plain("notes/beta")])),
            entry(4, "obligations", "AB-1", &json!([plain("notes/beta#one")])),
            entry(
                5,
                "search",
                "both",
                &json!([
                    matched("notes/alpha#two", "or"),
                    matched("notes/gamma#one", "or")
                ]),
            ),
            entry(
                6,
                "show",
                "notes/beta#one",
                &json!([plain("notes/beta#one")]),
            ),
        ],
    );

    assert_eq!(
        project.ok(&["usage"]),
        format!(
            "# log {} .. {} · 6 entries\nhot\t3\tnotes/beta\nhot\t2\tnotes/alpha\nhot\t2\tnotes/gamma\ndead\tnotes/delta\ndead\tnotes/zed\nmiss\t1\tboth\n",
            stamp(1),
            stamp(6)
        )
    );
    assert_eq!(
        project.ok(&["usage", "--json"]),
        line(&json!({
            "from": stamp(1),
            "to": stamp(6),
            "entries": 6,
            "hot": [
                { "id": "notes/beta", "count": 3 },
                { "id": "notes/alpha", "count": 2 },
                { "id": "notes/gamma", "count": 2 }
            ],
            "dead": ["notes/delta", "notes/zed"],
            "misses": [{ "query": "both", "count": 1 }]
        }))
    );
}

// An id whose document left the corpus counted as hot invents a document no `show` can open; one
// that drops the whole entry loses `alpha`'s hit; a document id matched only by an exact section id
// misses the preamble form `notes/alpha#`.
#[test]
fn usage_ignores_ids_of_documents_no_longer_present_and_reads_a_preamble_id_as_its_document() {
    let project = corpus();
    write_log(
        &project,
        &[
            entry(
                1,
                "search",
                "moved",
                &json!([
                    matched("notes/gone#one", "and"),
                    matched("notes/alpha#", "and")
                ]),
            ),
            entry(2, "show", "notes/gone", &json!([plain("notes/gone")])),
        ],
    );

    assert_eq!(
        project.ok(&["usage"]),
        format!(
            "# log {} .. {} · 2 entries\nhot\t1\tnotes/alpha\ndead\tnotes/beta\ndead\tnotes/delta\ndead\tnotes/gamma\ndead\tnotes/zed\n",
            stamp(1),
            stamp(2)
        )
    );
}

// A miss test that reads only emptiness lets the all-`or` search through; one that reads "any `or`"
// flags the mixed search, and one that treats `like` as a fallback flags the like-only search; a
// miss keyed on anything but the exact query text merges or splits the repeated one; an obligations
// entry with no row is an empty answer, not a failed search; a miss list in first-seen order puts
// `zzz` before `aaa`.
#[test]
fn a_search_with_no_result_or_only_or_matches_is_a_miss_grouped_by_exact_query() {
    let project = corpus();
    write_log(
        &project,
        &[
            entry(1, "search", "zzz", &json!([])),
            entry(
                2,
                "search",
                "repeated",
                &json!([
                    matched("notes/alpha#one", "or"),
                    matched("notes/beta#one", "or")
                ]),
            ),
            entry(
                3,
                "search",
                "mixed",
                &json!([
                    matched("notes/alpha#one", "or"),
                    matched("notes/beta#one", "and")
                ]),
            ),
            entry(
                4,
                "search",
                "like only",
                &json!([matched("notes/gamma#one", "like")]),
            ),
            entry(5, "search", "aaa", &json!([])),
            entry(6, "search", "repeated", &json!([])),
            entry(7, "obligations", "AB-9", &json!([])),
            entry(8, "show", "notes/delta", &json!([plain("notes/delta")])),
        ],
    );

    assert_eq!(
        project.json(&["usage"]).pointer("/misses"),
        Some(&json!([
            { "query": "repeated", "count": 2 },
            { "query": "aaa", "count": 1 },
            { "query": "zzz", "count": 1 }
        ]))
    );
}

// The span is the first and the last entry as written, not the earliest and the latest `at`.
#[test]
fn the_span_is_the_first_and_last_entry_of_the_log() {
    let project = corpus();
    write_log(
        &project,
        &[
            entry(3, "show", "notes/beta", &json!([plain("notes/beta")])),
            entry(1, "show", "notes/beta", &json!([plain("notes/beta")])),
            entry(2, "show", "notes/beta", &json!([plain("notes/beta")])),
        ],
    );

    let usage = project.json(&["usage"]);

    assert_eq!(usage.pointer("/from"), Some(&json!(stamp(3))));
    assert_eq!(usage.pointer("/to"), Some(&json!(stamp(2))));
    assert_eq!(usage.pointer("/entries"), Some(&json!(3)));
}

// A line cut off mid-write is skipped and not counted, wherever it sits; a blank line is skipped too.
#[test]
fn a_line_that_is_not_json_is_skipped_and_not_counted() {
    let project = corpus();
    project.write(
        LOG,
        &format!(
            "{}\n\n{{\"at\":\"2026-09-28T00:00\n{}\n{{\"at\":\"2026-09-28T00:00",
            entry(1, "show", "notes/beta", &json!([plain("notes/beta")])),
            entry(2, "show", "notes/beta", &json!([plain("notes/beta")])),
        ),
    );

    assert_eq!(
        project.ok(&["usage"]).lines().next(),
        Some(format!("# log {} .. {} · 2 entries", stamp(1), stamp(2)).as_str())
    );
}

// A log whose only line is cut off holds no query: answering it would report every document dead
// over a record that holds nothing.
#[test]
fn a_log_with_no_parseable_line_is_refused_as_no_log() {
    let project = corpus();
    project.write(LOG, "{\"at\":\"2026-09-28T00:00");

    assert_refused(&project.run(&["usage"]), NO_LOG);
}

// A tab left in a missed query adds a fourth column to the table line; the JSON keeps the query as
// it was run.
#[test]
fn a_tab_in_a_missed_query_is_printed_as_a_space_and_kept_in_json() {
    let project = corpus();
    let query = "zz-no\tsuch-491";
    write_log(&project, &[entry(1, "search", query, &json!([]))]);

    assert!(
        project
            .ok(&["usage"])
            .lines()
            .any(|l| l == "miss\t1\tzz-no such-491")
    );
    assert_eq!(
        project.json(&["usage"]).pointer("/misses"),
        Some(&json!([{ "query": query, "count": 1 }]))
    );
}

// `usage` reads the log and writes nothing.
#[test]
fn usage_leaves_the_log_as_it_was() {
    let project = corpus();
    write_log(
        &project,
        &[entry(
            1,
            "show",
            "notes/beta",
            &json!([plain("notes/beta")]),
        )],
    );
    let before = project.read(LOG);

    project.ok(&["usage"]);
    project.ok(&["usage", "--json"]);

    assert_eq!(project.read(LOG), before);
}

// One byte that is not UTF-8 spoils its own line only: the line is skipped like any non-JSON line.
#[test]
fn a_log_line_with_invalid_utf8_is_skipped_not_refused() {
    let project = corpus();
    let mut log = entry(1, "show", "notes/beta", &json!([plain("notes/beta")])).into_bytes();
    log.extend_from_slice(b"\n{\"query\":\"\xea\xb2");
    project.write_bytes(LOG, &log);

    assert_eq!(
        project.json(&["usage"]).pointer("/entries"),
        Some(&json!(1))
    );
}
