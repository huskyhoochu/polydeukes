//! `lint`: five rules, in a fixed order, and the exit code 1 when any rule is violated.

use serde_json::{Value, json};

use crate::common::{Project, doc, line, page, typed};

const SUPERSEDES_KEY: &str = "(?<=doc:)[A-Za-z0-9-]+";
const NEWER: &str = "notes/v011";
const OLDER: &str = "notes/graph-model";
const DECLARATION: &str = "Supersedes: doc:graph-model";

// The older document's items as written in an ADR: bold markers, an italic word, an inline code
// span, and a line break inside a parenthesis.
const OLDER_ITEMS: &str = "3. **dangling은 침묵 누락이 아니라 *거부*** — ingest 시 dst public_id가 없으면 에러. memoriq의\n   \"조용히 버림\"을 \"명시적 실패\"로 뒤집는다.\n5. **ingest-time link 요구** — 같은 ticket/area에 기존 row가 있는데 link 0개면 차단(`--no-link`\n   명시 예외). 81.5% 고립을 *결정론적으로* 막는다. (roadmap KB-05)";
const QUOTE_ONE: &str =
    "「dangling은 침묵 누락이\n아니라 *거부* — ingest 시 dst public_id가 없으면 에러」";
const QUOTE_TWO: &str = "「ingest-time link 요구 — 같은 ticket/area에\n기존 row가 있는데 link 0개면 차단(`--no-link` 명시 예외)」";

fn violation(rule: &str, id: &str, detail: &str) -> Value {
    json!({ "rule": rule, "id": id, "detail": detail })
}

fn with_ticket() -> Project {
    Project::new(&json!({
        "include": ["notes/**/*.md"],
        "ticket": [{ "from": "title", "pattern": "RQ-[0-9]+" }]
    }))
}

/// One tree that breaks every rule at least once and holds a near miss for each: `hub` links out
/// (so it is not unlinked) but two of its targets are missing; `spoke` shares hub's ticket and
/// links to nothing; `dangling` and `selfish` share it too and link only to a missing target or to
/// their own section; `solo` links to nothing but no other document shares its ticket; `typeless`,
/// `emptytype`, `numtype`, and `broken` carry no usable type in four shapes.
fn violating_tree(project: &Project) {
    project.write(
        "notes/hub.md",
        &typed(
            "Hub RQ-7",
            &[
                ("one {#one}", "[[spoke]] [y](zzz.md) [[nowhere]]"),
                ("two {#two}", "[x](missing.md)"),
            ],
        ),
    );
    project.write(
        "notes/spoke.md",
        &typed("Spoke RQ-7", &[("one {#one}", "spoke text.")]),
    );
    project.write(
        "notes/dangling.md",
        &typed("Dangling RQ-7", &[("one {#one}", "[[nowhere-else]]")]),
    );
    project.write(
        "notes/selfish.md",
        &typed("Selfish RQ-7", &[("one {#one}", "[me](#one)")]),
    );
    project.write(
        "notes/solo.md",
        &typed("Solo RQ-9", &[("one {#one}", "solo text.")]),
    );
    project.write(
        "notes/typeless.md",
        "---\ntitle: Typeless\n---\n## One\ntypeless text.\n",
    );
    project.write(
        "notes/emptytype.md",
        "---\ntitle: Empty type\ntype: \"\"\n---\n## One\nempty text.\n",
    );
    project.write(
        "notes/numtype.md",
        "---\ntitle: Number type\ntype: 3\n---\n## One\nnumber text.\n",
    );
    project.write(
        "notes/broken.md",
        "---\n: [\n---\n## One\nunparseable frontmatter.\n",
    );
}

fn unresolved_rows() -> Vec<Value> {
    vec![
        violation("unresolved", "notes/dangling#one", "[[nowhere-else]]"),
        violation("unresolved", "notes/hub#one", "[[nowhere]]"),
        violation("unresolved", "notes/hub#one", "zzz.md"),
        violation("unresolved", "notes/hub#two", "missing.md"),
    ]
}

fn untyped_rows() -> Vec<Value> {
    ["broken", "emptytype", "numtype", "typeless"]
        .iter()
        .map(|name| violation("untyped", &format!("notes/{name}"), ""))
        .collect()
}

