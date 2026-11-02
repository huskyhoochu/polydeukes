//! `search <query…> [--json] [--limit <n>]`: matching, ranking, output, and the query log.
//!
//! Every fixture document sits under `notes/`, so a section id starts with `notes/`; query words
//! never begin with that prefix unless a test is about identifier prefixes. Documents that must
//! tie on score share one title and one section heading, so only the body differs.

use std::collections::BTreeSet;

use serde_json::{Value, json};

use crate::common::{NOTES_INCLUDE, Project, assert_refused, doc, is_iso_utc_millis, page, typed};

const USAGE: &str = "usage: pdks memory search <query…> [--json] [--limit <n>] | pdks memory show <id> [--json] | pdks memory obligations <key> [--json] | pdks memory supersession <doc> [--json] | pdks memory lint [--json] | pdks memory stats [--json] | pdks memory usage [--json]";
const INVALID_INCLUDE: &str = "invalid config in polydeukes.config.json: memory.include must be a non-empty array of non-empty strings";
const LOG: &str = ".polydeukes/memory-log.jsonl";
const SAME: &str = "Same doc";
const WORD: &str = "needleword";

fn topic(body: &str) -> String {
    page(SAME, &[("Topic", body)])
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

/// The corpus the argument tests search: three sections that hold `needleword`.
fn three_hits() -> Project {
    corpus(&[
        ("a", topic("needleword aa aa aa aa.")),
        ("m", topic("needleword needleword aa aa aa.")),
        ("z", topic("needleword needleword needleword aa.")),
    ])
}

fn results_of(answer: &Value) -> Vec<Value> {
    answer
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .expect("a search answer has a results list")
}

fn field(result: &Value, key: &str) -> String {
    result
        .get(key)
        .and_then(Value::as_str)
        .expect("the result field is a string")
        .to_string()
}

/// `(id, matchPath)` of every result for the words, ranked, up to 100.
fn found(project: &Project, words: &[&str]) -> Vec<(String, String)> {
    let mut args = vec!["search", "--limit", "100"];
    args.extend_from_slice(words);
    results_of(&project.json(&args))
        .iter()
        .map(|result| (field(result, "id"), field(result, "matchPath")))
        .collect()
}

fn ids(project: &Project, words: &[&str]) -> Vec<String> {
    found(project, words)
        .into_iter()
        .map(|(id, _)| id)
        .collect()
}

fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
    list.iter()
        .map(|(id, path)| ((*id).to_string(), (*path).to_string()))
        .collect()
}

fn as_set(rows: &[(String, String)]) -> BTreeSet<(String, String)> {
    rows.iter().cloned().collect()
}

