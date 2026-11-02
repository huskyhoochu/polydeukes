//! Which links a section holds and what each one resolves to, read through `show --json`.
//!
//! `out` lists the links written in a document or section and `in` the links that arrive at it,
//! each sorted by the section they are written in and then by their text as written; `to` is the
//! section when the link names one, else the document, else `null`.

use serde_json::json;

use crate::common::{Project, anchored_page, link, links, links_of, page};

// A scanner that reads inside code spans (one that runs over a line break included) or fences,
// or that lets an unclosed backtick run past a blank line or retries a longer run as a shorter
// one, reports `inline`, `spanned`, `fenced`, `tilde` or `coded`, or loses `kept`.
#[test]
fn links_inside_code_spans_and_fences_are_not_links() {
    let project = Project::notes();
    project.write(
        "notes/alpha.md",
        &[
            "## One",
            "`[[inline]]` and `[code](inline.md)` stay out.",
            "A span `opens on this line and",
            "closes [[spanned]] on the next` one.",
            "A lone ` backtick never closes.",
            "",
            "The next paragraph keeps [[kept]].",
            "",
            "A run ``` of three with no closing run stays text,",
            "so `[[coded]]` is code and [[real]] is a link.",
            "```md",
            "[[fenced]] [f](fenced.md)",
            "```",
            "~~~",
            "[[tilde]] [t](tilde.md)",
            "~~~",
            "",
        ]
        .join("\n"),
    );

    assert_eq!(
        links_of(&project.show("notes/alpha")),
        links(
            vec![
                link("notes/alpha#one", "[[kept]]", None),
                link("notes/alpha#one", "[[real]]", None),
            ],
            vec![]
        )
    );
}

// An image's `[…](…)` tail, a URL or `mailto:` target, and a target that is not a `.md` file are
// no links; a `.md` link is.
#[test]
fn images_schemes_and_non_markdown_targets_are_not_links() {
    let project = Project::notes();
    project.write(
        "notes/alpha.md",
        &page(
            "Alpha",
            &[(
                "One",
                "![shot](gamma.md) [site](https://example.com/x.md) [mail](mailto:a@b.c) [file](data.json) [txt](data.txt#one) [ok](ok.md)",
            )],
        ),
    );
    project.write("notes/ok.md", &page("Ok", &[("One", "x")]));

    assert_eq!(
        links_of(&project.show("notes/alpha")),
        links(
            vec![link("notes/alpha#one", "ok.md", Some("notes/ok"))],
            vec![]
        )
    );
}

// A link repeated in one section is one link; the same wikilink in two sections is two, one per
// section; `[[x]]` and `[x](x.md)` are different forms. A `#one` link inside its own document
// arrives at that document too.
#[test]
fn a_link_is_kept_once_per_section_form_and_target() {
    let project = Project::notes();
    project.write(
        "notes/alpha.md",
        &anchored_page(
            "Alpha",
            &[
                (
                    "one",
                    "[[beta]] and again [[beta]] and [text](beta.md) and [anchored](beta.md#one) and [same](#one).",
                ),
                ("two", "[[beta]]"),
            ],
        ),
    );
    project.write(
        "notes/beta.md",
        &anchored_page("Beta", &[("one", "beta text.")]),
    );

    assert_eq!(
        links_of(&project.show("notes/alpha")),
        links(
            vec![
                link("notes/alpha#one", "#one", Some("notes/alpha#one")),
                link("notes/alpha#one", "[[beta]]", Some("notes/beta")),
                link("notes/alpha#one", "beta.md", Some("notes/beta")),
                link("notes/alpha#one", "beta.md#one", Some("notes/beta#one")),
                link("notes/alpha#two", "[[beta]]", Some("notes/beta")),
            ],
            vec![link("notes/alpha#one", "#one", Some("notes/alpha#one"))]
        )
    );
}

// Link text may wrap onto the next line but not past a blank line; a link in the preamble counts;
// a link in the frontmatter does not.
#[test]
fn wrapped_link_text_preamble_links_and_frontmatter_links() {
    let project = Project::notes();
    project.write(
        "notes/alpha.md",
        "---\ntitle: Alpha\nsee: \"[[frontmatter-only]]\"\n---\nLead with [[pre]].\n\n## One\nA paragraph wrapped inside [the link\ntext](wrapped.md) still links.\n\n[broken\n\ntext](blank.md)\n",
    );

    assert_eq!(
        links_of(&project.show("notes/alpha")),
        links(
            vec![
                link("notes/alpha#", "[[pre]]", None),
                link("notes/alpha#one", "wrapped.md", None),
            ],
            vec![]
        )
    );
}

