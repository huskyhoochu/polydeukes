//! `obligations <key>`: the rows the config's line and section rules file under a key.
//!
//! Rules, keys, and section titles are fixture values; the executable knows no checkbox or
//! carry-over word.

use serde_json::{Value, json};

use crate::common::{Project, doc, line};

const KEY: &str = "[A-Z]+-[0-9]+";
const CHECKBOX_LINE: &str = "^\\s*[-*] \\[ \\]";
fn checkbox_rule() -> Value {
    json!({ "line": CHECKBOX_LINE, "key": KEY })
}

fn carry_rule() -> Value {
    json!({ "line": "carry-over", "key": KEY })
}

fn section_rule() -> Value {
    json!({ "section": "^Unresolved questions$" })
}

fn with_rules(rules: &[Value]) -> Project {
    Project::new(&json!({ "include": ["notes/**/*.md"], "obligations": rules }))
}

fn row(key: &str, section: &str, doc_title: &str, section_title: &str, text: &str) -> Value {
    json!({
        "key": key,
        "sectionId": section,
        "docTitle": doc_title,
        "sectionTitle": section_title,
        "text": text
    })
}

fn rows(project: &Project, key: &str) -> Value {
    project
        .json(&["obligations", key])
        .pointer("/obligations")
        .cloned()
        .expect("an obligations answer has an obligations list")
}

fn section_ids(project: &Project, key: &str) -> Vec<String> {
    rows(project, key)
        .as_array()
        .expect("a list")
        .iter()
        .map(|r| {
            r.pointer("/sectionId")
                .and_then(Value::as_str)
                .expect("sectionId")
                .to_string()
        })
        .collect()
}

// A key taken by a first-match search loses `AB-2`; a marker line with no key match must write
// nothing; a rule that drops the line pattern keys `AB-3`; a text stored untrimmed keeps the
// indent; a `^` tested against the whole body instead of each line never matches `AB-4`.
#[test]
fn a_marker_line_files_one_row_per_key_match_with_the_trimmed_line() {
    let project = with_rules(&[checkbox_rule()]);
    project.write(
        "notes/a.md",
        "---\ntitle: A\n---\n## One\n\n- [ ] AB-1 and AB-2 pending\n- [ ] nothing here\nplain AB-3 line\n  * [ ] AB-4 indented\n",
    );

    let both = row(
        "AB-1",
        "notes/a#one",
        "A",
        "One",
        "- [ ] AB-1 and AB-2 pending",
    );
    assert_eq!(rows(&project, "AB-1"), json!([both]));
    assert_eq!(
        rows(&project, "AB-2"),
        json!([row(
            "AB-2",
            "notes/a#one",
            "A",
            "One",
            "- [ ] AB-1 and AB-2 pending"
        )])
    );
    assert_eq!(rows(&project, "AB-3"), json!([]));
    assert_eq!(
        rows(&project, "AB-4"),
        json!([row(
            "AB-4",
            "notes/a#one",
            "A",
            "One",
            "* [ ] AB-4 indented"
        )])
    );
}

// Two rules that admit the same line, or one key twice in a line, file one row.
#[test]
fn rules_that_admit_the_same_line_and_a_repeated_key_file_one_row() {
    let project = with_rules(&[checkbox_rule(), carry_rule()]);
    project.write(
        "notes/a.md",
        "---\ntitle: A\n---\n## One\n- [ ] carry-over AB-1 then AB-1 again\n",
    );

    assert_eq!(
        rows(&project, "AB-1"),
        json!([row(
            "AB-1",
            "notes/a#one",
            "A",
            "One",
            "- [ ] carry-over AB-1 then AB-1 again"
        )])
    );
}

// A line rule run only over the H2 sections misses the marker line before the first heading.
#[test]
fn a_marker_line_in_the_preamble_is_read() {
    let project = with_rules(&[checkbox_rule()]);
    project.write("notes/p.md", "# P\n- [ ] AB-5 early\n## One\nbody.\n");

    assert_eq!(
        rows(&project, "AB-5"),
        json!([row("AB-5", "notes/p#", "P", "", "- [ ] AB-5 early")])
    );
}

