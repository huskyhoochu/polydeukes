//! Tickets derived by the config's rules, observed through `related` of `show --json`: the other
//! documents whose ticket is the same string.

use serde_json::{Value, json};

use crate::common::{Project, doc};

fn related(project: &Project, id: &str) -> Value {
    project
        .show(id)
        .pointer("/related")
        .cloned()
        .expect("a shown document lists its related documents")
}

fn write(project: &Project, id: &str, front: &[(&str, &str)]) {
    project.write(&format!("{id}.md"), &doc(front, &[("One", "x")]));
}

// A list that includes the document itself, one in file order, one relating `RQ-7` to `RQ-70` by
// prefix, or one that gives a section a list of its own diverges here.
#[test]
fn related_lists_the_other_documents_with_the_same_ticket_in_id_order() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "ticket": [{ "from": "title", "pattern": "RQ-[0-9]+" }]
    }));
    for (id, title) in [
        ("c", "Gamma RQ-7"),
        ("a", "Alpha RQ-7"),
        ("b", "Beta RQ-7"),
        ("d", "Delta RQ-9"),
        ("e", "Epsilon RQ-70"),
    ] {
        write(&project, &format!("notes/{id}"), &[("title", title)]);
    }

    assert_eq!(related(&project, "notes/a"), json!(["notes/b", "notes/c"]));
    assert_eq!(related(&project, "notes/b"), json!(["notes/a", "notes/c"]));
    assert_eq!(related(&project, "notes/d"), json!([]));
    assert_eq!(related(&project, "notes/e"), json!([]));
    assert_eq!(project.show("notes/a#one").pointer("/related"), None);
}

// A frontmatter rule without a pattern keeps the value as written, so two spellings are two
// tickets: a case-insensitive or trimmed comparison relates them.
#[test]
fn only_identical_ticket_strings_relate_not_a_case_or_whitespace_variant() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "ticket": [{ "from": "frontmatter", "key": "ticket" }]
    }));
    write(
        &project,
        "notes/upper",
        &[("title", "Upper"), ("ticket", "RQ-7")],
    );
    write(
        &project,
        "notes/partner",
        &[("title", "Partner"), ("ticket", "RQ-7")],
    );
    write(
        &project,
        "notes/lower",
        &[("title", "Lower"), ("ticket", "rq-7")],
    );
    write(
        &project,
        "notes/spaced",
        &[("title", "Spaced"), ("ticket", "\"RQ-7 \"")],
    );

    assert_eq!(related(&project, "notes/upper"), json!(["notes/partner"]));
    assert_eq!(related(&project, "notes/lower"), json!([]));
    assert_eq!(related(&project, "notes/spaced"), json!([]));
}

// No ticket means no relation: a title carrying the identifier relates nothing when no rule reads
// titles, and documents the rule misses are not related to each other.
#[test]
fn documents_without_a_ticket_relate_to_nothing() {
    let without_rule = Project::notes();
    write(&without_rule, "notes/a", &[("title", "Alpha RQ-7")]);
    write(&without_rule, "notes/b", &[("title", "Beta RQ-7")]);
    let missed = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "ticket": [{ "from": "title", "pattern": "RQ-[0-9]+" }]
    }));
    write(&missed, "notes/a", &[("title", "Plain one")]);
    write(&missed, "notes/b", &[("title", "Plain two")]);

    for project in [&without_rule, &missed] {
        assert_eq!(related(project, "notes/a"), json!([]));
        assert_eq!(related(project, "notes/b"), json!([]));
    }
}

