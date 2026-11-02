//! `stats`: the five counts, and what makes a document isolated.

use serde_json::json;

use crate::common::{Project, anchored_page, line, typed};

fn title_ticket() -> serde_json::Value {
    json!({
        "include": ["notes/**/*.md"],
        "ticket": [{ "from": "title", "pattern": "RQ-[0-9]+" }]
    })
}

// A count that treats any link as a connection clears `selfish` (its only link stays in its own
// document) and `broken` (its only link is unresolved); one that counts outgoing links alone marks
// `sink` isolated, incoming alone marks `source`; one that never counts a link-free document
// misses `lonely`.
#[test]
fn a_document_is_isolated_unless_a_resolved_link_joins_it_to_another_document() {
    let project = Project::notes();
    project.write(
        "notes/selfish.md",
        &anchored_page("Selfish", &[("one", "[me](#one)")]),
    );
    project.write(
        "notes/broken.md",
        &anchored_page("Broken", &[("one", "[[nowhere]]")]),
    );
    project.write(
        "notes/source.md",
        &anchored_page("Source", &[("one", "[s](sink.md)")]),
    );
    project.write(
        "notes/sink.md",
        &anchored_page("Sink", &[("one", "sink text.")]),
    );
    project.write(
        "notes/lonely.md",
        &anchored_page("Lonely", &[("one", "lonely text.")]),
    );

    assert_eq!(
        project.ok(&["stats", "--json"]),
        line(&json!({
            "documents": 5,
            "sections": 5,
            "links": 3,
            "unresolved": 1,
            "isolated": 3
        }))
    );
}

// A shared ticket connects two documents without adding a link: a count that ignores tickets
// reports 4, one that clears every ticketed document clears `c`, one that counts a link inside a
// document clears `d`, and a `links` count that adds ticket pairs reports more than the one link.
#[test]
fn a_shared_ticket_connects_documents_and_adds_no_link() {
    let project = Project::new(&title_ticket());
    project.write(
        "notes/a.md",
        &typed("Alpha RQ-7", &[("One {#one}", "plain text.")]),
    );
    project.write(
        "notes/b.md",
        &typed("Beta RQ-7", &[("One {#one}", "plain text.")]),
    );
    project.write(
        "notes/c.md",
        &typed("Gamma RQ-9", &[("One {#one}", "plain text.")]),
    );
    project.write(
        "notes/d.md",
        &typed("Delta", &[("One {#one}", "[me](#one)")]),
    );

    assert_eq!(
        project.ok(&["stats", "--json"]),
        line(&json!({
            "documents": 4,
            "sections": 4,
            "links": 1,
            "unresolved": 0,
            "isolated": 2
        }))
    );
}

// A count that subtracts the link-connected set and the ticket-connected set separately takes a
// document connected both ways off twice.
#[test]
fn a_document_connected_by_a_link_and_a_ticket_is_counted_once() {
    let project = Project::new(&title_ticket());
    project.write(
        "notes/a.md",
        &typed("Alpha RQ-7", &[("One {#one}", "[[b]]")]),
    );
    project.write(
        "notes/b.md",
        &typed("Beta RQ-7", &[("One {#one}", "plain text.")]),
    );
    project.write(
        "notes/c.md",
        &typed("Gamma", &[("One {#one}", "plain text.")]),
    );

    assert_eq!(
        project.ok(&["stats", "--json"]),
        line(&json!({
            "documents": 3,
            "sections": 3,
            "links": 1,
            "unresolved": 0,
            "isolated": 1
        }))
    );
}

// A grouping by an empty ticket, or a join that reads missing equal to missing, would connect
// every document no rule reached.
#[test]
fn documents_no_ticket_rule_reaches_stay_isolated() {
    let with_rule = Project::new(&title_ticket());
    with_rule.write("notes/plain-one.md", &typed("Plain one", &[("One", "x")]));
    with_rule.write("notes/plain-two.md", &typed("Plain two", &[("One", "x")]));
    let without_rule = Project::notes();
    without_rule.write("notes/a.md", &typed("Alpha RQ-7", &[("One", "x")]));
    without_rule.write("notes/b.md", &typed("Beta RQ-7", &[("One", "x")]));

    for project in [&with_rule, &without_rule] {
        assert_eq!(
            project.ok(&["stats"]),
            "documents  2\nsections  2\nlinks  0\nunresolved  0\nisolated  2/2\n"
        );
    }
}

// An include glob that reaches nothing is an empty corpus, not an error; an empty file is still a
// document with no section.
#[test]
fn an_empty_corpus_and_an_empty_file_are_counted_as_they_are() {
    let none = Project::new(&json!({ "include": ["nothing/**/*.md"] }));
    let empty_file = Project::notes();
    empty_file.write("notes/empty.md", "");

    assert_eq!(
        none.ok(&["stats"]),
        "documents  0\nsections  0\nlinks  0\nunresolved  0\nisolated  0/0\n"
    );
    assert_eq!(
        empty_file.ok(&["stats"]),
        "documents  1\nsections  0\nlinks  0\nunresolved  0\nisolated  1/1\n"
    );
}