// A rule run over the raw file reads the frontmatter's carry-over line; one run over the parsed
// prose skips the fenced line.
#[test]
fn a_marker_line_inside_a_fence_counts_and_a_frontmatter_line_never_does() {
    let project = with_rules(&[checkbox_rule(), carry_rule()]);
    project.write(
        "notes/f.md",
        "---\ntitle: F\nnote: carry-over AB-7\n---\n## One\n```\n- [ ] AB-9\n```\n",
    );

    assert_eq!(
        rows(&project, "AB-9"),
        json!([row("AB-9", "notes/f#one", "F", "One", "- [ ] AB-9")])
    );
    assert_eq!(rows(&project, "AB-7"), json!([]));
}

// A section rule files the whole section body under the document's ticket: not the title, not the
// first line, and not a section like `(old)` that only contains the pattern; a document with no
// ticket files nothing.
#[test]
fn a_section_rule_files_the_whole_body_under_the_document_ticket() {
    let project = Project::new(&json!({
        "include": ["text/**/*.md"],
        "ticket": [{ "from": "path", "pattern": "[0-9]+" }],
        "obligations": [section_rule()]
    }));
    let text = "---\ntitle: RFC text\n---\nlead.\n## Unresolved questions\nfirst line.\nsecond line.\n## Unresolved questions (old)\nstale.\n## Summary\nbody.\n";
    project.write("text/2094-nll.md", text);
    project.write("text/no-number.md", text);

    assert_eq!(
        rows(&project, "2094"),
        json!([row(
            "2094",
            "text/2094-nll#unresolved-questions",
            "RFC text",
            "Unresolved questions",
            "first line.\nsecond line."
        )])
    );
}

#[test]
fn two_section_rules_that_admit_one_section_file_one_row() {
    let project = Project::new(&json!({
        "include": ["text/**/*.md"],
        "ticket": [{ "from": "path", "pattern": "[0-9]+" }],
        "obligations": [section_rule(), { "section": "questions" }]
    }));
    project.write("text/2094-nll.md", "## Unresolved questions\nfirst.\n");

    assert_eq!(
        section_ids(&project, "2094"),
        vec!["text/2094-nll#unresolved-questions"]
    );
}

// The preamble has no title, so a pattern that matches the empty title must not file it; an H2 with
// an empty title is a section, not the preamble.
#[test]
fn a_section_rule_never_files_the_preamble_but_files_an_h2_with_an_empty_title() {
    let project = Project::new(&json!({
        "include": ["text/**/*.md"],
        "ticket": [{ "from": "path", "pattern": "[0-9]+" }],
        "obligations": [{ "section": ".*" }]
    }));
    project.write(
        "text/2094-nll.md",
        "---\ntitle: RFC text\n---\nlead.\n## Unresolved questions\nfirst.\n## Summary\nbody.\n## {#open}\nopen.\n",
    );

    assert_eq!(
        section_ids(&project, "2094"),
        vec![
            "text/2094-nll#open",
            "text/2094-nll#summary",
            "text/2094-nll#unresolved-questions"
        ]
    );
}