fn resolution_project() -> Project {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md"],
        "exclude": ["**/index.md", "**/log.md"]
    }));
    project.write(
        "outside.md",
        &anchored_page("Outside", &[("one", "not indexed.")]),
    );
    project.write(
        "notes/index.md",
        &anchored_page("Index", &[("one", "excluded by config.")]),
    );
    project.write(
        "notes/log.md",
        &anchored_page("Log", &[("one", "excluded by config.")]),
    );
    project.write(
        "notes/top.md",
        &anchored_page(
            "Top",
            &[
                (
                    "one",
                    "[a](sub/leaf.md) [b](sub/leaf.md#here) [c](sub/leaf.md#deep) [d](#two) [e](../outside.md) [f](index.md) [g](sub/missing.md#one) [h](./sub/leaf.md) [i](../../notes/twin.md) [j](#nope) [k](log.md)",
                ),
                ("two", "body."),
            ],
        ),
    );
    project.write(
        "notes/sub/leaf.md",
        &anchored_page(
            "Leaf",
            &[
                ("here", "[up](../top.md#one)\n### Deep {#deep}\ndeep text."),
                ("twin", "twin text."),
            ],
        ),
    );
    project.write(
        "notes/twin.md",
        &anchored_page("Twin", &[("one", "x"), ("own", "x")]),
    );
    project.write(
        "notes/sub/twin.md",
        &anchored_page("Other twin", &[("alone", "x")]),
    );
    project.write(
        "notes/other/far.md",
        &anchored_page("Far", &[("one", "[[twin]]")]),
    );
    project.write(
        "notes/wiki.md",
        &anchored_page(
            "Wiki",
            &[
                (
                    "own",
                    "[[leaf]] [[own]] [[here]] [[twin]] [[one]] [[nowhere]] [[index]]",
                ),
                ("leaf", "x"),
            ],
        ),
    );
    project
}

// A path resolves against the source's directory, `./` is normalised, a path above the root is not
// clamped, an excluded document and one outside `include` are unresolved, an H3 is no section, and a
// missing anchor leaves the document.
#[test]
fn paths_resolve_against_the_source_directory_and_stop_at_the_root() {
    let project = resolution_project();

    assert_eq!(
        links_of(&project.show("notes/top")),
        links(
            vec![
                link("notes/top#one", "#nope", Some("notes/top")),
                link("notes/top#one", "#two", Some("notes/top#two")),
                link("notes/top#one", "../../notes/twin.md", None),
                link("notes/top#one", "../outside.md", None),
                link("notes/top#one", "./sub/leaf.md", Some("notes/sub/leaf")),
                link("notes/top#one", "index.md", None),
                link("notes/top#one", "log.md", None),
                link("notes/top#one", "sub/leaf.md", Some("notes/sub/leaf")),
                link("notes/top#one", "sub/leaf.md#deep", Some("notes/sub/leaf")),
                link(
                    "notes/top#one",
                    "sub/leaf.md#here",
                    Some("notes/sub/leaf#here")
                ),
                link("notes/top#one", "sub/missing.md#one", None),
            ],
            vec![
                link(
                    "notes/sub/leaf#here",
                    "../top.md#one",
                    Some("notes/top#one")
                ),
                link("notes/top#one", "#nope", Some("notes/top")),
                link("notes/top#one", "#two", Some("notes/top#two")),
            ]
        )
    );
}

// A wikilink tries a document name before a section of its own document before the one section
// anywhere with that anchor; an ambiguous anchor is unresolved.
#[test]
fn a_wikilink_tries_a_document_name_then_its_own_section_then_the_one_anchor() {
    let project = resolution_project();

    assert_eq!(
        links_of(&project.show("notes/wiki")),
        links(
            vec![
                link("notes/wiki#own", "[[here]]", Some("notes/sub/leaf#here")),
                link("notes/wiki#own", "[[index]]", None),
                link("notes/wiki#own", "[[leaf]]", Some("notes/sub/leaf")),
                link("notes/wiki#own", "[[nowhere]]", None),
                link("notes/wiki#own", "[[one]]", None),
                link("notes/wiki#own", "[[own]]", Some("notes/wiki#own")),
                link("notes/wiki#own", "[[twin]]", Some("notes/twin")),
            ],
            vec![link("notes/wiki#own", "[[own]]", Some("notes/wiki#own"))]
        )
    );
}

