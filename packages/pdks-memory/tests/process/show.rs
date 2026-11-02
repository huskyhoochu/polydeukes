//! `show`: rendering, `--json`, ids, and how markdown is split into sections.

use serde_json::{Value, json};

use crate::common::{Project, assert_refused, line, links};

/// A project holding one document `notes/x` with exactly the given text.
fn one(text: &str) -> Project {
    let project = Project::notes();
    project.write("notes/x.md", text);
    project
}

/// `(anchor, ord, title)` of each section of `notes/x`.
fn shapes(text: &str) -> Vec<(String, i64, String)> {
    sections_of(&one(text).show("notes/x"))
}

fn sections_of(shown: &Value) -> Vec<(String, i64, String)> {
    shown
        .pointer("/sections")
        .and_then(Value::as_array)
        .expect("a document lists its sections")
        .iter()
        .map(|section| {
            let id = section.pointer("/id").and_then(Value::as_str).expect("id");
            let ord = section
                .pointer("/ord")
                .and_then(Value::as_i64)
                .expect("ord");
            let title = section
                .pointer("/title")
                .and_then(Value::as_str)
                .expect("title");
            let anchor = id.strip_prefix("notes/x#").unwrap_or(id);
            (anchor.to_string(), ord, title.to_string())
        })
        .collect()
}

fn shape(anchor: &str, ord: i64, title: &str) -> (String, i64, String) {
    (anchor.to_string(), ord, title.to_string())
}

fn title_of(text: &str) -> Value {
    one(text)
        .show("notes/x")
        .pointer("/title")
        .cloned()
        .expect("a document has a title")
}

const ALPHA: &str = "---\ntitle: Alpha\ntype: decision\n---\n## One\n\nshared-term here.\n\n## Two\n\nalpha only.\n";

// A renderer that reshapes the object or reorders its keys breaks every reader of `--json`;
// the whole line is pinned, key order and compactness included, and carries no `ingestedAt`.
#[test]
fn show_json_of_a_document_is_the_exact_object() {
    let project = Project::notes();
    project.write("notes/alpha.md", ALPHA);

    assert_eq!(
        project.ok(&["show", "notes/alpha", "--json"]),
        "{\"id\":\"notes/alpha\",\"title\":\"Alpha\",\"metadata\":{\"title\":\"Alpha\",\"type\":\"decision\"},\"sections\":[{\"id\":\"notes/alpha#one\",\"ord\":0,\"title\":\"One\",\"body\":\"\\nshared-term here.\\n\"},{\"id\":\"notes/alpha#two\",\"ord\":1,\"title\":\"Two\",\"body\":\"\\nalpha only.\\n\"}],\"links\":{\"out\":[],\"in\":[]},\"related\":[]}\n"
    );
}

#[test]
fn show_json_of_a_section_is_the_exact_object() {
    let project = Project::notes();
    project.write("notes/alpha.md", ALPHA);

    assert_eq!(
        project.ok(&["show", "notes/alpha#two", "--json"]),
        "{\"id\":\"notes/alpha#two\",\"conceptId\":\"notes/alpha\",\"docTitle\":\"Alpha\",\"sectionTitle\":\"Two\",\"body\":\"\\nalpha only.\\n\",\"ord\":1,\"links\":{\"out\":[],\"in\":[]}}\n"
    );
}

// A section printed with every section of its document, or without the document title, loses
// the context that tells a reader which file it came from.
#[test]
fn show_renders_a_section_as_document_then_section_with_only_its_body() {
    let project = Project::notes();
    project.write("notes/alpha.md", ALPHA);

    assert_eq!(
        project.ok(&["show", "notes/alpha#two"]),
        "# Alpha › Two\n\nalpha only.\n"
    );
}

// A title H1 kept in the text before the first H2 would be printed twice under the document's
// own heading; an H1 that is not the title stays.
#[test]
fn show_prints_a_title_h1_once_for_the_document_and_for_its_preamble() {
    let project = Project::notes();
    project.write(
        "notes/delta.md",
        "# Delta\n\nintro text.\n\n## Topic\n\ntopic text.\n",
    );
    project.write(
        "notes/epsilon.md",
        "---\ntitle: Epsilon\n---\n# Another heading\n\nlead.\n\n## Topic\n\nbody.\n",
    );

    assert_eq!(
        project.ok(&["show", "notes/delta"]),
        "# Delta\n\nintro text.\n\n## Topic\n\ntopic text.\n"
    );
    assert_eq!(
        project.ok(&["show", "notes/delta#"]),
        "# Delta\n\nintro text.\n"
    );
    assert!(
        project
            .ok(&["show", "notes/epsilon"])
            .contains("# Another heading\n\nlead.")
    );
}