fn words(count: usize, word: &str, placed: &[(usize, &str)]) -> String {
    (0..count)
        .map(|i| {
            placed
                .iter()
                .find(|(at, _)| *at == i)
                .map_or(word, |(_, put)| put)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// 200 `filler` words: a 1,399-character block, so two of them joined by a blank line exceed
/// one chunk.
fn paragraph(placed: &[(usize, &str)]) -> String {
    words(200, "filler", placed)
}

fn long(lead: &str) -> String {
    format!("{lead} {}", "filler ".repeat(120))
}

fn log_lines(project: &Project) -> Vec<Value> {
    project
        .read(LOG)
        .lines()
        .map(|line| serde_json::from_str(line).expect("a log line is JSON"))
        .collect()
}

fn supersession_memory() -> Value {
    json!({
        "include": [NOTES_INCLUDE],
        "supersedes": [{ "line": "Supersedes:", "key": "(?<=doc:)[A-Za-z0-9-]+", "direction": "supersedes" }]
    })
}

fn supersession_project() -> Project {
    Project::new(&supersession_memory())
}

// A search that accepts no words, reads `--json` or `--limit` as the query, or reads the config
// before the arguments, answers something other than the usage line.
#[test]
fn a_search_with_no_query_word_refuses_with_the_usage_line() {
    let project = three_hits();
    for args in [
        &["search"][..],
        &["search", "--json"],
        &["search", "--limit", "5"],
        &["search", "--json", "--limit", "5"],
    ] {
        assert_refused(&project.run(args), USAGE);
    }
    assert_refused(&Project::bare().run(&["search"]), USAGE);
    assert!(!project.exists(".polydeukes"));
}

// Any other `--` word refused rather than searched for: `--limit=5` is not the flag, and a
// refused call leaves no log line.
#[test]
fn another_double_dash_word_refuses_with_the_usage_line() {
    let project = three_hits();
    for args in [
        &["search", "needleword", "--verbose"][..],
        &["search", "needleword", "--limit=5"],
        &["search", "--json", "needleword", "--extra"],
    ] {
        assert_refused(&project.run(args), USAGE);
    }
    assert!(!project.exists(LOG));
}

// A parser that treats every leading dash as a flag blocks a query such as `-1`.
#[test]
fn a_word_with_a_single_leading_dash_is_a_query_word() {
    let project = corpus(&[("a", topic("it was -1 degrees.")), ("b", topic("plain."))]);

    assert_eq!(found(&project, &["-1"]), pairs(&[("notes/a#topic", "and")]));
}

// A value that reaches the search unchecked prints an empty list and exit 0 where the user
// mistyped the flag: zero, a negative, a fraction, a leading zero or sign, text, an empty value,
// one past 2^53 - 1, one that overflows u64, a missing value, the next flag as the value, and the
// second of two flags.
#[test]
fn a_limit_that_is_not_a_positive_safe_integer_refuses_before_searching() {
    let project = three_hits();
    let bad: [&[&str]; 13] = [
        &["0"],
        &["-1"],
        &["1.5"],
        &["01"],
        &["+1"],
        &["1e3"],
        &[""],
        &["9007199254740992"],
        &["99999999999999999999999"],
        &[],
        &["--json", "2"],
        &["2", "--limit", "3"],
        &["0x10"],
    ];
    for value in bad {
        let mut args = vec!["search", "needleword", "--limit"];
        args.extend_from_slice(value);
        assert_refused(&project.run(&args), USAGE);
    }
    assert!(!project.exists(LOG));
}

// 2^53 - 1 is the largest accepted value, so a bound one lower or an `i32` parse refuses it.
#[test]
fn the_largest_safe_integer_is_an_accepted_limit() {
    let project = three_hits();

    let out = project.run(&[
        "search",
        "needleword",
        "--limit",
        "9007199254740991",
        "--json",
    ]);

    assert_eq!(out.code, 0, "{}", out.stderr);
    assert_eq!(results_of(&out.json()).len(), 3);
}

// The ranked list is cut after sorting, so `--limit 1` keeps the best section and not the first
// by id. The flag works before or after the words and `--json`, and its value never joins the
// query: the logged query is the words alone.
#[test]
fn limit_keeps_the_best_ranked_sections_wherever_the_flag_sits() {
    let project = three_hits();
    let ranked = ["notes/z#topic", "notes/m#topic"];

    for args in [
        &["search", "needleword", "--json", "--limit", "2"][..],
        &["search", "--limit", "2", "needleword", "--json"],
        &["search", "--json", "needleword", "--limit", "2"],
    ] {
        let answer = project.run(args).json();
        let got: Vec<String> = results_of(&answer)
            .iter()
            .map(|result| field(result, "id"))
            .collect();
        assert_eq!(got, ranked, "{args:?}");
    }
    let one = project.json(&["search", "needleword", "--limit", "1"]);
    assert_eq!(results_of(&one).len(), 1);
    assert!(
        log_lines(&project)
            .iter()
            .all(|line| { line.get("query").and_then(Value::as_str) == Some("needleword") })
    );
}

// Twenty-two sections tie on score. The default keeps exactly twenty, the first twenty by id,
// and `--limit` raises or lowers it by exactly the value given.
#[test]
fn the_default_limit_is_twenty_and_the_flag_replaces_it() {
    let names: Vec<String> = (0..22).map(|i| format!("hit-{i:02}")).collect();
    let docs: Vec<(&str, String)> = names
        .iter()
        .map(|name| (name.as_str(), topic("needleword here.")))
        .collect();
    let project = corpus(&docs);

    let default = results_of(&project.json(&["search", "needleword"]));
    let count_with = |limit: &str| -> usize {
        results_of(&project.json(&["search", "needleword", "--limit", limit])).len()
    };

    assert_eq!(default.len(), 20);
    assert_eq!(
        default.last().map(|result| field(result, "id")),
        Some("notes/hit-19#topic".to_string())
    );
    assert_eq!(count_with("21"), 21);
    assert_eq!(count_with("22"), 22);
    assert_eq!(count_with("100"), 22);
}

// The text form is one line per result: id, path, status, trust, and `<document> › <section>`
// separated by single tabs. A preamble row, which has no section title, shows the document title
// alone.
#[test]
fn the_text_form_is_five_tab_separated_columns() {
    let project = Project::notes();
    project.write(
        "notes/alpha.md",
        &typed("Alpha", &[("Topic", "alphaword here.")]),
    );
    project.write(
        "notes/pre.md",
        "---\ntitle: Pre\n---\npreword intro.\n\n## Later\nzzz.\n",
    );

    assert_eq!(
        project.ok(&["search", "alphaword"]),
        "notes/alpha#topic\tand\tstable\tunverified\tAlpha › Topic\n"
    );
    assert_eq!(
        project.ok(&["search", "preword"]),
        "notes/pre#\tand\tstable\tunverified\tPre\n"
    );
    project.write(
        "notes/spaced name.md",
        &typed("Spaced", &[("Topic", "spaceword here.")]),
    );
    assert_eq!(
        project.ok(&["search", "spaceword"]),
        "notes/spaced name#topic\tand\tstable\tunverified\tSpaced › Topic\n"
    );
}

// The status column grows `, stale` for a past `stale_after`, and `, superseded by <ids>` after
// it, the newer documents sorted and joined by one space.
#[test]
fn the_status_column_appends_stale_then_the_superseding_documents() {
    let project = supersession_project();
    project.write(
        "notes/old.md",
        &doc(
            &[
                ("title", "Old"),
                ("status", "draft"),
                ("stale_after", "\"2000-01-01T00:00:00Z\""),
            ],
            &[("Topic", "staleword here.")],
        ),
    );
    project.write(
        "notes/b-new.md",
        &typed("Bnew", &[("Notes", "Supersedes: doc:old")]),
    );
    project.write(
        "notes/a-new.md",
        &typed("Anew", &[("Notes", "Supersedes: doc:old")]),
    );

    assert_eq!(
        project.ok(&["search", "staleword"]),
        "notes/old#topic\tand\tdraft, stale, superseded by notes/a-new notes/b-new\tunverified\tOld › Topic\n"
    );
}

// No match is an answer, not an error: empty stdout and exit 0 in the text form, an empty list in
// `--json`, and still a log line, since a search that found nothing is what the usage summary
// counts.
#[test]
fn a_query_with_no_match_answers_empty_with_exit_zero_and_is_logged() {
    let project = three_hits();

    let text = project.run(&["search", "zzzqqq"]);
    let json = project.run(&["search", "zzzqqq", "--json"]);

    assert_eq!(
        (text.code, text.stdout.as_str(), text.stderr.as_str()),
        (0, "", "")
    );
    assert_eq!(json.code, 0);
    assert_eq!(json.stdout, "{\"results\":[]}\n");
    let lines = log_lines(&project);
    assert_eq!(lines.len(), 2);
    assert!(
        lines
            .iter()
            .all(|line| line.get("results") == Some(&json!([])))
    );
}

// The exact bytes: key order id, conceptId, docTitle, sectionTitle, status, trust, stale,
// matchPath, supersededBy, under one `results` key.
#[test]
fn the_json_form_has_the_pinned_keys_in_order() {
    let project = Project::notes();
    project.write(
        "notes/alpha.md",
        &typed("Alpha", &[("Topic", "alphaword here.")]),
    );

    assert_eq!(
        project.ok(&["search", "alphaword", "--json"]),
        "{\"results\":[{\"id\":\"notes/alpha#topic\",\"conceptId\":\"notes/alpha\",\"docTitle\":\"Alpha\",\"sectionTitle\":\"Topic\",\"status\":\"stable\",\"trust\":\"unverified\",\"stale\":false,\"matchPath\":\"and\",\"supersededBy\":[]}]}\n"
    );
}

// The preamble row's section title is the empty string, and `supersededBy` is a list of the
// documents that replace this one.
#[test]
fn a_preamble_row_has_an_empty_section_title_and_a_superseded_row_lists_its_replacements() {
    let project = supersession_project();
    project.write(
        "notes/old.md",
        "---\ntitle: Old\n---\npreword intro.\n\n## Later\nzzz.\n",
    );
    project.write(
        "notes/new.md",
        &typed("New", &[("Notes", "Supersedes: doc:old")]),
    );

    let results = results_of(&project.json(&["search", "preword"]));

    let first = results.first().expect("one result");
    assert_eq!(results.len(), 1);
    assert_eq!(first.get("sectionTitle"), Some(&json!("")));
    assert_eq!(first.get("supersededBy"), Some(&json!(["notes/new"])));
}

// Each row is one grade: a human `by` wins over any machine entry, a blank, missing, or
// non-string `by` and a non-object entry grade nothing, and the prefix is case-sensitive.
#[test]
fn trust_grades_follow_the_verified_entries() {
    let cases = [
        ("plain", None, "unverified"),
        ("machine", Some("{by: agent}"), "machine-verified"),
        ("human", Some("[{by: \"human:alice\"}]"), "human-reviewed"),
        (
            "mixed",
            Some("[{by: agent}, {by: \"human:bob\"}]"),
            "human-reviewed",
        ),
        ("blank", Some("{by: \" \"}"), "unverified"),
        ("empty", Some("{by: \"\"}"), "unverified"),
        ("number", Some("{by: 5}"), "unverified"),
        ("scalar", Some("[agent]"), "unverified"),
        ("flag", Some("true"), "unverified"),
        ("case", Some("{by: \"Human:alice\"}"), "machine-verified"),
        (
            "skipblank",
            Some("[{by: \" \"}, {by: agent}]"),
            "machine-verified",
        ),
    ];
    let project = Project::notes();
    for (name, verified, _) in cases {
        let mut front = vec![("title", name)];
        if let Some(value) = verified {
            front.push(("verified", value));
        }
        project.write(
            &format!("notes/{name}.md"),
            &doc(&front, &[("Topic", "trustword here.")]),
        );
    }
    project.write(
        "notes/generated.md",
        &doc(
            &[("title", "g"), ("generated", "{by: agent}")],
            &[("Topic", "trustword here.")],
        ),
    );

    let by_id: Vec<(String, String)> =
        results_of(&project.json(&["search", "--limit", "100", "trustword"]))
            .iter()
            .map(|result| (field(result, "id"), field(result, "trust")))
            .collect();

    for (name, _, trust) in cases {
        assert!(
            by_id.contains(&(format!("notes/{name}#topic"), trust.to_string())),
            "{name}: {by_id:?}"
        );
    }
    assert!(by_id.contains(&(
        "notes/generated#topic".to_string(),
        "unverified".to_string()
    )));
}

// `stale_after` is read as a time only in the ISO-8601 forms: a past one is stale, a future or
// absent one is not, and a string a lenient date parser would accept (`2000/01/01`, `Jan 1,
// 2000`) or a date that does not exist is not stale.
#[test]
fn stale_follows_an_iso_stale_after_only() {
    let cases = [
        ("date-past", Some("\"2000-01-01\""), true),
        ("datetime-past", Some("\"2000-01-01T00:00:00Z\""), true),
        ("unquoted-past", Some("2000-01-01T00:00:00Z"), true),
        ("minutes-past", Some("\"2000-01-01T00:00\""), true),
        ("no-zone-past", Some("\"2000-01-01T00:00:00\""), true),
        ("millis-past", Some("\"2000-01-01T00:00:00.500Z\""), true),
        ("offset-past", Some("\"2000-01-01T09:00:00+09:00\""), true),
        ("date-future", Some("\"2099-01-01\""), false),
        ("datetime-future", Some("\"2099-01-01T00:00:00Z\""), false),
        (
            "offset-future",
            Some("\"2099-01-01T00:00:00-05:00\""),
            false,
        ),
        ("slashes", Some("\"2000/01/01\""), false),
        ("prose", Some("\"Jan 1, 2000\""), false),
        ("word", Some("\"soon\""), false),
        ("month-13", Some("\"2000-13-01\""), false),
        ("empty", Some("\"\""), false),
        ("absent", None, false),
    ];
    let project = Project::notes();
    for (name, stale_after, _) in cases {
        let mut front = vec![("title", name)];
        if let Some(value) = stale_after {
            front.push(("stale_after", value));
        }
        project.write(
            &format!("notes/{name}.md"),
            &doc(&front, &[("Topic", "staleword here.")]),
        );
    }

    let stale: Vec<(String, bool)> =
        results_of(&project.json(&["search", "--limit", "100", "staleword"]))
            .iter()
            .map(|result| {
                (
                    field(result, "id"),
                    result
                        .get("stale")
                        .and_then(Value::as_bool)
                        .expect("stale is a bool"),
                )
            })
            .collect();

    for (name, _, expected) in cases {
        assert!(
            stale.contains(&(format!("notes/{name}#topic"), expected)),
            "{name}: {stale:?}"
        );
    }
}

// One line per answered search, table or `--json`: `at`, `command`, `query` (the words joined by
// one space), then each result's id and path in output order. The key order is part of the line.
#[test]
fn an_answered_search_appends_one_line_with_the_ids_and_paths_it_returned() {
    let project = three_hits();

    let table = project.ok(&["search", "needleword", "aa"]);
    project.ok(&["search", "--json", "zzzqqq"]);

    let lines = log_lines(&project);
    assert_eq!(lines.len(), 2);
    let first = lines.first().expect("a first line");
    assert!(is_iso_utc_millis(
        first.get("at").and_then(Value::as_str).expect("at")
    ));
    assert_eq!(first.get("command"), Some(&json!("search")));
    assert_eq!(first.get("query"), Some(&json!("needleword aa")));
    let expected: Vec<Value> = table
        .lines()
        .map(|row| {
            let mut columns = row.split('\t');
            json!({ "id": columns.next(), "matchPath": columns.next() })
        })
        .collect();
    assert_eq!(first.get("results"), Some(&Value::Array(expected)));
    assert!(project.read(LOG).starts_with("{\"at\":\""));
    assert!(project.read(LOG).contains(
        "\",\"command\":\"search\",\"query\":\"needleword aa\",\"results\":[{\"id\":\"notes/"
    ));
}

// A log that cannot be appended to (here a directory) leaves the answer as it was.
#[test]
fn an_unwritable_log_does_not_change_a_search_answer() {
    let expected = three_hits().ok(&["search", "needleword", "--json"]);
    let project = three_hits();
    project.write(&format!("{LOG}/occupied"), "");

    let out = project.run(&["search", "needleword", "--json"]);

    assert_eq!(
        (out.code, out.stdout, out.stderr),
        (0, expected, String::new())
    );
}

// What `search` writes is what `usage` reads: a search whose every row matched on `or` is a miss,
// and one that returned an `and` row is not.
#[test]
fn usage_counts_a_search_with_only_or_rows_as_a_miss() {
    let project = corpus(&[("a", topic("alpha beta.")), ("b", topic("alpha only."))]);

    project.ok(&["search", "alpha", "beta"]);
    project.ok(&["search", "alpha", "zzzqqq"]);

    assert_eq!(
        project.json(&["usage"]).pointer("/misses"),
        Some(&json!([{ "query": "alpha zzzqqq", "count": 1 }]))
    );
}

// Search reads the markdown on every run, with the same refusals as the other verbs.
#[test]
fn search_reads_the_documents_and_the_config_on_every_run() {
    let project = corpus(&[("a", topic("needleword here."))]);
    assert_eq!(ids(&project, &["needleword"]), ["notes/a#topic"]);

    project.write("notes/b.md", &topic("needleword there."));
    assert_eq!(
        ids(&project, &["needleword"]),
        ["notes/a#topic", "notes/b#topic"]
    );

    project.set_memory(&json!({ "include": ["other/**/*.md"] }));
    assert_eq!(ids(&project, &["needleword"]), Vec::<String>::new());
}

// The query words must refuse like any verb when there is no config or a bad include, and a
// refused call writes no log.
#[test]
fn search_refuses_without_a_usable_config() {
    let bare = Project::bare();
    let out = bare.run(&["search", "needleword"]);
    assert_eq!((out.code, out.stdout.as_str()), (2, ""));
    assert!(
        out.stderr.starts_with("pdks memory: no config in "),
        "{}",
        out.stderr
    );
    assert!(!bare.exists(".polydeukes"));

    let empty_include = Project::new(&json!({ "include": [] }));
    assert_refused(
        &empty_include.run(&["search", "needleword"]),
        INVALID_INCLUDE,
    );
    assert!(!empty_include.exists(".polydeukes"));
}

// One case per row of how a query is reduced. The document `all` holds exactly the expected terms,
// one document per term holds only that term, and each `absent` text holds none of the terms but
// would match if the word had been cut differently. `all` answers `and` only when no extra term
// was kept, a term-only document answers `or` only when its term was kept, and an `absent` text
// answers nothing only when the word was not cut there.
struct Reduction {
    query: &'static str,
    terms: &'static [&'static str],
    absent: &'static [&'static str],
}

const fn reduction(
    query: &'static str,
    terms: &'static [&'static str],
    absent: &'static [&'static str],
) -> Reduction {
    Reduction {
        query,
        terms,
        absent,
    }
}

