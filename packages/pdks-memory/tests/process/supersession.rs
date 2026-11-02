//! `supersession <doc>`: the chain of documents that replaced or were replaced by one document,
//! and the declarations that resolve to no document (read from `lint --json`).
//!
//! Line markers, key patterns, and directions are fixture values. The key pattern excludes its
//! prefix, so the raw target a lint line reports is the bare name.

use serde_json::{Value, json};

use crate::common::{Project, line, typed};

const KEY: &str = "(?<=doc:)[A-Za-z0-9-]+";

fn supersedes() -> Value {
    json!({ "line": "Supersedes:", "key": KEY, "direction": "supersedes" })
}

fn replaces() -> Value {
    json!({ "line": "Replaces:", "key": KEY, "direction": "supersedes" })
}

fn superseded_by() -> Value {
    json!({ "line": "Superseded by:", "key": KEY, "direction": "superseded-by" })
}

fn with_rules(rules: &[Value]) -> Project {
    Project::new(&json!({ "include": ["notes/**/*.md"], "supersedes": rules }))
}

fn pair(newer: &str, older: &str) -> Value {
    json!({ "newer": newer, "older": older })
}

fn chain(project: &Project, id: &str) -> Value {
    project
        .json(&["supersession", id])
        .pointer("/supersession")
        .cloned()
        .expect("a supersession answer has a supersession list")
}

/// `(id, detail)` of every violation of one lint rule; the exit code is not asserted because the
/// fixtures declare pairs without quoting them.
fn violations(project: &Project, rule: &str) -> Vec<(String, String)> {
    let out = project.run(&["lint", "--json"]);
    out.json()
        .pointer("/violations")
        .and_then(Value::as_array)
        .expect("a lint answer has a violations list")
        .iter()
        .filter(|v| v.pointer("/rule").and_then(Value::as_str) == Some(rule))
        .map(|v| {
            let text = |key: &str| {
                v.pointer(key)
                    .and_then(Value::as_str)
                    .expect("string")
                    .to_string()
            };
            (text("/id"), text("/detail"))
        })
        .collect()
}

fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
    list.iter()
        .map(|(a, b)| ((*a).to_string(), (*b).to_string()))
        .collect()
}

// A key taken by a first-match search loses `gamma`; a row per matching line or per rule writes
// `beta` and `nowhere` twice; a rule run over the parsed prose skips the fenced `delta`; one run
// over the raw text reads `fm` out of the frontmatter and `head` out of the H2 line; a table keyed
// without the direction folds the two `nowhere` rows into one.
#[test]
fn every_key_match_on_every_marker_line_is_a_declaration_and_nothing_else_is() {
    let project = with_rules(&[supersedes(), replaces(), superseded_by()]);
    project.write(
        "notes/alpha.md",
        &[
            "---",
            "title: Alpha",
            "type: note",
            "note: \"Supersedes: doc:fm\"",
            "---",
            "## Supersedes: doc:head",
            "Supersedes: doc:beta and doc:gamma",
            "Replaces: doc:beta and Supersedes: doc:nowhere",
            "Superseded by: doc:nowhere",
            "```",
            "Supersedes: doc:delta",
            "```",
            "",
        ]
        .join("\n"),
    );
    for name in ["beta", "gamma", "delta"] {
        project.write(
            &format!("notes/{name}.md"),
            &typed(name, &[("Topic", &format!("{name} text."))]),
        );
    }

    assert_eq!(
        chain(&project, "notes/alpha"),
        json!([
            pair("notes/alpha", "notes/beta"),
            pair("notes/alpha", "notes/delta"),
            pair("notes/alpha", "notes/gamma")
        ])
    );
    assert_eq!(
        violations(&project, "unresolved-supersession"),
        pairs(&[
            ("notes/alpha", "superseded-by nowhere"),
            ("notes/alpha", "supersedes nowhere")
        ])
    );
}

