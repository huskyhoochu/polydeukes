//! Refusals: one stderr line `pdks memory: <message>`, empty stdout, exit 2.

use serde_json::json;

use crate::common::{NOTES_INCLUDE, Project, assert_refused, doc};

const USAGE: &str = "usage: pdks memory show <id> [--json] | pdks memory obligations <key> [--json] | pdks memory supersession <doc> [--json] | pdks memory lint [--json] | pdks memory stats [--json] | pdks memory usage [--json]";
const EXAMPLE: &str = "\nmemory:\n  include:\n    - 'docs/**/*.md'";
const NO_OBLIGATION_RULES: &str = "memory.obligations is not declared — add the line or section rules that mark an obligation to the project config";
const INVALID_INCLUDE: &str = "invalid config in polydeukes.config.json: memory.include must be a non-empty array of non-empty strings";
const UNKNOWN_ID: &str = "notes/nothing";

/// One invocation of each verb the executable answers, with a fixture argument where it takes one.
const EVERY_VERB: [&[&str]; 6] = [
    &["show", "notes/x"],
    &["obligations", "K-1"],
    &["supersession", "notes/x"],
    &["lint"],
    &["stats"],
    &["usage"],
];

// A config lookup that walks upward, or answers from an empty corpus, turns "no config" into a
// clean zero-document answer; the hint names the directory so a wrong cwd is visible.
#[test]
fn no_config_refuses_every_verb_naming_the_names_it_looked_for() {
    let project = Project::bare();
    for args in EVERY_VERB {
        let out = project.run(args);
        assert_eq!(out.code, 2, "{args:?}");
        assert_eq!(out.stdout, "", "{args:?}");
        assert!(
            out.stderr.starts_with("pdks memory: no config in "),
            "{args:?}: {}",
            out.stderr
        );
        assert!(
            out.stderr.contains(
                "(polydeukes.config.yaml, polydeukes.config.yml, polydeukes.config.json) — run pdks memory from the directory that holds it, or create one that declares memory.include, for example:"
            ),
            "{args:?}: {}",
            out.stderr
        );
        assert!(out.stderr.ends_with(&format!("{EXAMPLE}\n")), "{args:?}");
    }
}

// Two candidates answered with the first one would judge a corpus the owner did not choose.
#[test]
fn two_config_files_refuse_as_ambiguous() {
    let project = Project::notes();
    project.write(
        "polydeukes.config.yaml",
        "memory:\n  include:\n    - 'notes/**/*.md'\n",
    );

    let out = project.run(&["stats"]);

    assert_eq!(out.code, 2);
    assert_eq!(out.stdout, "");
    assert!(
        out.stderr
            .starts_with("pdks memory: ambiguous Polydeukes config in "),
        "{}",
        out.stderr
    );
    assert!(
        out.stderr.ends_with(
            " — found polydeukes.config.yaml and polydeukes.config.json; keep exactly one\n"
        ),
        "{}",
        out.stderr
    );
}

// A config whose `memory` key is missing answers with the declaration hint, for every verb.
#[test]
fn a_config_without_a_memory_key_refuses_every_verb_with_the_declaration_hint() {
    let project = Project::bare();
    project.write("polydeukes.config.json", "{\"telemetry\": {}}");
    for args in EVERY_VERB {
        assert_refused(
            &project.run(args),
            &format!(
                "memory.include is not declared — add the globs of the markdown files to index to the project config, for example:\n{EXAMPLE}"
            ),
        );
    }
}

// `memory.include` missing, empty, or holding an empty string would match nothing or everything;
// every verb reads it, including the ones that only need ids.
#[test]
fn an_invalid_include_refuses_every_verb() {
    for memory in [
        json!({ "include": NOTES_INCLUDE }),
        json!({ "include": [] }),
        json!({ "include": [""] }),
        json!({ "exclude": ["x"] }),
    ] {
        let project = Project::new(&memory);
        for args in EVERY_VERB {
            assert_refused(&project.run(args), INVALID_INCLUDE);
        }
    }
}

#[test]
fn a_memory_section_that_is_not_an_object_refuses() {
    let project = Project::new(&json!(5));

    assert_refused(
        &project.run(&["stats"]),
        "invalid config in polydeukes.config.json: memory must be an object",
    );
}