#[test]
fn a_query_is_reduced_to_the_terms_a_document_would_hold() {
    let cases = [
        reduction("왜 cognee를 제거했나", &["cognee", "제거"], &[]),
        reduction(
            "세션이 잠기면 어떻게 복구하나요",
            &["세션", "잠기", "복구"],
            &[],
        ),
        reduction("COVENANT-14가 도입한 것은?", &["COVENANT-14", "도입"], &[]),
        reduction(
            "통합 디스패치는 왜 필요했나",
            &["통합", "디스패치", "필요"],
            &[],
        ),
        reduction("판정기는", &["판정기"], &["판정", "기"]),
        reduction("워크트리", &["워크트리"], &["워크", "트리"]),
        reduction("잠김을", &["잠김"], &["잠기"]),
        reduction("설정됨을", &["설정됨"], &["설정"]),
        reduction("`--delete`를", &["--delete"], &[]),
        reduction("디스패치(W1)의", &["디스패치", "W1"], &[]),
        reduction("field·filter로", &["field", "filter"], &[]),
        reduction(
            "packages/memory의 구조",
            &["packages/memory", "구조"],
            &["packages memory"],
        ),
        reduction("foo_bar의", &["foo_bar"], &["foo bar", "foo"]),
        reduction(".claude/rules를", &[".claude/rules"], &["claude rules"]),
        reduction("ISSUE-63b", &["ISSUE-63b"], &["issue 63b"]),
        reduction(
            "search-memory.ts",
            &["search-memory.ts"],
            &["search-memory"],
        ),
        reduction(
            "Why did the adapter's typecheck stay green",
            &["adapter", "typecheck", "stay", "green"],
            &[],
        ),
        reduction("x drift", &["drift"], &[]),
        reduction("why adapter's 복구하나요", &["adapter", "복구"], &["why"]),
        reduction(
            "snapshot adapter's adapter snapshot",
            &["snapshot", "adapter"],
            &[],
        ),
        reduction("why the", &["why", "the"], &[]),
        reduction("얼마 다시", &["얼마", "다시"], &[]),
        reduction("된다", &["된다"], &[]),
    ];
    for case in cases {
        let mut docs = vec![("all".to_string(), topic(&case.terms.join(" ")))];
        if case.terms.len() > 1 {
            for (i, term) in case.terms.iter().enumerate() {
                docs.push((format!("only-{i}"), topic(term)));
            }
        }
        for (i, text) in case.absent.iter().enumerate() {
            docs.push((format!("absent-{i}"), topic(text)));
        }
        let borrowed: Vec<(&str, String)> = docs
            .iter()
            .map(|(name, text)| (name.as_str(), text.clone()))
            .collect();
        let project = corpus(&borrowed);

        let got = as_set(&found(&project, &[case.query]));

        let mut expected = vec![("notes/all#topic".to_string(), "and".to_string())];
        if case.terms.len() > 1 {
            for i in 0..case.terms.len() {
                expected.push((format!("notes/only-{i}#topic"), "or".to_string()));
            }
        }
        assert_eq!(got, as_set(&expected), "{}", case.query);
    }
}