// A preamble holding only the title H1 renders to nothing and leaves no empty block.
#[test]
fn show_leaves_no_empty_block_for_a_preamble_that_is_only_the_title() {
    let project = one("# Solo\n");

    assert_eq!(project.ok(&["show", "notes/x"]), "# Solo\n");
}

// `--json` is accepted in any position after the verb, and always answers as JSON.
#[test]
fn json_flag_is_accepted_before_and_after_the_id() {
    let project = Project::notes();
    project.write("notes/alpha.md", ALPHA);
    let trailing = project.ok(&["show", "notes/alpha", "--json"]);

    assert_eq!(project.ok(&["show", "--json", "notes/alpha"]), trailing);
    assert!(trailing.starts_with("{\"id\":\"notes/alpha\""));
}

// The document id is tried before the section id: `notes/a#b` is the file `notes/a#b.md`, and
// `notes/a#b#topic` is its section, though `notes/a` also has a section `b`.
#[test]
fn show_prefers_a_document_whose_id_contains_a_hash_over_a_section_id() {
    let project = Project::notes();
    project.write(
        "notes/a#b.md",
        "# Hash document\n\n## Topic\n\nHash document body.\n",
    );
    project.write(
        "notes/a.md",
        "# Parent\n\n## B {#b}\n\nParent section body.\n",
    );

    let document = project.show("notes/a#b");
    assert_eq!(document.pointer("/title"), Some(&json!("Hash document")));
    assert!(document.pointer("/sections").is_some());
    let section = project.show("notes/a#b#topic");
    assert_eq!(section.pointer("/docTitle"), Some(&json!("Hash document")));
    assert_eq!(section.pointer("/sectionTitle"), Some(&json!("Topic")));
    assert_eq!(
        section.pointer("/body"),
        Some(&json!("\nHash document body.\n"))
    );
    assert_refused(
        &project.run(&["show", "notes/a#missing"]),
        "unknown memory id: notes/a#missing",
    );
}

// The frontmatter is shown as parsed, in file order, with the keys the file has.
#[test]
fn show_json_keeps_frontmatter_keys_in_file_order_and_sections_in_source_order() {
    let project = one(
        "---\ntitle: Example\nstatus: draft\ncustom: retained\n---\n# Main\n\nPreamble text.\n\n## Later {#later}\n\nFirst section body.\n\n## Earlier {#earlier}\n\nSecond section body.\n",
    );

    let shown = project.show("notes/x");

    assert_eq!(
        serde_json::to_string(shown.pointer("/metadata").expect("metadata")).expect("serializable"),
        "{\"title\":\"Example\",\"status\":\"draft\",\"custom\":\"retained\"}"
    );
    assert_eq!(
        sections_of(&shown),
        vec![
            shape("", 0, ""),
            shape("later", 1, "Later"),
            shape("earlier", 2, "Earlier")
        ]
    );
}

// Scalars keep their JSON type: a number is not a string, and a timestamp is a string.
#[test]
fn show_json_keeps_the_type_of_each_frontmatter_value() {
    let project = one(
        "---\ncount: 42\nratio: 1.5\nflag: true\nstale_after: 2000-01-01T00:00:00Z\nlist:\n  - a\n  - b\nnested:\n  key: value\nquoted: \"7\"\n---\n## One\nx\n",
    );

    assert_eq!(
        project.show("notes/x").pointer("/metadata"),
        Some(&json!({
            "count": 42,
            "ratio": 1.5,
            "flag": true,
            "stale_after": "2000-01-01T00:00:00Z",
            "list": ["a", "b"],
            "nested": { "key": "value" },
            "quoted": "7"
        }))
    );
}

// JavaScript prints an integral number without a fraction: `1.0` in YAML is `1` in the JSON.
#[test]
fn show_json_prints_an_integral_yaml_float_without_a_fraction() {
    let project = one("---\nversion: 1.0\n---\n## One\nx\n");

    assert_eq!(
        serde_json::to_string(
            project
                .show("notes/x")
                .pointer("/metadata")
                .expect("metadata")
        )
        .expect("serializable"),
        "{\"version\":1}"
    );
}