// Each pattern field the executable runs is compiled up front; a pattern the regex engine cannot
// compile must be refused by name, not skipped or crashed on at first use.
#[test]
fn a_pattern_that_does_not_compile_refuses_naming_its_field() {
    let cases = [
        (
            json!({ "include": [NOTES_INCLUDE], "ticket": [{ "from": "title", "pattern": "(" }] }),
            "memory.ticket[0].pattern is invalid",
        ),
        (
            json!({ "include": [NOTES_INCLUDE], "obligations": [{ "line": "(", "key": "x" }] }),
            "memory.obligations[0].line is invalid",
        ),
        (
            json!({ "include": [NOTES_INCLUDE], "obligations": [{ "section": "(" }] }),
            "memory.obligations[0].section is invalid",
        ),
        (
            json!({ "include": [NOTES_INCLUDE], "supersedes": [{ "line": "x", "key": "[", "direction": "supersedes" }] }),
            "memory.supersedes[0].key is invalid",
        ),
    ];
    for (memory, field) in cases {
        let project = Project::new(&memory);
        assert_refused(
            &project.run(&["stats"]),
            &format!("invalid config in polydeukes.config.json: {field}"),
        );
    }
}

// Without rules no row can exist, and an empty answer would read as no obligation left.
#[test]
fn obligations_without_rules_refuse_whether_absent_or_empty() {
    for memory in [
        json!({ "include": [NOTES_INCLUDE] }),
        json!({ "include": [NOTES_INCLUDE], "obligations": [] }),
    ] {
        let project = Project::new(&memory);
        project.write("notes/a.md", &doc(&[], &[("One", "- [ ] AB-1 x")]));

        assert_refused(&project.run(&["obligations", "AB-1"]), NO_OBLIGATION_RULES);
        assert_refused(
            &project.run(&["obligations", "AB-1", "--json"]),
            NO_OBLIGATION_RULES,
        );
    }
}

#[test]
fn show_and_supersession_refuse_an_unknown_id_as_text_and_as_json() {
    let project = Project::notes();
    project.write("notes/a.md", &doc(&[], &[("One", "x")]));
    for args in [
        &["show", UNKNOWN_ID][..],
        &["show", UNKNOWN_ID, "--json"],
        &["supersession", UNKNOWN_ID],
        &["supersession", UNKNOWN_ID, "--json"],
    ] {
        assert_refused(
            &project.run(args),
            &format!("unknown memory id: {UNKNOWN_ID}"),
        );
    }
}

// A section id is not a document: supersession answers for documents only.
#[test]
fn supersession_refuses_a_section_id() {
    let project = Project::notes();
    project.write("notes/a.md", &doc(&[], &[("One", "x")]));

    assert_refused(
        &project.run(&["supersession", "notes/a#one"]),
        "unknown memory id: notes/a#one",
    );
}

#[test]
fn usage_without_a_log_refuses_naming_the_log_path() {
    let project = Project::notes();
    project.write("notes/a.md", &doc(&[], &[("One", "x")]));
    let message = "no memory log at .polydeukes/memory-log.jsonl — run pdks memory search, show, or obligations first";

    assert_refused(&project.run(&["usage"]), message);
    assert_refused(&project.run(&["usage", "--json"]), message);
}

#[test]
fn no_arguments_refuse_with_the_usage_line() {
    assert_refused(&Project::notes().run(&[]), USAGE);
}

// The arguments are read before any config, so a bad command line is reported as usage even
// where there is no config to load.
#[test]
fn a_usage_error_is_reported_before_the_config_is_read() {
    assert_refused(&Project::bare().run(&["lint", "extra"]), USAGE);
}

#[test]
fn an_unknown_verb_refuses_with_the_usage_line() {
    assert_refused(&Project::notes().run(&["frobnicate"]), USAGE);
}

// A flag is refused rather than read as an id; `--json` alone leaves no id for `show`.
#[test]
fn an_unknown_flag_refuses_with_the_usage_line() {
    let project = Project::notes();
    for args in [
        &["lint", "--verbose"][..],
        &["stats", "--json", "--extra"],
        &["show", "--json"],
    ] {
        assert_refused(&project.run(args), USAGE);
    }
}

// Too few or too many words must not be read as the first one, and a refused call leaves no
// log line and no `.polydeukes` directory behind.
#[test]
fn a_wrong_number_of_arguments_refuses_and_writes_nothing() {
    let project = Project::notes();
    project.write("notes/a.md", &doc(&[], &[("One", "x")]));
    for args in [
        &["show"][..],
        &["show", "notes/a", "notes/b"],
        &["obligations"],
        &["obligations", "AB-1", "AB-2"],
        &["supersession"],
        &["supersession", "notes/a", "notes/b"],
        &["lint", "extra"],
        &["stats", "extra"],
        &["usage", "extra"],
    ] {
        assert_refused(&project.run(args), USAGE);
    }
    assert!(!project.exists(".polydeukes"));
}

// The arguments are decoded lossily, as Node decodes argv; a byte that is not UTF-8 never panics.
#[cfg(unix)]
#[test]
fn an_argument_that_is_not_utf8_is_decoded_lossily() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;

    let project = Project::notes();
    let out = project.run_os(&[OsStr::new("show"), OsStr::from_bytes(b"\xff")]);

    assert_refused(&out, "unknown memory id: \u{FFFD}");
}