// Rows come in section id order, then source order within a section with the section rule's row
// first; a key that another row carries is not mixed in; no row is dropped at a limit.
#[test]
fn rows_are_ordered_by_section_then_position_and_never_cut_off() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "ticket": [{ "from": "frontmatter", "key": "issue" }],
        "obligations": [checkbox_rule(), section_rule()]
    }));
    project.write(
        "notes/a.md",
        "---\ntitle: Doc A\nissue: AB-1\n---\n## Unresolved questions\nfirst.\n- [ ] AB-1 second\n## Zeta\n- [ ] AB-2 other\n",
    );
    let items: Vec<String> = (0..25).map(|i| format!("- [ ] AB-1 item {i}")).collect();
    project.write(
        "notes/b.md",
        &format!("---\ntitle: Doc B\n---\n## One\n{}\n", items.join("\n")),
    );

    let mut expected = vec![
        row(
            "AB-1",
            "notes/a#unresolved-questions",
            "Doc A",
            "Unresolved questions",
            "first.\n- [ ] AB-1 second",
        ),
        row(
            "AB-1",
            "notes/a#unresolved-questions",
            "Doc A",
            "Unresolved questions",
            "- [ ] AB-1 second",
        ),
    ];
    expected.extend(
        items
            .iter()
            .map(|text| row("AB-1", "notes/b#one", "Doc B", "One", text)),
    );
    assert_eq!(rows(&project, "AB-1"), json!(expected));
    assert_eq!(
        rows(&project, "AB-2"),
        json!([row(
            "AB-2",
            "notes/a#zeta",
            "Doc A",
            "Zeta",
            "- [ ] AB-2 other"
        )])
    );
    assert_eq!(rows(&project, "AB-3"), json!([]));
}

// The table has two tab-separated columns: the section id and the first non-blank line of the
// text, trimmed. A section rule's text starts with the blank line under its heading and an
// indented line; a tab inside the text must not become a third column.
#[test]
fn the_table_prints_the_section_id_a_tab_and_the_first_line_of_the_text() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "ticket": [{ "from": "frontmatter", "key": "issue" }],
        "obligations": [checkbox_rule(), section_rule()]
    }));
    project.write(
        "notes/duty.md",
        &format!(
            "{}## Unresolved questions\n\n  first line of the section.\nsecond line.\n- [ ] AB-1 pending\n- [ ] AB-2 other\n",
            doc(&[("title", "Duty"), ("type", "note"), ("issue", "AB-1")], &[])
        ),
    );
    project.write("notes/tabbed.md", "## Tabbed\n- [ ] AB-3\tsplit\n");

    assert_eq!(
        project.ok(&["obligations", "AB-1"]),
        "notes/duty#unresolved-questions\tfirst line of the section.\nnotes/duty#unresolved-questions\t- [ ] AB-1 pending\n"
    );
    assert_eq!(
        project.ok(&["obligations", "AB-3"]),
        "notes/tabbed#tabbed\t- [ ] AB-3 split\n"
    );
}

// A key with no row is an empty answer, not a failure.
#[test]
fn a_key_with_no_row_answers_empty_with_exit_zero() {
    let project = with_rules(&[checkbox_rule()]);
    project.write("notes/a.md", "## One\n- [ ] AB-1 x\n");

    assert_eq!(project.ok(&["obligations", "AB-9"]), "");
    assert_eq!(
        project.ok(&["obligations", "AB-9", "--json"]),
        line(&json!({ "obligations": [] }))
    );
}

// The `--json` object is exactly `{ obligations: [...] }`: the five keys of a row in order, no
// stamp.
#[test]
fn obligations_json_is_the_exact_object() {
    let project = with_rules(&[checkbox_rule()]);
    project.write("notes/a.md", "---\ntitle: A\n---\n## One\n- [ ] AB-1 x\n");

    assert_eq!(
        project.ok(&["obligations", "AB-1", "--json"]),
        "{\"obligations\":[{\"key\":\"AB-1\",\"sectionId\":\"notes/a#one\",\"docTitle\":\"A\",\"sectionTitle\":\"One\",\"text\":\"- [ ] AB-1 x\"}]}\n"
    );
}

// A key is compared whole: `AB-1` does not answer the rows filed under `AB-10`.
#[test]
fn a_key_answers_only_the_rows_filed_under_that_exact_key() {
    let project = with_rules(&[checkbox_rule()]);
    project.write("notes/a.md", "## One\n- [ ] AB-10 x\n- [ ] AB-1 y\n");

    assert_eq!(
        project.ok(&["obligations", "AB-1"]),
        "notes/a#one\t- [ ] AB-1 y\n"
    );
}