// A rule that reports every unlinked document adds `solo`; one that counts only resolved outgoing
// links adds `dangling`, only cross-document links adds `selfish`; a type check by truthiness keeps
// `numtype`, one by `typeof` alone keeps `emptytype`, one that reads the type of an unparseable
// frontmatter keeps `broken`; a sort by id alone interleaves the rules; a detail that strips the
// wikilink brackets prints `nowhere`. Exit code 1 says a rule was violated.
#[test]
fn lint_reports_unresolved_unlinked_and_untyped_in_rule_id_detail_order_and_exits_one() {
    let project = with_ticket();
    violating_tree(&project);

    let out = project.run(&["lint"]);

    assert_eq!(out.code, 1, "stderr: {}", out.stderr);
    assert_eq!(out.stderr, "");
    assert_eq!(
        out.stdout,
        [
            "unresolved  notes/dangling#one  [[nowhere-else]]",
            "unresolved  notes/hub#one  [[nowhere]]",
            "unresolved  notes/hub#one  zzz.md",
            "unresolved  notes/hub#two  missing.md",
            "unlinked  notes/spoke  RQ-7",
            "untyped  notes/broken",
            "untyped  notes/emptytype",
            "untyped  notes/numtype",
            "untyped  notes/typeless",
            ""
        ]
        .join("\n")
    );
    let json = project.run(&["lint", "--json"]);
    assert_eq!(json.code, 1);
    let mut expected = unresolved_rows();
    expected.push(violation("unlinked", "notes/spoke", "RQ-7"));
    expected.extend(untyped_rows());
    assert_eq!(json.stdout, line(&json!({ "violations": expected })));
}

// A rule that groups documents by an empty ticket reports every ticket-less document as unlinked
// once no rule fills the ticket.
#[test]
fn unlinked_is_never_reported_when_no_ticket_rule_is_declared() {
    let project = Project::notes();
    violating_tree(&project);

    let out = project.run(&["lint", "--json"]);

    assert_eq!(out.code, 1);
    let mut expected = unresolved_rows();
    expected.extend(untyped_rows());
    assert_eq!(out.stdout, line(&json!({ "violations": expected })));
}

// A clean corpus is exit 0 with nothing on stdout; a script that gates on the exit code must not
// read a clean corpus as a violation.
#[test]
fn a_clean_corpus_exits_zero_with_an_empty_report() {
    let project = Project::notes();
    project.write("notes/a.md", &typed("A", &[("One", "text.")]));

    assert_eq!(project.ok(&["lint"]), "");
    assert_eq!(project.ok(&["lint", "--json"]), "{\"violations\":[]}\n");
}

// A type check keyed on the presence of the `type` key counts `type: ""` as a type in use.
#[test]
fn untyped_is_silent_when_the_only_type_in_the_corpus_is_an_empty_string() {
    let project = Project::notes();
    project.write(
        "notes/a.md",
        "---\ntitle: A\ntype: \"\"\n---\n## One\na text.\n",
    );
    project.write("notes/b.md", &page("B", &[("One", "b text.")]));

    assert_eq!(project.ok(&["lint"]), "");
}

// Rules and ids are ordered rule first: unresolved, untyped, unresolved-supersession, unquoted; then
// id, then detail. The line's fields are joined by two spaces and an empty detail leaves no
// trailing separator.
#[test]
fn violations_are_ordered_by_rule_then_id_then_detail_across_all_five_rules() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "supersedes": [{ "line": "Supersedes:", "key": SUPERSEDES_KEY, "direction": "supersedes" }]
    }));
    project.write(
        "notes/graph-model.md",
        &typed("Graph model", &[("Decision", OLDER_ITEMS)]),
    );
    project.write(
        "notes/v011.md",
        &typed(
            "Store design",
            &[(
                "D6",
                &format!("{DECLARATION}\nSupersedes: doc:zz-gone and doc:aa-gone"),
            )],
        ),
    );
    project.write(
        "notes/second.md",
        &typed("Second", &[("Topic", DECLARATION)]),
    );
    project.write(
        "notes/linker.md",
        &typed("Linker", &[("Topic", "[[nowhere]] here.")]),
    );
    project.write(
        "notes/untyped.md",
        "---\ntitle: Untyped\n---\n## Topic\nplain.\n",
    );

    let out = project.run(&["lint"]);

    assert_eq!(out.code, 1);
    assert_eq!(
        out.stdout,
        [
            "unresolved  notes/linker#topic  [[nowhere]]",
            "untyped  notes/untyped",
            "unresolved-supersession  notes/v011  supersedes aa-gone",
            "unresolved-supersession  notes/v011  supersedes zz-gone",
            "unquoted  notes/second  notes/graph-model",
            "unquoted  notes/v011  notes/graph-model",
            ""
        ]
        .join("\n")
    );
}