// A Korean question is answered by every section that holds one of its reduced terms. The one
// holding both ranks first and is `and`; a two-character term in the body is a text match, so it
// is `and`, never `like`.
// A one-character or stopword-only query reduces to nothing and is searched as written: a
// predicate over no terms would match every section.
#[test]
fn a_query_that_reduces_to_nothing_is_searched_as_written_and_a_blank_one_matches_nothing() {
    let project = corpus(&[
        ("a", topic("x marks a spot.")),
        ("b", topic("plain stuff.")),
        ("c", topic("the why of it.")),
        ("d", topic("only the.")),
    ]);

    assert_eq!(found(&project, &["x"]), pairs(&[("notes/a#topic", "and")]));
    assert_eq!(
        found(&project, &["why the"]),
        pairs(&[("notes/c#topic", "and"), ("notes/d#topic", "or")])
    );
    for blank in ["", " ", "  "] {
        let out = project.run(&["search", blank]);
        assert_eq!(
            (out.code, out.stdout.as_str(), out.stderr.as_str()),
            (0, "", ""),
            "{blank:?}"
        );
        assert_eq!(
            project.run(&["search", blank, "--json"]).stdout,
            "{\"results\":[]}\n"
        );
    }
}

// A query splits where a JavaScript `\s` does: U+FEFF separates words and U+0085 does not.
#[test]
fn a_query_splits_on_javascript_whitespace() {
    let project = corpus(&[("a", topic("cognee and foo bar."))]);

    assert_eq!(
        found(&project, &["\u{feff}cognee"]),
        pairs(&[("notes/a#topic", "and")])
    );
    assert_eq!(
        found(&project, &["foo\u{85}bar"]),
        Vec::<(String, String)>::new()
    );
}

// An identifier query returns from reduction unchanged, so it stays on the literal path where the
// section holding more of the words ranks first even though a body of one repeated word scores
// better. Surrounding and repeated whitespace do not move it.
#[test]
fn an_identifier_query_ranks_by_matched_words_before_score() {
    let project = corpus(&[
        ("a", topic(&long("T-260901 and MQ-568 both."))),
        ("b", topic("T-260901 T-260901 T-260901.")),
    ]);

    assert_eq!(
        found(&project, &["  T-260901   MQ-568 "]),
        pairs(&[("notes/a#topic", "and"), ("notes/b#topic", "or")])
    );
}

// Words dropped as stopwords leave the words as written; a repeated written word counts once, so
// `a` (one distinct word) and `b` (one distinct word) tie on matched words and the score decides.
// Counting `why` twice would put `a` first.
#[test]
fn a_repeated_literal_word_counts_once_in_the_matched_word_count() {
    let project = corpus(&[("a", topic(&long("why"))), ("b", topic("the the the."))]);

    assert_eq!(
        found(&project, &["why", "why", "the"]),
        pairs(&[("notes/b#topic", "or"), ("notes/a#topic", "or")])
    );
}

// The sections holding every word come first, then those holding some, in matched-word order;
// the cut falls after the sort, so with a limit of two the full matches `z` and `a` stay and the
// higher-scoring one-word `m` is cut.
#[test]
fn the_literal_path_ranks_more_matched_words_first_and_cuts_after_sorting() {
    let project = corpus(&[
        ("a", topic(&long("alpha beta"))),
        ("m", topic("alpha alpha alpha alpha alpha.")),
        ("z", topic("alpha alpha beta beta.")),
    ]);

    assert_eq!(
        results_of(&project.json(&["search", "--limit", "2", "alpha", "beta"]))
            .iter()
            .map(|result| (field(result, "id"), field(result, "matchPath")))
            .collect::<Vec<_>>(),
        pairs(&[("notes/z#topic", "and"), ("notes/a#topic", "and")])
    );
    assert_eq!(
        found(&project, &["alpha", "beta"]),
        pairs(&[
            ("notes/z#topic", "and"),
            ("notes/a#topic", "and"),
            ("notes/m#topic", "or")
        ])
    );
}

// Two-word sections come before a one-word section that scores better: `d` repeats the rarest
// word in a short body, `a` and `c` carry two words in long ones. Among the one-word sections the
// score decides (`d` before `b`).
#[test]
fn two_matched_words_outrank_a_better_scoring_single_word() {
    let project = corpus(&[
        ("a", topic(&long("companion chat one-shot relay"))),
        ("b", topic(&long("companion chat relay"))),
        ("c", topic(&long("companion chat one-shot"))),
        ("d", topic("billing billing billing.")),
    ]);

    let got = found(&project, &["companion", "one-shot", "billing"]);

    assert_eq!(
        as_set(&got.iter().take(2).cloned().collect::<Vec<_>>()),
        as_set(&pairs(&[("notes/a#topic", "or"), ("notes/c#topic", "or")]))
    );
    assert_eq!(
        got.iter().skip(2).cloned().collect::<Vec<_>>(),
        pairs(&[("notes/d#topic", "or"), ("notes/b#topic", "or")])
    );
}

// A reduced query ranks by the sum of its terms' scores and never by matched-word count: `a`
// repeats one term in a short body and outscores `z`, which holds both among the filler.
#[test]
fn a_reduced_query_ranks_by_score_and_not_by_matched_word_count() {
    let project = corpus(&[
        ("a", topic("drift drift drift drift drift drift.")),
        ("z", topic(&long("drift snapshot"))),
    ]);

    assert_eq!(
        found(&project, &["the drift snapshot"]),
        pairs(&[("notes/a#topic", "or"), ("notes/z#topic", "and")])
    );
}

// The terms' scores add: both bodies hold `drift` once in one length, so only the second term
// moves `z` ahead of `a`, which would win the id tie.
#[test]
fn a_section_matched_on_two_reduced_terms_outranks_one_matched_on_one() {
    let project = corpus(&[
        ("a", topic("drift aa aa aa aa.")),
        ("z", topic("drift snapshot aa.")),
    ]);

    assert_eq!(
        ids(&project, &["the drift snapshot"]),
        ["notes/z#topic", "notes/a#topic"]
    );
}

// A repeated reduced term counts once: `alpha's` reduces to `alpha`, the same as the word before
// it. Scored twice, `a` (four `alpha`) would beat `b` (six `beta`).
#[test]
fn a_term_repeated_after_reduction_is_scored_once() {
    let project = corpus(&[
        ("a", topic("alpha alpha alpha alpha.")),
        ("b", topic("beta beta beta beta beta beta.")),
    ]);

    assert_eq!(
        ids(&project, &["alpha beta alpha's"]),
        ["notes/b#topic", "notes/a#topic"]
    );
}

// Each term appears in a title or an identifier but not the body, in any ASCII case, as a
// substring of a longer word; a document title match holds for every section of the document,
// and a section with an empty body is found by its heading.
#[test]
fn a_term_matches_a_substring_of_either_title_and_an_empty_section_is_found_by_its_heading() {
    let project = corpus(&[
        (
            "t1",
            page(
                "Zebraword guide",
                &[("Topic", "other."), ("Second", "more.")],
            ),
        ),
        ("t2", page(SAME, &[("Zebraword", "other.")])),
        ("t3", topic("xx ZebraWord xx")),
        ("t4", topic("unrelated.")),
        ("t5", page(SAME, &[("Quokkaword", "")])),
    ]);

    let mut hit = ids(&project, &["zebra"]);
    hit.sort();

    assert_eq!(
        hit,
        [
            "notes/t1#second",
            "notes/t1#topic",
            "notes/t2#zebraword",
            "notes/t3#topic"
        ]
    );
    assert_eq!(ids(&project, &["QUOKKAWORD"]), ["notes/t5#quokkaword"]);
}

// Only ASCII letters fold: `ÉCOLE` matches the text with the same `É` and any case of the rest,
// not `école`.
#[test]
fn only_ascii_letters_match_regardless_of_case() {
    let project = corpus(&[
        ("ascii", topic("NeedleWord here.")),
        ("lower", topic("école here.")),
        ("upper", topic("ÉCOLE here.")),
        ("mixed", topic("École here.")),
    ]);

    assert_eq!(ids(&project, &["NEEDLEWORD"]), ["notes/ascii#topic"]);
    let mut accented = ids(&project, &["ÉCOLE"]);
    accented.sort();
    assert_eq!(accented, ["notes/mixed#topic", "notes/upper#topic"]);
    assert_eq!(ids(&project, &["école"]), ["notes/lower#topic"]);
}