// A frontmatter that is not a mapping carries no metadata, but its block is still removed
// from the text; an unterminated block is text.
#[test]
fn a_frontmatter_that_is_not_a_mapping_is_dropped_and_an_unterminated_one_is_text() {
    let project = Project::notes();
    project.write("notes/list.md", "---\n- a\n- b\n---\n## One\nx\n");
    project.write("notes/open.md", "---\ntitle: X\n\n## A\nx\n");

    let list = project.show("notes/list");
    assert_eq!(list.pointer("/metadata"), Some(&json!({})));
    assert_eq!(list.pointer("/title"), Some(&json!("notes/list")));
    assert_eq!(
        list.pointer("/sections")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(1)
    );
    let open = project.show("notes/open");
    assert_eq!(open.pointer("/metadata"), Some(&json!({})));
    assert_eq!(open.pointer("/title"), Some(&json!("notes/open")));
    assert_eq!(
        open.pointer("/sections/0/body"),
        Some(&json!("---\ntitle: X\n"))
    );
}

// A frontmatter title that is blank or not a string must not win over the H1.
#[test]
fn a_blank_or_non_string_frontmatter_title_falls_back_to_the_h1() {
    assert_eq!(
        title_of("---\ntitle: \"   \"\n---\n# From H1\n\n## A\nx\n"),
        json!("From H1")
    );
    assert_eq!(
        title_of("---\ntitle: 42\n---\n# From H1\n\n## A\nx\n"),
        json!("From H1")
    );
}

#[test]
fn the_frontmatter_title_wins_over_the_first_h1() {
    assert_eq!(
        title_of("---\ntitle: From frontmatter\n---\n# From H1\n\n## First\n"),
        json!("From frontmatter")
    );
}

// A YAML error that propagates would refuse the document; one swallowed without removing the
// block would leak the broken YAML into the preamble.
#[test]
fn a_frontmatter_that_is_not_valid_yaml_keeps_the_document_and_leaves_the_text() {
    let project =
        one("---\ntitle: [unclosed\n---\n# Heading one {#h1}\n\nPreamble.\n\n## First\n\nBody.\n");

    let shown = project.show("notes/x");

    assert_eq!(shown.pointer("/title"), Some(&json!("Heading one")));
    assert_eq!(shown.pointer("/metadata"), Some(&json!({})));
    assert_eq!(
        sections_of(&shown),
        vec![shape("", 0, ""), shape("first", 1, "First")]
    );
    let preamble = shown
        .pointer("/sections/0/body")
        .and_then(Value::as_str)
        .expect("body");
    assert!(!preamble.contains("[unclosed"));
}

#[test]
fn a_document_without_frontmatter_takes_its_title_from_the_h1() {
    let shown = one("# Plain document\n\nIntro.\n\n## First\n\nBody.\n").show("notes/x");

    assert_eq!(shown.pointer("/title"), Some(&json!("Plain document")));
    assert_eq!(
        sections_of(&shown),
        vec![shape("", 0, ""), shape("first", 1, "First")]
    );
    let preamble = shown
        .pointer("/sections/0/body")
        .and_then(Value::as_str)
        .expect("body");
    assert!(preamble.contains("# Plain document"));
}

// An empty H1 would leave every title empty; closing hashes must not be part of the title.
#[test]
fn an_empty_h1_is_skipped_and_closing_hashes_are_removed_from_an_h1() {
    assert_eq!(title_of("# \n\n## A\nx\n"), json!("notes/x"));
    assert_eq!(title_of("# Title #\n\n## A\n"), json!("Title"));
}

// An empty file is still a document: no sections, titled by its id.
#[test]
fn an_empty_file_is_a_document_with_no_sections() {
    let project = one("");

    assert_eq!(
        project.ok(&["show", "notes/x", "--json"]),
        line(&json!({
            "id": "notes/x",
            "title": "notes/x",
            "metadata": {},
            "sections": [],
            "links": links(vec![], vec![]),
            "related": []
        }))
    );
    assert_eq!(project.ok(&["show", "notes/x"]), "# notes/x\n");
}

// A whitespace-only preamble that still made a row would shift every ord by one.
#[test]
fn a_whitespace_only_preamble_makes_no_section() {
    assert_eq!(
        shapes("---\ntitle: T\n---\n\n   \n\n## First\n\nBody.\n"),
        vec![shape("first", 0, "First")]
    );
}