/// The `lint` exit code and report of a tree whose newer document declares that it replaces the
/// older one and carries `body` besides, under a given older text.
fn unquoted_after(older: &str, body: &str) -> (i32, String) {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "supersedes": [{ "line": "Supersedes:", "key": SUPERSEDES_KEY, "direction": "supersedes" }]
    }));
    project.write(
        "notes/graph-model.md",
        &typed("Graph model", &[("Decision", older)]),
    );
    project.write(
        "notes/v011.md",
        &typed("Store design", &[("D6", &format!("{DECLARATION}\n{body}"))]),
    );
    let out = project.run(&["lint"]);
    (out.code, out.stdout)
}

const UNQUOTED_LINE: &str = "unquoted  notes/v011  notes/graph-model\n";

// A comparison over the raw text finds neither quotation: the first differs from the item by `**`
// around the phrase and a line break, the second by the line break inside the parenthesis.
#[test]
fn a_paragraph_quoting_the_items_it_overturns_is_not_reported() {
    let paragraph = format!(
        "**이 결정은 `memory.adr.graph-model.md`의 두 항목을 대체한다.** 그 ADR은 {QUOTE_ONE}와 {QUOTE_TWO}을 정했다. DB가 원문의 파생물이 된 뒤로\ningest가 거부하면 DB와 원문이 어긋나고, 거부된 문서는 git에 그대로 남는다."
    );

    assert_eq!(unquoted_after(OLDER_ITEMS, &paragraph), (0, String::new()));
}

// A check that treats any 「」 or any sentence of the newer document as a quotation, or never runs,
// stays silent on a declaration that quotes nothing; a violation keyed on the older document sends
// the reader to the wrong file.
#[test]
fn a_declaration_that_quotes_nothing_is_reported_on_the_newer_document() {
    let paragraph = "**이 결정은 `memory.adr.graph-model.md`의 두 항목을 대체한다.** 그 ADR은 두 항목과 한 항목을 정했다.";

    assert_eq!(
        unquoted_after(OLDER_ITEMS, paragraph),
        (1, UNQUOTED_LINE.to_string())
    );
}

// Each form alone is the quotation: a check that reads only 「」 misses the blockquote and the curly
// quotes; one that compares text as written misses a link written where the item has a bare word, a
// dropped code span, a wikilink alias, or a dropped italic marker.
#[test]
fn each_quotation_form_is_accepted_after_normalising_the_markup() {
    for (form, body) in [
        (
            "a blockquote line differing by an italic marker",
            "> 81.5% 고립을 결정론적으로 막는다.",
        ),
        (
            "curly quotes with a markdown link and the code span dropped",
            "“같은 ticket/area에 기존 row가 있는데 [link](https://example.test/link) 0개면 차단(--no-link 명시 예외)”",
        ),
        (
            "corner brackets with a wikilink alias standing for the item words",
            "「[[graph-model|ingest-time link 요구]] — 같은 ticket/area에」",
        ),
        (
            "a blockquote line whose own marker is stripped before comparing",
            "> > memoriq의 \"조용히 버림\"을 \"명시적 실패\"로 뒤집는다.",
        ),
    ] {
        assert_eq!(
            unquoted_after(OLDER_ITEMS, body),
            (0, String::new()),
            "{form}"
        );
    }
}

// An empty quotation normalises to the empty string, which every text contains: a check without the
// non-empty condition accepts 「」, “”, and a bare `>` line. Words the older document never wrote,
// and straight ASCII quotes, are no quotation.
#[test]
fn an_empty_or_unmatched_or_ascii_quoted_text_is_still_reported() {
    for (form, body) in [
        ("empty corner brackets", "「」"),
        ("empty curly quotes", "“”"),
        ("a blockquote of whitespace", ">   "),
        (
            "a quotation the older document does not contain",
            "「이 문장은 어디에도 없다」",
        ),
        (
            "a matching sentence inside straight ASCII double quotes",
            "\"81.5% 고립을 결정론적으로 막는다.\"",
        ),
    ] {
        assert_eq!(
            unquoted_after(OLDER_ITEMS, body),
            (1, UNQUOTED_LINE.to_string()),
            "{form}"
        );
    }
}