// A key resolves by document name first (the source's directory preferred, case-insensitive), else
// by the one document holding that ticket, else it is unresolved. The declaring document is never
// its own target.
#[test]
fn a_key_resolves_by_name_then_by_a_unique_ticket_and_never_to_the_declaring_document() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "ticket": [{ "from": "path", "pattern": "[1-9][0-9]*" }],
        "supersedes": [supersedes()]
    }));
    project.write(
        "notes/x/alpha.md",
        &typed(
            "Alpha",
            &[
                ("Topic", "Supersedes: doc:target"),
                ("Two", "Supersedes: doc:Target2"),
                ("Three", "Supersedes: doc:192"),
                ("Four", "Supersedes: doc:2071"),
                ("Five", "Supersedes: doc:300"),
                ("Six", "Supersedes: doc:404"),
                ("Seven", "Supersedes: doc:alpha"),
            ],
        ),
    );
    for (id, title) in [
        ("notes/a/target", "Target elsewhere"),
        ("notes/x/target", "Target here"),
        ("notes/y/target2", "Target two"),
        ("notes/r/0192-old", "RFC 192"),
        ("notes/r/2071-first", "RFC 2071 a"),
        ("notes/r/2071-second", "RFC 2071 b"),
        ("notes/300", "Named 300"),
        ("notes/r/0300-a", "RFC 300"),
    ] {
        project.write(&format!("{id}.md"), &typed(title, &[("Topic", "text.")]));
    }
    project.write(
        "notes/r/0555-self.md",
        &typed("Self", &[("Topic", "Supersedes: doc:555")]),
    );

    assert_eq!(
        chain(&project, "notes/x/alpha"),
        json!([
            pair("notes/x/alpha", "notes/300"),
            pair("notes/x/alpha", "notes/r/0192-old"),
            pair("notes/x/alpha", "notes/x/target"),
            pair("notes/x/alpha", "notes/y/target2")
        ])
    );
    assert_eq!(chain(&project, "notes/a/target"), json!([]));
    assert_eq!(chain(&project, "notes/r/0555-self"), json!([]));
    assert_eq!(
        violations(&project, "unresolved-supersession"),
        pairs(&[
            ("notes/r/0555-self", "supersedes 555"),
            ("notes/x/alpha", "supersedes 2071"),
            ("notes/x/alpha", "supersedes 404"),
            ("notes/x/alpha", "supersedes alpha")
        ])
    );
}

// A marker line on which the key matches nothing is no declaration: an empty target would be
// reported as `supersedes ` with nothing after it.
#[test]
fn a_marker_line_on_which_the_key_matches_nothing_declares_nothing() {
    let project = with_rules(&[supersedes()]);
    project.write(
        "notes/alpha.md",
        &typed("Alpha", &[("Topic", "Supersedes: nothing named here")]),
    );
    project.write("notes/beta.md", &typed("Beta", &[("Topic", "beta text.")]));

    assert_eq!(chain(&project, "notes/alpha"), json!([]));
    assert_eq!(violations(&project, "unresolved-supersession"), vec![]);
}

// A rule run only over the H2 sections misses a declaration under the H1; a `^` tested against the
// whole body never matches a later line; a key applied without its lookahead takes `graph-model.md`;
// a line pattern compiled case-insensitively admits the lower-case `replaces:` line.
#[test]
fn an_anchored_declaration_in_the_preamble_resolves_a_link_path_key_and_matches_case() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "supersedes": [{
            "line": "^> \\*\\*Replaces:\\*\\*",
            "key": "[\\w.-]+(?=\\.md\\))",
            "direction": "supersedes"
        }]
    }));
    project.write(
        "notes/v011.md",
        "# Store design\n\n> status: accepted\n> **Replaces:** [graph-model](graph-model.md) — two items overturned.\n> **replaces:** [other](other.md) — not a declaration.\n\n## Body\ntext.\n",
    );
    project.write(
        "notes/graph-model.md",
        &typed("Graph model", &[("Topic", "older.")]),
    );
    project.write("notes/other.md", &typed("Other", &[("Topic", "other.")]));

    assert_eq!(
        chain(&project, "notes/v011"),
        json!([pair("notes/v011", "notes/graph-model")])
    );
    assert_eq!(chain(&project, "notes/other"), json!([]));
    assert_eq!(violations(&project, "unresolved-supersession"), vec![]);
}