// A term that starts a section or document id matches that section. An id match with text on the
// same term is `and`; with no text it is `like` (all terms matched) or `or` (a term missing), and
// scores zero, behind every text match and ordered by id among themselves.
#[test]
fn an_identifier_prefix_alone_is_like_and_scores_behind_text_matches() {
    let project = corpus(&[
        ("qz-a", topic("plain text.")),
        ("qz-b", topic("plain text.")),
        ("zz-text", topic("see notes/qz here.")),
    ]);

    assert_eq!(
        found(&project, &["notes/qz"]),
        pairs(&[
            ("notes/zz-text#topic", "and"),
            ("notes/qz-a#topic", "like"),
            ("notes/qz-b#topic", "like"),
        ])
    );
    assert_eq!(
        ids(&project, &["NOTES/QZ-A"]),
        ["notes/qz-a#topic"],
        "the id prefix ignores ASCII case"
    );
}

// The path of a row with several terms: `or` when a term is missing even if another matched by id,
// `like` when all matched and one only by id, `and` when the id-matched term is also in the text.
#[test]
fn the_path_of_a_row_follows_its_missing_and_id_only_terms() {
    let project = corpus(&[
        ("qz-a", topic("plain text.")),
        ("qz-ab", topic("needleword here.")),
        ("qz-ac", topic("needleword and notes/qz-a here.")),
        ("other", topic("needleword here.")),
    ]);

    let got = found(&project, &["notes/qz-a", WORD]);

    assert_eq!(
        as_set(&got),
        as_set(&pairs(&[
            ("notes/qz-a#topic", "or"),
            ("notes/qz-ab#topic", "like"),
            ("notes/qz-ac#topic", "and"),
            ("notes/other#topic", "or"),
        ]))
    );
    assert_eq!(
        got.iter()
            .skip(2)
            .map(|(id, _)| id.as_str())
            .collect::<Vec<_>>(),
        ["notes/other#topic", "notes/qz-a#topic"]
    );
}

// More occurrences rank first at equal length, counted in any ASCII case; a lowercase and an
// uppercase query give the same order, and the id order (`a` first) is the opposite.
#[test]
fn more_occurrences_rank_first_at_equal_length_in_any_case() {
    let project = corpus(&[
        ("a", topic("qz aa aa aa aa.")),
        ("z", topic("QZ Qz qZ aa aa.")),
    ]);

    assert_eq!(ids(&project, &["qz"]), ["notes/z#topic", "notes/a#topic"]);
    assert_eq!(ids(&project, &["QZ"]), ["notes/z#topic", "notes/a#topic"]);
}

// A term that matches every chunk has a raw idf below zero. The floor keeps the score ordered by
// occurrences: no floor puts `a` first (positive scores), a floor at zero ties and `a` wins by id.
#[test]
fn a_term_in_every_section_still_ranks_by_occurrences() {
    let project = Project::notes();
    project.write("notes/a.md", &topic("qz aa aa aa aa."));
    project.write("notes/z.md", &topic("qz qz qz aa aa."));

    assert_eq!(ids(&project, &["qz"]), ["notes/z#topic", "notes/a#topic"]);
}

// The shorter section ranks first at equal occurrences: no length normalisation ties them, and
// `a` wins by id.
#[test]
fn the_shorter_section_ranks_first_at_equal_occurrences() {
    let project = corpus(&[
        ("a", topic("qz aa aa aa aa aa aa aa.")),
        ("z", topic("qz.")),
    ]);

    assert_eq!(ids(&project, &["qz"]), ["notes/z#topic", "notes/a#topic"]);
}

// Occurrences in the document title and in the section heading count, not only the body: `y` has
// three in the document title, `z` three in the heading, `a` one in the body. Counting the body
// alone leaves `y` and `z` with none.
#[test]
fn occurrences_in_the_titles_count() {
    let project = corpus(&[
        ("a", topic("qz aa aa aa aa.")),
        ("y", page("qz qz qz", &[("Topic", "aa aa aa aa aa.")])),
        ("z", page(SAME, &[("qz qz qz", "aa aa aa aa aa.")])),
    ]);

    assert_eq!(
        ids(&project, &["qz"]),
        ["notes/y#topic", "notes/z#qz-qz-qz", "notes/a#topic"]
    );
}

// A two-character and a longer term are scored on one scale. `z` holds `qz` in a short chunk and
// `y` holds `needleword` twice; the answer is `z` first, while a length counted in characters or an
// average taken over matched chunks only puts `y` first. `y` sorts before `z` by id.
#[test]
fn a_short_term_and_a_long_term_share_one_scale() {
    let project = Project::notes();
    project.write("notes/y.md", &page("y", &[("Y", "needleword needleword")]));
    project.write("notes/z.md", &page("Sd", &[("X", "qz aa.")]));
    for i in 1..=3 {
        project.write(
            &format!("notes/f{i}.md"),
            &page("F", &[("One", "filler filler filler")]),
        );
    }

    assert_eq!(ids(&project, &["qz", WORD]), ["notes/z#x", "notes/y#y"]);
}

// With no occurrence ahead, a 2-character term breaks the tie of a mixed query: the long term's
// score is the same in both sections.
// A section of four 1,399-character blocks scores as its best chunk. The same four occurrences
// in one block outrank the same four spread one per block, which would tie at section level and
// let `a-spread` win by id.
#[test]
fn occurrences_concentrated_in_one_chunk_outrank_the_same_count_spread() {
    let dense = [
        paragraph(&[
            (10, "needle"),
            (50, "needle"),
            (100, "needle"),
            (150, "needle"),
        ]),
        paragraph(&[]),
        paragraph(&[]),
        paragraph(&[]),
    ]
    .join("\n\n");
    let spread = (0..4)
        .map(|_| paragraph(&[(10, "needle")]))
        .collect::<Vec<_>>()
        .join("\n\n");
    let project = Project::notes();
    project.write("notes/z-dense.md", &page("Doc D", &[("Topic", &dense)]));
    project.write("notes/a-spread.md", &page("Doc S", &[("Topic", &spread)]));
    let blank = (0..8)
        .map(|_| paragraph(&[]))
        .collect::<Vec<_>>()
        .join("\n\n");
    project.write("notes/filler.md", &page("Doc F", &[("Topic", &blank)]));

    assert_eq!(
        ids(&project, &["needle"]),
        ["notes/z-dense#topic", "notes/a-spread#topic"]
    );
}

// Terms add inside one chunk before the best chunk is chosen: `z-joined` has both in one block,
// `a-split` has each in its own; adding each term's best chunk would tie them.
#[test]
fn terms_matched_in_one_chunk_add_before_the_best_chunk_is_chosen() {
    let split = [
        paragraph(&[(10, "quartz"), (50, "quartz"), (90, "quartz")]),
        paragraph(&[(10, "zephyr"), (50, "zephyr"), (90, "zephyr")]),
    ]
    .join("\n\n");
    let joined = [
        paragraph(&[
            (10, "quartz"),
            (50, "quartz"),
            (90, "quartz"),
            (20, "zephyr"),
            (60, "zephyr"),
            (100, "zephyr"),
        ]),
        paragraph(&[]),
    ]
    .join("\n\n");
    let project = Project::notes();
    project.write("notes/a-split.md", &page("Doc A", &[("Topic", &split)]));
    project.write("notes/z-joined.md", &page("Doc Z", &[("Topic", &joined)]));
    let blank = (0..6)
        .map(|_| paragraph(&[]))
        .collect::<Vec<_>>()
        .join("\n\n");
    project.write("notes/filler.md", &page("Doc F", &[("Topic", &blank)]));

    assert_eq!(
        found(&project, &["quartz", "zephyr"]),
        pairs(&[
            ("notes/z-joined#topic", "and"),
            ("notes/a-split#topic", "and")
        ])
    );
}