// The explicit anchor wins over the slug and leaves the title; closing hashes leave the title;
// the explicit anchor is taken off before the closing hashes.
#[test]
fn heading_decorations_are_removed_from_the_title_and_an_explicit_anchor_wins() {
    assert_eq!(
        shapes(
            "## Acceptance criteria {#acceptance}\n\nBody.\n\n## Closed heading ##\n\nBody.\n\n## Title ## {#x}\n\nBody.\n"
        ),
        vec![
            shape("acceptance", 0, "Acceptance criteria"),
            shape("closed-heading", 1, "Closed heading"),
            shape("x", 2, "Title")
        ]
    );
}

// An ASCII-only slug erases Korean letters; the slug keeps letters, digits, `_`, `-`, and spaces.
#[test]
fn a_korean_heading_is_slugged_the_way_github_does() {
    assert_eq!(
        shapes("## 수용 기준 (AC)\n\nBody.\n"),
        vec![shape("수용-기준-ac", 0, "수용 기준 (AC)")]
    );
}

// Two sections with the same anchor must not collide on the id: the later one is suffixed.
#[test]
fn a_duplicate_anchor_is_suffixed_in_order_of_appearance() {
    assert_eq!(
        shapes(
            "## Notes {#footnotes}\n\nA.\n\n## Other\n\nB.\n\n## Notes {#footnotes}\n\nC.\n\n## Notes {#footnotes}\n\nD.\n"
        ),
        vec![
            shape("footnotes", 0, "Notes"),
            shape("other", 1, "Other"),
            shape("footnotes-1", 2, "Notes"),
            shape("footnotes-2", 3, "Notes")
        ]
    );
}

// The preamble's empty anchor is always taken, so an H2 whose slug is empty is suffixed even when
// the preamble made no row; a bare `##` is an H2 with an empty title.
#[test]
fn an_h2_with_an_empty_slug_gets_the_anchor_minus_one() {
    assert_eq!(
        shapes("Preamble.\n\n## ???\n\nBody.\n"),
        vec![shape("", 0, ""), shape("-1", 1, "???")]
    );
    assert_eq!(shapes("## ???\n\nBody.\n"), vec![shape("-1", 0, "???")]);
    assert_eq!(
        shapes("Pre.\n##\nbody\n"),
        vec![shape("", 0, ""), shape("-1", 1, "")]
    );
}

// A `## ` line inside a fence is code, not a heading; the fence closes on a marker of the same
// character that is at least as long, and an unterminated fence runs to the end.
#[test]
fn a_heading_line_inside_a_fence_stays_in_the_body() {
    let backtick = one("## Real\n\n```md\n## Not a heading\n```\n\nAfter the fence.\n");
    let tilde = one("## Real\n\n~~~\n## Not a heading\n~~~\n\nAfter the fence.\n");
    let longer = one("## Real\n\n````\n## Y\n```\n## Z\n````\n\n## After\n\nx\n");
    let open = one("## A\n```\n## B\nx\n");

    for project in [&backtick, &tilde] {
        let shown = project.show("notes/x");
        assert_eq!(sections_of(&shown), vec![shape("real", 0, "Real")]);
        let body = shown
            .pointer("/sections/0/body")
            .and_then(Value::as_str)
            .expect("body");
        assert!(body.contains("## Not a heading") && body.contains("After the fence."));
    }
    assert_eq!(
        sections_of(&longer.show("notes/x")),
        vec![shape("real", 0, "Real"), shape("after", 1, "After")]
    );
    assert_eq!(sections_of(&open.show("notes/x")), vec![shape("a", 0, "A")]);
}

// A backtick line whose info string holds a backtick is inline code, not a fence opener.
#[test]
fn a_backtick_line_with_a_backtick_in_its_info_string_is_not_a_fence() {
    assert_eq!(
        shapes("```js``` inline\n\n## A\n\nx\n"),
        vec![shape("", 0, ""), shape("a", 1, "A")]
    );
}

// Only `##` is a section boundary: an H3 stays in its section.
#[test]
fn an_h3_heading_stays_inside_its_h2_section() {
    let shown = one("## Parent\n\nIntro.\n\n### Child\n\nChild body.\n").show("notes/x");

    assert_eq!(sections_of(&shown), vec![shape("parent", 0, "Parent")]);
    let body = shown
        .pointer("/sections/0/body")
        .and_then(Value::as_str)
        .expect("body");
    assert!(body.contains("### Child") && body.contains("Child body."));
}

// The heading indent boundary is three spaces: four spaces is an indented code line.
#[test]
fn a_heading_indented_four_spaces_is_body_text() {
    let shown = one("   ## Indented\n\nA.\n\n    ## Code line\n\nB.\n").show("notes/x");

    assert_eq!(sections_of(&shown), vec![shape("indented", 0, "Indented")]);
    let body = shown
        .pointer("/sections/0/body")
        .and_then(Value::as_str)
        .expect("body");
    assert!(body.contains("## Code line"));
}