// A name match that compares only the last segment never finds the document whose whole id the key
// spells; one that tests a suffix without a `/` boundary resolves `target` to `notes/mytarget`.
#[test]
fn a_key_equal_to_a_whole_id_resolves_and_an_unbounded_suffix_does_not() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "supersedes": [{ "line": "Supersedes:", "key": "(?<=doc:)[A-Za-z0-9/-]+", "direction": "supersedes" }]
    }));
    project.write(
        "notes/alpha.md",
        &typed(
            "Alpha",
            &[
                ("Topic", "Supersedes: doc:notes/beta"),
                ("Two", "Supersedes: doc:target"),
            ],
        ),
    );
    project.write("notes/beta.md", &typed("Beta", &[("Topic", "beta text.")]));
    project.write(
        "notes/mytarget.md",
        &typed("My target", &[("Topic", "suffix text.")]),
    );

    assert_eq!(
        chain(&project, "notes/alpha"),
        json!([pair("notes/alpha", "notes/beta")])
    );
    assert_eq!(chain(&project, "notes/mytarget"), json!([]));
    assert_eq!(
        violations(&project, "unresolved-supersession"),
        pairs(&[("notes/alpha", "supersedes target")])
    );
}

// A walk that follows one direction misses (A, B) from C or (B, C) from B; one that follows the
// newer document's other older documents adds (A, E) to B's answer; a `superseded-by` row read with
// the declaring document as the newer side yields (C, B); the answer is sorted by newer, then older.
#[test]
fn the_chain_runs_both_ways_through_the_document_and_leaves_sibling_branches_out() {
    let project = with_rules(&[supersedes(), superseded_by()]);
    project.write(
        "notes/a.md",
        &typed("A", &[("Topic", "Supersedes: doc:b and doc:e")]),
    );
    project.write("notes/b.md", &typed("B", &[("Topic", "b text.")]));
    project.write(
        "notes/c.md",
        &typed("C", &[("Topic", "Superseded by: doc:b")]),
    );
    project.write("notes/e.md", &typed("E", &[("Topic", "e text.")]));
    project.write("notes/lone.md", &typed("Lone", &[("Topic", "lone text.")]));

    let (ab, bc, ae) = (
        pair("notes/a", "notes/b"),
        pair("notes/b", "notes/c"),
        pair("notes/a", "notes/e"),
    );
    assert_eq!(chain(&project, "notes/b"), json!([ab, bc]));
    assert_eq!(chain(&project, "notes/c"), json!([ab, bc]));
    assert_eq!(chain(&project, "notes/e"), json!([ae]));
    assert_eq!(chain(&project, "notes/a"), json!([ab, ae, bc]));
    assert_eq!(chain(&project, "notes/lone"), json!([]));
}

// A walk without a visited set never returns on X and Y replacing each other; one that stops at the
// first repeated document drops the closing pair.
#[test]
fn a_cycle_terminates_and_reports_both_pairs() {
    let project = with_rules(&[supersedes()]);
    project.write("notes/x.md", &typed("X", &[("Topic", "Supersedes: doc:y")]));
    project.write("notes/y.md", &typed("Y", &[("Topic", "Supersedes: doc:x")]));

    assert_eq!(
        chain(&project, "notes/x"),
        json!([pair("notes/x", "notes/y"), pair("notes/y", "notes/x")])
    );
}

// A table that prints the pairs older-first, joins them with spaces, or keys the JSON differently
// diverges from the pinned bytes; a document with no pair answers empty, not an error.
#[test]
fn the_table_and_the_json_are_pinned() {
    let project = with_rules(&[supersedes()]);
    project.write(
        "notes/new.md",
        &typed("New", &[("Topic", "Supersedes: doc:old")]),
    );
    project.write("notes/old.md", &typed("Old", &[("Topic", "old text.")]));
    project.write("notes/lone.md", &typed("Lone", &[("Topic", "lone text.")]));

    assert_eq!(
        project.ok(&["supersession", "notes/old"]),
        "notes/new\tnotes/old\n"
    );
    assert_eq!(
        project.ok(&["supersession", "notes/old", "--json"]),
        line(&json!({ "supersession": [{ "newer": "notes/new", "older": "notes/old" }] }))
    );
    assert_eq!(project.ok(&["supersession", "notes/lone"]), "");
    assert_eq!(
        project.ok(&["supersession", "notes/lone", "--json"]),
        "{\"supersession\":[]}\n"
    );
}