// A section matched in several chunks by several terms is one result.
// Length is counted in characters, not bytes or UTF-16 units. The three bodies have the same
// 1,515 characters and the same four `needle` positions in words of two Korean, two ASCII, or two
// emoji characters; they tie, so the id order decides. Counted in bytes (or UTF-16 units) the
// Korean (the emoji) body is over 2,000, split in chunks, and sinks below the ASCII one.
#[test]
fn length_and_chunks_count_characters_not_bytes() {
    let placed = [
        (10, "needle"),
        (100, "needle"),
        (400, "needle"),
        (480, "needle"),
    ];
    let project = Project::notes();
    for (name, title, word) in [
        ("a-ko", "Doc K", "필러"),
        ("m-emoji", "Doc M", "😀😀"),
        ("z-ascii", "Doc A", "ab"),
    ] {
        project.write(
            &format!("notes/{name}.md"),
            &page(title, &[("Topic", &words(500, word, &placed))]),
        );
    }
    project.write(
        "notes/filler.md",
        &page(
            "Doc F",
            &[("One", "nothing here."), ("Two", "nothing here.")],
        ),
    );

    assert_eq!(
        ids(&project, &["needle"]),
        [
            "notes/a-ko#topic",
            "notes/m-emoji#topic",
            "notes/z-ascii#topic"
        ]
    );
}

// The type weight is subtracted once, by its mapped name. `a` (typed `prd`) scores 0.256 behind
// `b`: a weight of 0.15 leaves `b` first, so a weight taken twice (0.30) or taken as a factor
// would reorder them; 0.3 flips it.
#[test]
fn a_type_weight_is_subtracted_once_from_the_section_score() {
    let docs = [
        (
            "a",
            doc(
                &[("title", SAME), ("type", "prd")],
                &[("Topic", "needleword aa aa aa aa.")],
            ),
        ),
        ("b", topic("needleword needleword aa aa aa.")),
    ];
    // `the needleword` reduces to `needleword`, so it takes the reduced-query path; both paths
    // apply the same weight.
    let order = |weight: f64| {
        let project = corpus(&docs);
        project.set_memory(&json!({ "include": [NOTES_INCLUDE], "weights": { "prd": weight } }));
        let literal = ids(&project, &[WORD]);
        assert_eq!(ids(&project, &["the needleword"]), literal);
        literal
    };

    assert_eq!(
        ids(&corpus(&docs), &[WORD]),
        ["notes/b#topic", "notes/a#topic"]
    );
    assert_eq!(order(0.15), ["notes/b#topic", "notes/a#topic"]);
    assert_eq!(order(0.3), ["notes/a#topic", "notes/b#topic"]);
}

// `typeMap` renames the type before the weight is looked up, so `b` (typed `guide`, mapped to
// `howto`) gets nothing from the weight named `guide`; a type no weight names, including one
// spelled like an object member, adds nothing; the weight changes neither hits nor paths, and
// a deprecated section stays last whatever its weight.
#[test]
fn weights_apply_to_the_mapped_type_and_never_lift_a_deprecated_section() {
    let project = Project::new(&json!({
        "include": [NOTES_INCLUDE],
        "typeMap": { "decision": "reference", "guide": "howto" },
        "weights": { "reference": 4, "guide": 4 }
    }));
    project.write(
        "notes/a.md",
        &doc(
            &[("title", SAME), ("type", "toString")],
            &[("Topic", "needleword here.")],
        ),
    );
    project.write(
        "notes/b.md",
        &doc(
            &[("title", SAME), ("type", "guide")],
            &[("Topic", "needleword here.")],
        ),
    );
    project.write(
        "notes/z.md",
        &doc(
            &[("title", SAME), ("type", "decision")],
            &[("Topic", "needleword here.")],
        ),
    );
    project.write(
        "notes/d.md",
        &doc(
            &[
                ("title", SAME),
                ("type", "decision"),
                ("status", "deprecated"),
            ],
            &[("Topic", "needleword here.")],
        ),
    );
    for i in 0..3 {
        project.write(
            &format!("notes/filler-{i}.md"),
            &page(
                "Filler",
                &[("One", "nothing here."), ("Two", "nothing here.")],
            ),
        );
    }

    assert_eq!(
        found(&project, &[WORD]),
        pairs(&[
            ("notes/z#topic", "and"),
            ("notes/a#topic", "and"),
            ("notes/b#topic", "and"),
            ("notes/d#topic", "and"),
        ])
    );
}

// Weights apply when every column is shorter than three characters, where the mean length is
// zero: a 0/0 ratio would turn each score into NaN and drop the weight, leaving the id order.
#[test]
fn a_weight_survives_a_corpus_with_no_text_longer_than_two_characters() {
    let project = Project::new(&json!({ "include": [NOTES_INCLUDE], "weights": { "prd": 5 } }));
    project.write("notes/b.md", "---\ntitle: qz\ntype: prd\n---\n## B\n");
    project.write("notes/a.md", "---\ntitle: qz\n---\n## B\n");

    assert_eq!(ids(&project, &["qz"]), ["notes/b#b", "notes/a#b"]);
}

// Deprecated sections come last whatever their score, and equal scores fall to the id in byte
// order (`Bb` before `aa`).
#[test]
fn deprecated_sections_come_last_and_equal_scores_fall_to_the_id() {
    let project = corpus(&[
        (
            "z",
            doc(
                &[("title", SAME), ("status", "deprecated")],
                &[("Topic", "sharedphrase.")],
            ),
        ),
        ("b", topic("sharedphrase.")),
        ("a", topic("sharedphrase.")),
    ]);
    let ordered = corpus(&[
        ("Bb", topic("sharedphrase.")),
        ("aa", topic("sharedphrase.")),
    ]);

    let results = results_of(&project.json(&["search", "sharedphrase"]));

    assert_eq!(
        results
            .iter()
            .map(|result| (field(result, "id"), field(result, "status")))
            .collect::<Vec<_>>(),
        pairs(&[
            ("notes/a#topic", "stable"),
            ("notes/b#topic", "stable"),
            ("notes/z#topic", "deprecated"),
        ])
    );
    assert_eq!(
        ids(&ordered, &["sharedphrase"]),
        ["notes/Bb#topic", "notes/aa#topic"]
    );
    assert_eq!(
        ids(&project, &["the sharedphrase"]),
        ["notes/a#topic", "notes/b#topic", "notes/z#topic"],
        "the reduced-query path puts the deprecated section last too"
    );
}

// A full match that is deprecated follows a partial match that is not.
#[test]
fn a_deprecated_full_match_follows_a_live_partial_match() {
    let project = corpus(&[
        (
            "a",
            doc(
                &[("title", SAME), ("status", "deprecated")],
                &[("Topic", "alpha beta.")],
            ),
        ),
        ("z", topic("alpha only.")),
    ]);

    assert_eq!(
        found(&project, &["alpha", "beta"]),
        pairs(&[("notes/z#topic", "or"), ("notes/a#topic", "and")])
    );
}

// `%`, `_`, and quotes in a query are text, not pattern syntax: a pattern reading would match
// every section for `%`, and every section with one more character for `_`.
// A term matched only by the start of a section id is `like` on the reduced-query path as well:
// `제거-note` holds `cognee` in its body and `제거` only as the start of its id, `b` holds `cognee`
// alone. Documents sit at the project root here so an id can begin with the term.
#[test]
fn on_the_reduced_path_a_term_matched_only_by_an_id_prefix_is_like() {
    let project = Project::new(&json!({ "include": ["*.md"] }));
    project.write("제거-note.md", &topic("cognee here."));
    project.write("b.md", &topic("cognee 도입."));
    project.write("filler.md", &page("Filler", &[("One", "nothing here.")]));

    assert_eq!(
        as_set(&found(&project, &["왜 cognee를 제거했나"])),
        as_set(&pairs(&[("제거-note#topic", "like"), ("b#topic", "or")]))
    );
}