// A CRLF file with a byte-order mark reads exactly like its LF form.
#[test]
fn a_crlf_document_with_a_byte_order_mark_reads_like_its_lf_form() {
    let project = Project::notes();
    project.write(
        "notes/crlf.md",
        "\u{feff}---\r\ntitle: T\r\n---\r\n# H\r\n\r\n## A\r\n\r\nx\r\n",
    );
    project.write("notes/lf.md", "---\ntitle: T\n---\n# H\n\n## A\n\nx\n");

    let crlf = project.show("notes/crlf");
    let lf = project.show("notes/lf");

    for key in [
        "/title",
        "/metadata",
        "/sections/0/body",
        "/sections/1/body",
    ] {
        assert_eq!(crlf.pointer(key), lf.pointer(key), "{key}");
    }
    assert_eq!(crlf.pointer("/metadata"), Some(&json!({ "title": "T" })));
}

fn hub_project() -> Project {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "ticket": [{ "from": "title", "pattern": "RQ-[0-9]+" }]
    }));
    project.write(
        "notes/hub.md",
        "---\ntitle: Hub\ntype: note\n---\n## One\n\n[[gamma]] and [[nowhere]] and [g](gamma.md#one).\n",
    );
    project.write(
        "notes/gamma.md",
        "---\ntitle: Gamma\ntype: note\n---\n## One\n\ngamma text.\n",
    );
    project
}

// A renderer that prints the block for a link-free document changes the bytes every reader of
// `show` parses; one that prints `null` for an unresolved target, drops the `in` lines on the
// target document, or orders the lines by target document rather than by section and text as
// written diverges from the pinned form.
#[test]
fn show_appends_a_links_block_only_for_a_document_that_has_links() {
    let project = hub_project();

    assert_eq!(
        project.ok(&["show", "notes/hub"]),
        "# Hub\n\n## One\n\n[[gamma]] and [[nowhere]] and [g](gamma.md#one).\n\n## links\nout  notes/hub#one  [[gamma]]  → notes/gamma\nout  notes/hub#one  [[nowhere]]  → unresolved\nout  notes/hub#one  gamma.md#one  → notes/gamma#one\n"
    );
    assert_eq!(
        project.ok(&["show", "notes/gamma"]),
        "# Gamma\n\n## One\n\ngamma text.\n\n## links\nin  notes/hub#one  → notes/gamma\nin  notes/hub#one  → notes/gamma#one\n"
    );
    assert_eq!(
        project.ok(&["show", "notes/gamma#one"]),
        "# Gamma › One\n\ngamma text.\n\n## links\nin  notes/hub#one  → notes/gamma#one\n"
    );
}

// A related block printed before the links block, for a document with no ticket partner, or on a
// section, reshapes the bytes every reader of `show` parses; one that joins the ids on one line
// differs once there are two.
#[test]
fn show_appends_a_related_block_after_the_links_block_for_a_document_only() {
    let project = hub_project();
    project.write(
        "notes/pair-a.md",
        "---\ntitle: Pair A RQ-7\ntype: note\n---\n## One\n\n[[gamma]] here.\n",
    );
    project.write(
        "notes/pair-b.md",
        "---\ntitle: Pair B RQ-7\ntype: note\n---\n## One\n\npair b text.\n",
    );
    project.write(
        "notes/pair-c.md",
        "---\ntitle: Pair C RQ-7\ntype: note\n---\n## One\n\npair c text.\n",
    );

    assert_eq!(
        project.ok(&["show", "notes/pair-a"]),
        "# Pair A RQ-7\n\n## One\n\n[[gamma]] here.\n\n## links\nout  notes/pair-a#one  [[gamma]]  → notes/gamma\n\n## related\nnotes/pair-b\nnotes/pair-c\n"
    );
    assert_eq!(
        project.ok(&["show", "notes/pair-b"]),
        "# Pair B RQ-7\n\n## One\n\npair b text.\n\n## related\nnotes/pair-a\nnotes/pair-c\n"
    );
    assert_eq!(
        project.ok(&["show", "notes/pair-a#one"]),
        "# Pair A RQ-7 › One\n\n[[gamma]] here.\n\n## links\nout  notes/pair-a#one  [[gamma]]  → notes/gamma\n"
    );
}