// Rules are tried in order and the first that yields a value wins: a rule limited to a type skips
// other types, a value that is not a string or does not match the pattern falls to the next rule,
// and a rule that yields nothing leaves the document without a ticket.
#[test]
fn the_first_rule_that_yields_a_ticket_wins_after_type_filtering() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "ticket": [
            { "type": "decision", "from": "frontmatter", "key": "issue", "pattern": "[A-Z]+-[0-9]+" },
            { "from": "title", "pattern": "[A-Z]+-[0-9]+" },
            { "from": "frontmatter", "key": "fallback" },
            { "from": "frontmatter", "key": "numeric" }
        ]
    }));
    let summary = ("title", "PR-12 summary");
    write(
        &project,
        "notes/front",
        &[summary, ("type", "decision"), ("issue", "BK-34 extra")],
    );
    write(
        &project,
        "notes/bk-partner",
        &[("title", "Other"), ("type", "decision"), ("issue", "BK-34")],
    );
    write(
        &project,
        "notes/title",
        &[summary, ("type", "guide"), ("issue", "BK-34")],
    );
    write(
        &project,
        "notes/no-pattern-match",
        &[
            summary,
            ("type", "decision"),
            ("issue", "no identifier here"),
        ],
    );
    write(
        &project,
        "notes/nonstring-issue",
        &[summary, ("type", "decision"), ("issue", "42")],
    );
    write(
        &project,
        "notes/fallback",
        &[("title", "Untitled"), ("fallback", "Q-7")],
    );
    write(
        &project,
        "notes/fallback2",
        &[("title", "Untitled"), ("fallback", "Q-7")],
    );
    write(
        &project,
        "notes/numeric",
        &[("title", "Untitled"), ("numeric", "42")],
    );
    write(&project, "notes/none", &[("title", "Untitled")]);

    assert_eq!(
        related(&project, "notes/front"),
        json!(["notes/bk-partner"])
    );
    assert_eq!(
        related(&project, "notes/title"),
        json!(["notes/no-pattern-match", "notes/nonstring-issue"])
    );
    assert_eq!(
        related(&project, "notes/no-pattern-match"),
        json!(["notes/nonstring-issue", "notes/title"])
    );
    assert_eq!(
        related(&project, "notes/fallback"),
        json!(["notes/fallback2"])
    );
    assert_eq!(related(&project, "notes/numeric"), json!([]));
    assert_eq!(related(&project, "notes/none"), json!([]));
}

// A path rule reads the document id: the first match of its pattern, never a later one; an
// earlier rule that yields a value stops the evaluation; a rule limited to `rfc` leaves a `guide`
// to the whole-id rule, so two guides share no ticket.
#[test]
fn a_path_rule_takes_the_first_match_in_the_document_id_and_honours_its_type() {
    let project = Project::new(&json!({
        "include": ["text/**/*.md"],
        "ticket": [
            { "from": "frontmatter", "key": "issue", "pattern": "[A-Z]+-[0-9]+" },
            { "type": "rfc", "from": "path", "pattern": "[0-9]+" },
            { "from": "path" }
        ]
    }));
    let rfc = ("type", "rfc");
    let guide = ("type", "guide");
    write(
        &project,
        "text/3392-leadership-council/motivation",
        &[("title", "RFC 1"), rfc],
    );
    write(&project, "text/3392-other", &[("title", "RFC 2"), rfc]);
    write(
        &project,
        "text/2094-nll/2071-appendix",
        &[("title", "RFC 3"), rfc],
    );
    write(&project, "text/2071-thing", &[("title", "RFC 4"), rfc]);
    write(
        &project,
        "text/2094-nll",
        &[("title", "RFC 5"), rfc, ("issue", "BK-34")],
    );
    write(
        &project,
        "text/bk-partner",
        &[("title", "RFC 6"), rfc, ("issue", "BK-34")],
    );
    write(&project, "text/4000-guide", &[("title", "G 1"), guide]);
    write(&project, "text/4000-other", &[("title", "G 2"), guide]);

    assert_eq!(
        related(&project, "text/3392-leadership-council/motivation"),
        json!(["text/3392-other"])
    );
    assert_eq!(related(&project, "text/2094-nll/2071-appendix"), json!([]));
    assert_eq!(related(&project, "text/2071-thing"), json!([]));
    assert_eq!(
        related(&project, "text/2094-nll"),
        json!(["text/bk-partner"])
    );
    assert_eq!(related(&project, "text/4000-guide"), json!([]));
    assert_eq!(related(&project, "text/4000-other"), json!([]));
}

// A path rule whose pattern matches nothing leaves no ticket: it must not store an empty ticket,
// which would relate every such document to every other.
#[test]
fn a_path_pattern_that_matches_nothing_leaves_no_ticket() {
    let project = Project::new(&json!({
        "include": ["text/**/*.md"],
        "ticket": [{ "from": "path", "pattern": "[0-9]+" }]
    }));
    write(&project, "text/no-number-a", &[("title", "A")]);
    write(&project, "text/no-number-b", &[("title", "B")]);
    write(&project, "text/7-a", &[("title", "C")]);
    write(&project, "text/7-b", &[("title", "D")]);

    assert_eq!(related(&project, "text/no-number-a"), json!([]));
    assert_eq!(related(&project, "text/no-number-b"), json!([]));
    assert_eq!(related(&project, "text/7-a"), json!(["text/7-b"]));
}