fn chain_corpus(project: &Project) {
    for (name, marker) in [
        ("z-newest", "Supersedes: doc:a-old and doc:b-older"),
        ("a-old", "Supersedes: doc:b-older"),
        ("b-older", ""),
        ("y-plain", ""),
    ] {
        let text = if marker.is_empty() {
            typed(SAME, &[("Topic", "needleword here.")])
        } else {
            typed(SAME, &[("Topic", "needleword here."), ("Notes", marker)])
        };
        project.write(&format!("notes/{name}.md"), &text);
    }
    project.write(
        "notes/c-deprecated.md",
        &doc(
            &[("title", SAME), ("type", "note"), ("status", "deprecated")],
            &[("Topic", "needleword here.")],
        ),
    );
    for i in 0..3 {
        project.write(
            &format!("notes/filler-{i}.md"),
            &page(
                "Filler",
                &[("One", "nothing here."), ("Two", "nothing here.")],
            ),
        );
    }
}

// A superseded section sorts with the deprecated ones, behind every other result, and names the
// documents that directly replace it, sorted: `b-older` lists `a-old` and `z-newest`, not one of
// them twice. The newer side stays in front. Without the declaration rule the same corpus ranks
// by id with only the deprecated section last and nothing superseded.
#[test]
fn superseded_sections_rank_with_the_deprecated_and_name_their_direct_replacements() {
    let project = supersession_project();
    chain_corpus(&project);

    let ranked: Vec<(String, Value)> = results_of(&project.json(&["search", "needleword"]))
        .iter()
        .map(|result| {
            (
                field(result, "id"),
                result.get("supersededBy").cloned().expect("supersededBy"),
            )
        })
        .collect();

    assert_eq!(
        ranked,
        vec![
            ("notes/y-plain#topic".to_string(), json!([])),
            ("notes/z-newest#topic".to_string(), json!([])),
            ("notes/a-old#topic".to_string(), json!(["notes/z-newest"])),
            (
                "notes/b-older#topic".to_string(),
                json!(["notes/a-old", "notes/z-newest"])
            ),
            ("notes/c-deprecated#topic".to_string(), json!([])),
        ]
    );

    let ruled = as_set(&found(&project, &[WORD]));
    project.set_memory(&json!({ "include": [NOTES_INCLUDE] }));
    assert_eq!(as_set(&found(&project, &[WORD])), ruled);
    let plain = results_of(&project.json(&["search", "needleword"]));
    assert_eq!(
        plain.iter().map(|r| field(r, "id")).collect::<Vec<_>>(),
        [
            "notes/a-old#topic",
            "notes/b-older#topic",
            "notes/y-plain#topic",
            "notes/z-newest#topic",
            "notes/c-deprecated#topic"
        ]
    );
    assert!(
        plain
            .iter()
            .all(|r| r.get("supersededBy") == Some(&json!([])))
    );
}

// Superseded is a partition, not a score penalty: `s-old` (six occurrences) and `r-older` (three)
// outscore the plain sections yet stay behind them, in score order inside the superseded tier.
#[test]
fn a_superseded_section_stays_behind_a_plain_one_it_outscores() {
    let project = supersession_project();
    project.write(
        "notes/t-new.md",
        &typed(
            SAME,
            &[
                ("Topic", "needleword here."),
                ("Notes", "Supersedes: doc:s-old and doc:r-older"),
            ],
        ),
    );
    project.write(
        "notes/s-old.md",
        &typed(
            SAME,
            &[(
                "Topic",
                "needleword needleword needleword needleword needleword needleword.",
            )],
        ),
    );
    project.write(
        "notes/r-older.md",
        &typed(SAME, &[("Topic", "needleword needleword needleword.")]),
    );
    project.write(
        "notes/u-plain.md",
        &typed(SAME, &[("Topic", "needleword once.")]),
    );
    for i in 0..3 {
        project.write(
            &format!("notes/filler-{i}.md"),
            &page(
                "Filler",
                &[("One", "nothing here."), ("Two", "nothing here.")],
            ),
        );
    }

    project.set_memory(&json!({ "include": [NOTES_INCLUDE] }));
    assert_eq!(
        ids(&project, &[WORD]).iter().take(2).collect::<Vec<_>>(),
        ["notes/s-old#topic", "notes/r-older#topic"],
        "without the rule the better-scoring sections lead"
    );
    project.set_memory(&supersession_memory());
    let ranked = ids(&project, &[WORD]);

    assert_eq!(
        ranked.iter().skip(2).collect::<Vec<_>>(),
        ["notes/s-old#topic", "notes/r-older#topic"]
    );
    let mut head: Vec<String> = ranked.iter().take(2).cloned().collect();
    head.sort();
    assert_eq!(head, ["notes/t-new#topic", "notes/u-plain#topic"]);
}

/// A body of exactly `total` characters as parsed (the writer adds one trailing newline, so
/// the text is one shorter): `head`, a run of two-letter words, then `tail`.
fn text_of_len(total: usize, head: &str, tail: &str) -> String {
    let middle = total - head.len() - tail.len() - 2;
    let filler = format!("{}{}", "ab ".repeat(middle / 3), "a".repeat(middle % 3));
    format!("{head} {filler} {tail}")
}

// Level two of the split: a body with no blank line is cut at its line breaks, one chunk per
// 1,399-character line. Cut at blank lines only, the body stays one chunk, the four `needle`
// occurrences tie with the four spread one per line, and `a-spread` wins by id.
#[test]
fn a_body_with_no_blank_line_is_split_at_its_line_breaks() {
    let dense = [
        paragraph(&[
            (10, "needle"),
            (50, "needle"),
            (100, "needle"),
            (150, "needle"),
        ]),
        paragraph(&[]),
        paragraph(&[]),
        paragraph(&[]),
    ]
    .join("\n");
    let spread = (0..4)
        .map(|_| paragraph(&[(10, "needle")]))
        .collect::<Vec<_>>()
        .join("\n");
    let project = Project::notes();
    project.write("notes/z-dense.md", &page("Doc D", &[("Topic", &dense)]));
    project.write("notes/a-spread.md", &page("Doc S", &[("Topic", &spread)]));
    let blank = (0..8)
        .map(|_| paragraph(&[]))
        .collect::<Vec<_>>()
        .join("\n");
    project.write("notes/filler.md", &page("Doc F", &[("Topic", &blank)]));

    assert_eq!(
        ids(&project, &["needle"]),
        ["notes/z-dense#topic", "notes/a-spread#topic"]
    );
}

// Level three: one line of 6,999 characters is cut at spaces into chunks of at most 2,000. Left
// whole it ties the dense and spread bodies, and `a-spread` wins by id.
#[test]
fn a_single_long_line_is_split_at_whitespace() {
    let dense = words(
        1000,
        "filler",
        &[
            (10, "needle"),
            (50, "needle"),
            (100, "needle"),
            (150, "needle"),
        ],
    );
    let spread = words(
        1000,
        "filler",
        &[
            (10, "needle"),
            (300, "needle"),
            (600, "needle"),
            (900, "needle"),
        ],
    );
    let project = Project::notes();
    project.write("notes/z-dense.md", &page("Doc D", &[("Topic", &dense)]));
    project.write("notes/a-spread.md", &page("Doc S", &[("Topic", &spread)]));
    project.write(
        "notes/filler.md",
        &page("Doc F", &[("Topic", &words(1000, "filler", &[]))]),
    );

    assert_eq!(
        ids(&project, &["needle"]),
        ["notes/z-dense#topic", "notes/a-spread#topic"]
    );
}

// A short piece, an over-limit piece, and a short piece: the long piece is re-split among its own
// parts and never packed with a neighbour. `p1` and `p2` each hold `alphaterm` in a short piece
// and `betaterm` in the long one, so a correct split gives each a strong short single-term chunk
// (about -2.2). Packed with a neighbour the two terms share one 2,000-character chunk and the
// section falls to about -0.8 or -1.6. The reference `r` (both terms in one 112-word chunk,
// about -1.9) sits between: it ranks last for a correct split and ahead of both otherwise.
#[test]
fn the_parts_of_an_over_limit_piece_are_never_packed_with_its_neighbours() {
    let long_piece = |at: usize| words(360, "filler", &[(at, "betaterm")]);
    let project = corpus(&[
        (
            "p1",
            topic(&format!(
                "alphaterm opens this short piece.\n\n{}\n\nclosing short piece.",
                long_piece(0)
            )),
        ),
        (
            "p2",
            topic(&format!(
                "opening short piece.\n\n{}\n\nalphaterm closes this short piece.",
                long_piece(359)
            )),
        ),
        (
            "r",
            // The two terms sit at the first and last of 112 words, so the proximity
            // adjustment of this reference chunk is nil and its score stays about -1.9.
            topic(&words(
                112,
                "filler",
                &[(0, "alphaterm"), (111, "betaterm")],
            )),
        ),
    ]);

    let ranked = ids(&project, &["alphaterm", "betaterm"]);

    assert_eq!(ranked.len(), 3);
    assert_eq!(ranked.last().map(String::as_str), Some("notes/r#topic"));
    let mut head: Vec<String> = ranked.iter().take(2).cloned().collect();
    head.sort();
    assert_eq!(head, ["notes/p1#topic", "notes/p2#topic"]);
}