// With two documents named `twin` and none beside the source, the name is ambiguous and the link
// falls through to the one section anywhere with that anchor.
#[test]
fn a_wikilink_from_a_directory_with_neither_duplicate_finds_the_one_anchor_elsewhere() {
    let project = resolution_project();

    assert_eq!(
        links_of(&project.show("notes/other/far")),
        links(
            vec![link(
                "notes/other/far#one",
                "[[twin]]",
                Some("notes/sub/leaf#twin")
            )],
            vec![]
        )
    );
}

// The `in` side of the table: every spelling that names the document arrives at it, sorted.
#[test]
fn links_arriving_at_a_document_come_from_every_form_that_names_it() {
    let project = resolution_project();

    assert_eq!(
        links_of(&project.show("notes/sub/leaf")),
        links(
            vec![link(
                "notes/sub/leaf#here",
                "../top.md#one",
                Some("notes/top#one")
            )],
            vec![
                link(
                    "notes/other/far#one",
                    "[[twin]]",
                    Some("notes/sub/leaf#twin")
                ),
                link("notes/top#one", "./sub/leaf.md", Some("notes/sub/leaf")),
                link("notes/top#one", "sub/leaf.md", Some("notes/sub/leaf")),
                link("notes/top#one", "sub/leaf.md#deep", Some("notes/sub/leaf")),
                link(
                    "notes/top#one",
                    "sub/leaf.md#here",
                    Some("notes/sub/leaf#here")
                ),
                link("notes/wiki#own", "[[here]]", Some("notes/sub/leaf#here")),
                link("notes/wiki#own", "[[leaf]]", Some("notes/sub/leaf")),
            ]
        )
    );
}

// A section's `in` holds only the links that name that section; a document's `in` also holds the
// links that name the document alone. A section's `out` holds only its own links.
#[test]
fn a_section_lists_only_its_own_links_and_the_links_that_name_it() {
    let project = Project::notes();
    project.write(
        "notes/alpha.md",
        &anchored_page(
            "Alpha",
            &[
                ("one", "[[beta]] [x](beta.md#two) [[nowhere]]"),
                ("two", "[self](#one)"),
            ],
        ),
    );
    project.write(
        "notes/beta.md",
        &anchored_page(
            "Beta",
            &[("one", "[a](alpha.md#one)"), ("two", "[a](alpha.md)")],
        ),
    );

    assert_eq!(
        links_of(&project.show("notes/alpha")),
        links(
            vec![
                link("notes/alpha#one", "[[beta]]", Some("notes/beta")),
                link("notes/alpha#one", "[[nowhere]]", None),
                link("notes/alpha#one", "beta.md#two", Some("notes/beta#two")),
                link("notes/alpha#two", "#one", Some("notes/alpha#one")),
            ],
            vec![
                link("notes/alpha#two", "#one", Some("notes/alpha#one")),
                link("notes/beta#one", "alpha.md#one", Some("notes/alpha#one")),
                link("notes/beta#two", "alpha.md", Some("notes/alpha")),
            ]
        )
    );
    assert_eq!(
        links_of(&project.show("notes/alpha#one")),
        links(
            vec![
                link("notes/alpha#one", "[[beta]]", Some("notes/beta")),
                link("notes/alpha#one", "[[nowhere]]", None),
                link("notes/alpha#one", "beta.md#two", Some("notes/beta#two")),
            ],
            vec![
                link("notes/alpha#two", "#one", Some("notes/alpha#one")),
                link("notes/beta#one", "alpha.md#one", Some("notes/alpha#one")),
            ]
        )
    );
}

// A document the exclude glob covers is not a target; once the glob goes the same link resolves.
#[test]
fn a_link_to_an_excluded_document_is_unresolved_until_the_exclude_glob_goes() {
    let project =
        Project::new(&json!({ "include": ["notes/**/*.md"], "exclude": ["**/index.md"] }));
    project.write(
        "notes/alpha.md",
        &anchored_page("Alpha", &[("one", "[i](index.md#one) [[log]]")]),
    );
    project.write(
        "notes/index.md",
        &anchored_page("Index", &[("one", "index text.")]),
    );
    project.write(
        "notes/log.md",
        &anchored_page("Log", &[("one", "log text.")]),
    );

    assert_eq!(
        links_of(&project.show("notes/alpha")),
        links(
            vec![
                link("notes/alpha#one", "[[log]]", Some("notes/log")),
                link("notes/alpha#one", "index.md#one", None),
            ],
            vec![]
        )
    );

    project.set_memory(&json!({ "include": ["notes/**/*.md"] }));

    assert_eq!(
        links_of(&project.show("notes/alpha")),
        links(
            vec![
                link("notes/alpha#one", "[[log]]", Some("notes/log")),
                link("notes/alpha#one", "index.md#one", Some("notes/index#one")),
            ],
            vec![]
        )
    );
}