// The older text is normalised too: its link target, wikilink brackets, blockquote marker,
// reference label, tildes, and image syntax must not stop a bare quotation of the visible words from
// matching; a reference link or strikethrough in the quotation is handled the same way.
#[test]
fn markup_on_either_side_does_not_hide_a_quotation() {
    for (form, older, quote) in [
        (
            "a markdown link in the older text",
            "the [link](https://example.test/x) applies here.",
            "「the link applies here.」",
        ),
        (
            "a wikilink alias in the older text",
            "see [[graph-model|the model]] first.",
            "「see the model first.」",
        ),
        (
            "a blockquote marker in the older text",
            "> quoted line in the older document.",
            "「quoted line in the older document.」",
        ),
        (
            "a reference-style link in the older text",
            "refer to [text][ref] here.\n\n[ref]: https://example.test/ref",
            "「refer to text here.」",
        ),
        (
            "a strikethrough in the older text",
            "this is ~~struck~~ through.",
            "「this is struck through.」",
        ),
        (
            "an image in the older text",
            "an ![alt text](img.png) inline.",
            "「an alt text inline.」",
        ),
        (
            "a reference-style link in the quotation",
            "refer to text here.",
            "“refer to [text][ref] here.”",
        ),
        (
            "a strikethrough in the quotation",
            "this is struck through.",
            "> this is ~~struck~~ through.",
        ),
    ] {
        assert_eq!(unquoted_after(older, quote), (0, String::new()), "{form}");
    }
}

// The text before the first H2 is the document's head: documents written from one template share
// its blockquote lines word for word without quoting each other, so those lines are no quotation.
#[test]
fn a_blockquote_line_of_the_head_shared_by_both_documents_is_not_a_quotation() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "supersedes": [{ "line": "Supersedes:", "key": SUPERSEDES_KEY, "direction": "supersedes" }]
    }));
    let head = "> Written with: the shared planning template, section by section.";
    project.write(
        "notes/graph-model.md",
        &format!(
            "{}{head}\n\n## Decision\n{OLDER_ITEMS}\n",
            doc(&[("title", "Graph model"), ("type", "note")], &[])
        ),
    );
    project.write(
        "notes/v011.md",
        &format!(
            "{}{head}\n\n## D6\n{DECLARATION}\nNothing quoted.\n",
            doc(&[("title", "Store design"), ("type", "note")], &[])
        ),
    );

    let out = project.run(&["lint"]);

    assert_eq!((out.code, out.stdout.as_str()), (1, UNQUOTED_LINE));
}

// A comparison over the older document's first section alone misses a sentence in its second; one
// over the newer document's declaring section alone misses a quotation in a later section.
#[test]
fn the_quoted_sentence_may_be_in_any_section_of_either_document() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "supersedes": [{ "line": "Supersedes:", "key": SUPERSEDES_KEY, "direction": "supersedes" }]
    }));
    project.write(
        "notes/graph-model.md",
        &typed(
            "Graph model",
            &[
                ("First", "nothing relevant."),
                ("Second", "the sentence lives here."),
            ],
        ),
    );
    project.write(
        "notes/v011.md",
        &typed(
            "Store design",
            &[
                ("D6", DECLARATION),
                ("Later", "「the sentence lives here.」"),
            ],
        ),
    );

    assert_eq!(project.ok(&["lint"]), "");
}

// Only the newer document's own declaration asks it to quote: an older document's `superseded-by`
// line does not, though the pair it resolves to exists.
#[test]
fn a_pair_from_a_superseded_by_line_is_never_reported_as_unquoted() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "supersedes": [
            { "line": "Supersedes:", "key": SUPERSEDES_KEY, "direction": "supersedes" },
            { "line": "Superseded by:", "key": SUPERSEDES_KEY, "direction": "superseded-by" }
        ]
    }));
    project.write(
        "notes/graph-model.md",
        &typed(
            "Graph model",
            &[(
                "Decision",
                &format!("Superseded by: doc:v011\n{OLDER_ITEMS}"),
            )],
        ),
    );
    project.write(
        "notes/v011.md",
        &typed("Store design", &[("D6", "두 항목을 대체한다.")]),
    );

    assert_eq!(
        project.ok(&["supersession", NEWER]),
        format!("{NEWER}\t{OLDER}\n")
    );
    assert_eq!(project.ok(&["lint"]), "");
}