// A run with no whitespace stays one chunk however long, so a term laid over character 2,000 is
// found. Cut at 2,000 the term is lost, and in the Korean body a cut by bytes lands inside a
// character.
#[test]
fn a_whitespace_free_run_over_the_limit_stays_whole_and_is_found_across_character_2000() {
    let ko = format!("{}needle{}", "가".repeat(1997), "가".repeat(997));
    let ascii = format!("{}needle{}", "a".repeat(1997), "a".repeat(997));
    let project = corpus(&[("ko", topic(&ko)), ("ascii", topic(&ascii))]);

    assert_eq!(
        found(&project, &["needle"]),
        pairs(&[("notes/ascii#topic", "and"), ("notes/ko#topic", "and")])
    );
}

// The limit is 2,000 characters of the parsed body: `z-exact` is exactly 2,000 and holds both
// terms in one chunk, `a-over` is 2,001 and splits in two, one term to each chunk, the second
// term in a 300-character chunk of its own. `z-exact` ranks first although its id is larger
// (about -1.63 against -1.27). A limit one lower splits `z-exact` too and one higher keeps
// `a-over` whole: both answer `a-over` first. `z-exact`'s title is one character longer, so the
// two tie exactly in those cases and the id decides.
#[test]
fn a_body_of_2000_characters_is_one_chunk_and_one_of_2001_is_two() {
    let head = "alphaterm alphaterm alphaterm alphaterm";
    let tail = format!("betaterm{}", "z".repeat(300));
    let exact = text_of_len(2000, head, &tail);
    let over = text_of_len(2001, head, &tail);
    let project = corpus(&[
        ("z-exact", page("Same docs", &[("Topic", &exact)])),
        ("a-over", topic(&over)),
    ]);

    assert_eq!(
        ids(&project, &["alphaterm", "betaterm"]),
        ["notes/z-exact#topic", "notes/a-over#topic"]
    );
}

// A term that is a section id up to and including its `#` anchor matches that one section by
// id alone: `like`, not the sibling section and not the document's other sections.
#[test]
fn a_section_id_prefix_with_its_anchor_alone_is_like() {
    let project = corpus(&[
        (
            "qz-a",
            page(SAME, &[("Topic", "plain text."), ("Other", "more text.")]),
        ),
        ("qz-b", topic("plain text.")),
    ]);

    assert_eq!(
        found(&project, &["notes/qz-a#to"]),
        pairs(&[("notes/qz-a#topic", "like")])
    );
}

// Two sections hold `alpha` and `beta` once each in bodies of equal length, so they tie on score
// without proximity and `a` would win by id. `z` has the terms in adjacent words (with
// punctuation and capitals), `a` has them five words apart; `z` ranks first. With one query term
// there is no pair, and the id order stands. A proximity that is skipped, or that is applied
// to a one-term search, shows as `a` first for two terms or `z` first for one.
#[test]
fn adjacent_query_terms_outrank_distant_ones_at_equal_counts() {
    let project = corpus(&[
        ("a", topic("alpha, aa aa aa aa beta.")),
        ("z", topic("ALPHA, Beta. aa aa aa aa")),
    ]);

    assert_eq!(
        ids(&project, &["alpha", "beta"]),
        ["notes/z#topic", "notes/a#topic"]
    );
    assert_eq!(
        ids(&project, &["alpha"]),
        ["notes/a#topic", "notes/z#topic"]
    );
}

// A word that holds both terms is distance zero, the closest pair there is: `z` (`alphabeta`)
// ranks ahead of `a` (five words apart) at equal length. A distance taken only between separate
// words finds no pair in `z` and leaves the id order.
#[test]
fn one_word_holding_both_terms_is_distance_zero() {
    let project = corpus(&[
        ("a", topic("alpha aa aa aa aa beta")),
        ("z", topic("alphabeta aaa aa aa aa")),
    ]);

    assert_eq!(
        ids(&project, &["alpha", "beta"]),
        ["notes/z#topic", "notes/a#topic"]
    );
}

// Two occurrences of the same term are not a pair: `beta` is in no section, so each chunk holds
// one different term and gets no adjustment. `z` (the two `alpha` adjacent) ties with `a` (far
// apart) and `a` wins by id; a distance taken between any two occurrences puts `z` first.
#[test]
fn adjacent_occurrences_of_one_term_earn_no_proximity() {
    let project = corpus(&[
        ("a", topic("alpha aa aa aa alpha aa")),
        ("z", topic("alpha alpha aa aa aa aa")),
    ]);

    assert_eq!(
        ids(&project, &["alpha", "beta"]),
        ["notes/a#topic", "notes/z#topic"]
    );
}

// Distance is counted in words. `z` has one 40-character word between the terms (two words
// apart), `a` has three two-letter words between them (four words apart, 9 characters), and the
// bodies are 51 characters each. `z` ranks first; a distance in characters puts `a` first,
// which is also the id order.
#[test]
fn proximity_counts_words_and_not_characters() {
    let project = corpus(&[
        (
            "a",
            topic(&format!("alpha aa aa aa beta {}", "z".repeat(31))),
        ),
        ("z", topic(&format!("alpha {} beta", "x".repeat(40)))),
    ]);

    assert_eq!(
        ids(&project, &["alpha", "beta"]),
        ["notes/z#topic", "notes/a#topic"]
    );
}

// A term in the section title or in the document title counts twice and a body occurrence once.
// All three sections have equal total length: `a` holds `alpha` once in the body, `y` once in the
// document title, `z` once in the section title. `y` and `z` tie and `y` wins by id, `a` is last.
// Without the weight all three tie and `a` is first; a weight on one title field alone puts
// `z` or `y` after `a`.
#[test]
fn a_term_in_either_title_counts_twice_and_one_in_the_body_once() {
    let project = corpus(&[
        ("a", page("Notes", &[("Other", "alpha aa aa aa aa")])),
        ("y", page("alpha", &[("Other", "xxxxx aa aa aa aa")])),
        ("z", page("Notes", &[("alpha", "xxxxx aa aa aa aa")])),
    ]);

    assert_eq!(
        ids(&project, &["alpha"]),
        ["notes/y#other", "notes/z#alpha", "notes/a#other"]
    );
}

// Proximity is applied to every chunk before the best one is chosen. `s` has a chunk with four
// `alpha` and a chunk with `alpha beta` side by side. Without proximity the first is its best
// chunk (about -2.33, behind `c` at -2.55); with it the second is (about -2.88, ahead of `c`).
// Choosing the best chunk first and adjusting only that one leaves `s` behind `c`. `beta` is in
// three other sections so its own weight is small, and `the` is dropped, so only scores order
// the answer.
#[test]
fn proximity_can_make_the_chunk_with_both_terms_the_best_chunk() {
    let heavy = paragraph(&[(10, "alpha"), (50, "alpha"), (100, "alpha"), (150, "alpha")]);
    let paired = paragraph(&[(10, "alpha"), (11, "beta")]);
    let project = corpus(&[
        ("s", topic(&[heavy, paired].join("\n\n"))),
        ("c", topic(&format!("alpha{}", " aa".repeat(20)))),
        ("b0", topic("beta aa aa.")),
        ("b1", topic("beta aa aa.")),
        ("b2", topic("beta aa aa.")),
    ]);
    let blank = (0..8)
        .map(|_| paragraph(&[]))
        .collect::<Vec<_>>()
        .join("\n\n");
    project.write("notes/filler.md", &page("Doc F", &[("Topic", &blank)]));

    assert_eq!(
        ids(&project, &["the alpha beta"])
            .iter()
            .take(2)
            .collect::<Vec<_>>(),
        ["notes/s#topic", "notes/c#topic"]
    );
}
