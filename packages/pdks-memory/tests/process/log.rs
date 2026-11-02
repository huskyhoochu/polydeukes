//! The memory log: `show` and `obligations` append one JSON line each, after answering.

use serde_json::{Value, json};

use crate::common::{Project, is_iso_utc_millis, page};

const LOG: &str = ".polydeukes/memory-log.jsonl";

fn project() -> Project {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "obligations": [{ "line": "^\\s*[-*] \\[ \\]", "key": "[A-Z]+-[0-9]+" }]
    }));
    project.write(
        "notes/alpha.md",
        &page("Alpha", &[("One", "x"), ("Two", "y")]),
    );
    project.write(
        "notes/log-duty.md",
        "---\ntitle: Log duty\ntype: note\n---\n## Todo\n\n- [ ] LG-1 pending\n- [ ] LG-1 again\n\n## Later\n\n- [ ] LG-1 afterwards\n",
    );
    project
}

fn lines(project: &Project) -> Vec<String> {
    project.read(LOG).lines().map(str::to_string).collect()
}

/// A log line without its `at`, which `is_iso_utc_millis` checks separately.
fn without_time(raw: &str) -> Value {
    let mut value: Value = serde_json::from_str(raw).expect("a log line is JSON");
    let at = value
        .as_object_mut()
        .and_then(|object| object.remove("at"))
        .expect("a log line has `at`");
    assert!(
        is_iso_utc_millis(at.as_str().expect("`at` is a string")),
        "{at}"
    );
    value
}

// A line written only under `--json`, one whose `query` is the argument list, one that names every
// section of a shown document or the document of a shown section, one whose obligations results are
// the key rather than the section ids (or fold two rows of one section into one id, or list the
// sections in file order), or one that adds a match path a miss count would read: each differs from
// the exact line. A line without `at`, or one in local time, cannot bound the summary's span.
#[test]
fn show_and_obligations_append_one_line_each_with_the_ids_they_answered() {
    let project = project();

    project.ok(&["show", "notes/alpha"]);
    project.ok(&["show", "notes/alpha#two", "--json"]);
    project.ok(&["obligations", "LG-1"]);

    let written = lines(&project);
    assert_eq!(written.len(), 3);
    assert_eq!(
        written
            .iter()
            .map(|raw| without_time(raw))
            .collect::<Vec<_>>(),
        vec![
            json!({ "command": "show", "query": "notes/alpha", "results": [{ "id": "notes/alpha" }] }),
            json!({ "command": "show", "query": "notes/alpha#two", "results": [{ "id": "notes/alpha#two" }] }),
            json!({
                "command": "obligations",
                "query": "LG-1",
                "results": [
                    { "id": "notes/log-duty#later" },
                    { "id": "notes/log-duty#todo" },
                    { "id": "notes/log-duty#todo" }
                ]
            }),
        ]
    );
    // Key order is part of the line: `at`, `command`, `query`, `results`.
    assert!(written.first().is_some_and(|raw| raw.starts_with("{\"at\":\"")
        && raw.ends_with("\",\"command\":\"show\",\"query\":\"notes/alpha\",\"results\":[{\"id\":\"notes/alpha\"}]}")));
}

// An obligations call that finds nothing is still an answer: it is logged with no results.
#[test]
fn an_obligations_call_with_no_row_is_logged_with_empty_results() {
    let project = project();

    project.ok(&["obligations", "LG-9"]);

    assert_eq!(
        lines(&project)
            .iter()
            .map(|raw| without_time(raw))
            .collect::<Vec<_>>(),
        vec![json!({ "command": "obligations", "query": "LG-9", "results": [] })]
    );
}

// A line appended before the command has its answer records a refused `show` as a hit on the id it
// refused; `lint`, `stats`, and `usage` return no id and would pad the entry count the header
// reports; a refused command line must leave no line, and no directory, behind.
#[test]
fn nothing_but_an_answered_show_or_obligations_writes_a_line() {
    let project = project();
    project.write(LOG, "");
    let empty = project.read(LOG);

    project.run(&["lint"]);
    project.run(&["stats"]);
    project.run(&["usage"]);
    project.run(&["show", "notes/nothing"]);
    project.run(&["show"]);
    project.run(&["obligations", "LG-1", "LG-2"]);

    assert_eq!(project.read(LOG), empty);
}

// A refused command line or config creates no `.polydeukes` directory for a log it will not write.
#[test]
fn a_refused_call_creates_no_log_directory() {
    let project = project();
    project.run(&["show", "notes/nothing"]);
    project.run(&["show", "notes/alpha", "--bogus"]);
    project.set_memory(&json!({ "include": [] }));
    project.run(&["show", "notes/alpha"]);

    assert!(!project.exists(".polydeukes"));
}

// A log path that cannot be appended to (here a directory; a read-only or full `.polydeukes/` also
// refuses) must not turn an answered query into a failure.
#[test]
fn an_unwritable_log_does_not_change_the_answer() {
    let expected = project().ok(&["show", "notes/alpha", "--json"]);
    let project = project();
    project.write(&format!("{LOG}/occupied"), "");

    let out = project.run(&["show", "notes/alpha", "--json"]);

    assert_eq!(out.code, 0, "{}", out.stderr);
    assert_eq!(out.stdout, expected);
    assert_eq!(out.stderr, "");
}

// What `show` and `obligations` write is what `usage` reads: two calls name `alpha`, one names
// the duty document, and the rest are dead.
#[test]
fn usage_reads_the_lines_show_and_obligations_wrote() {
    let project = project();
    project.ok(&["show", "notes/alpha"]);
    project.ok(&["show", "notes/alpha#two"]);
    project.ok(&["obligations", "LG-1"]);

    let out = project.ok(&["usage"]);

    let mut lines = out.lines();
    let header = lines.next().expect("a header line");
    assert!(
        header.starts_with("# log ") && header.ends_with(" · 3 entries"),
        "{header}"
    );
    assert_eq!(
        lines.collect::<Vec<_>>(),
        vec!["hot\t2\tnotes/alpha", "hot\t1\tnotes/log-duty"]
    );
}

// A `.polydeukes` that is a file leaves no room for the log; the answer is the same.
#[test]
fn a_polydeukes_file_in_place_of_the_directory_does_not_change_the_answer() {
    let expected = project().ok(&["show", "notes/alpha", "--json"]);
    let project = project();
    project.write(".polydeukes", "");

    let out = project.run(&["show", "notes/alpha", "--json"]);

    assert_eq!(out.code, 0, "{}", out.stderr);
    assert_eq!(out.stdout, expected);
    assert_eq!(out.stderr, "");
}
