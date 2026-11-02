//! Wikilink spellings: aliases and fragments, name matching, attachments, and footnotes.
//!
//! The text between the brackets is shown as written; resolution strips the decorations.

use crate::common::{Project, link, links, links_of, page};

// A resolver that compares the whole bracket text leaves every decorated link unresolved; one that
// cuts at `|` but not at `\|` loses the table-row alias; one that matches a fragment against only
// the anchor or only the slug loses one of the two spellings; one that takes the first `#`
// fragment loses `B#a#Section Title`; one that fills a section for `^blk` or for an H3 invents one;
// one that treats an empty name as no document loses `#Src Own`; one that slugs every fragment
// loses the explicit anchor `MEMORY-05`.
#[test]
fn alias_and_fragment_are_stripped_for_resolution_and_shown_as_written() {
    let project = Project::notes();
    project.write(
        "notes/A.md",
        &page(
            "A",
            &[
                (
                    "Src",
                    "[[B|alias]] [[B#Section Title]] [[B#section-title]] [[B#a#Section Title]] [[B#^blk]] [[B#H3 Title]] [[#Src Own]] [[B#MEMORY-05]] [[own|a]]\n\n| cell |\n|---|\n| [[B\\|alias]] |",
                ),
                ("Src Own", "own text."),
                ("own", "more own text."),
            ],
        ),
    );
    project.write(
        "notes/B.md",
        &page(
            "B",
            &[
                ("Section Title", "section text.\n### H3 Title\nh3 text."),
                ("blk", "block text."),
                ("T {#MEMORY-05}", "explicit anchor."),
            ],
        ),
    );

    let from = "notes/A#src";
    assert_eq!(
        links_of(&project.show("notes/A")),
        links(
            vec![
                link(from, "[[#Src Own]]", Some("notes/A#src-own")),
                link(from, "[[B#H3 Title]]", Some("notes/B")),
                link(from, "[[B#MEMORY-05]]", Some("notes/B#MEMORY-05")),
                link(from, "[[B#Section Title]]", Some("notes/B#section-title")),
                link(from, "[[B#^blk]]", Some("notes/B")),
                link(from, "[[B#a#Section Title]]", Some("notes/B#section-title")),
                link(from, "[[B#section-title]]", Some("notes/B#section-title")),
                link(from, "[[B\\|alias]]", Some("notes/B")),
                link(from, "[[B|alias]]", Some("notes/B")),
                link(from, "[[own|a]]", Some("notes/A#own")),
            ],
            vec![
                link(from, "[[#Src Own]]", Some("notes/A#src-own")),
                link(from, "[[own|a]]", Some("notes/A#own")),
            ]
        )
    );
}

// A resolver that compares names case-sensitively loses `b`; one that matches only the last path
// segment loses `dir/D` and `notes/B`; one that tests a bare string suffix resolves `ir/D`; one
// that trims only one side loses `B ` or ` B`.
#[test]
fn a_name_matches_ignoring_case_by_trailing_path_and_after_trimming() {
    let project = Project::notes();
    project.write(
        "notes/A.md",
        &page(
            "A",
            &[("Src", "[[b]] [[dir/D]] [[B ]] [[notes/B]] [[ir/D]] [[ B]]")],
        ),
    );
    project.write("notes/B.md", &page("B", &[("One", "b text.")]));
    project.write("notes/dir/D.md", &page("D", &[("One", "d text.")]));

    let from = "notes/A#src";
    assert_eq!(
        links_of(&project.show("notes/A")),
        links(
            vec![
                link(from, "[[ B]]", Some("notes/B")),
                link(from, "[[B ]]", Some("notes/B")),
                link(from, "[[b]]", Some("notes/B")),
                link(from, "[[dir/D]]", Some("notes/dir/D")),
                link(from, "[[ir/D]]", None),
                link(from, "[[notes/B]]", Some("notes/B")),
            ],
            vec![]
        )
    );
}

// Two documents with the name resolve to the one in the source's directory; from a directory with
// neither, the name is ambiguous and unresolved.
#[test]
fn a_duplicate_name_prefers_the_source_directory_and_is_otherwise_unresolved() {
    let project = Project::notes();
    project.write("notes/x/B.md", &page("B x", &[("One", "x text.")]));
    project.write("notes/y/B.md", &page("B y", &[("One", "y text.")]));
    project.write("notes/x/Src.md", &page("Src x", &[("Src", "[[B]]")]));
    project.write("notes/z/Src.md", &page("Src z", &[("Src", "[[B]]")]));

    assert_eq!(
        links_of(&project.show("notes/x/Src")),
        links(
            vec![link("notes/x/Src#src", "[[B]]", Some("notes/x/B"))],
            vec![]
        )
    );
    assert_eq!(
        links_of(&project.show("notes/z/Src")),
        links(vec![link("notes/z/Src#src", "[[B]]", None)], vec![])
    );
}

// A scanner that stores every `[[…]]` adds an unresolved link per attachment; one that compares
// the extension case-sensitively keeps `a.PNG|100`; one that reads the extension before cutting the
// alias or fragment keeps `icon.svg#icon`; one that reads it off the whole name keeps `img/a.png`;
// one that treats any dotted name as an attachment drops the two document links; one that drops
// every `![[…]]` loses the embedded document.
#[test]
fn an_attachment_is_not_a_link_but_a_dotted_document_name_and_an_embedded_document_are() {
    let project = Project::notes();
    project.write(
        "notes/A.md",
        &page(
            "A",
            &[(
                "Src",
                "![[a.png]] [[a.PNG|100]] [[a.png\\|100]] [[img/a.png]] [[icon.svg#icon]] ![[doc.pdf#page=3]] [[memory.adr.graph]] [[1011-process.exit]] ![[B]]",
            )],
        ),
    );
    project.write("notes/B.md", &page("B", &[("One", "b text.")]));
    project.write(
        "notes/memory.adr.graph.md",
        &page("Graph", &[("One", "graph text.")]),
    );
    project.write(
        "notes/1011-process.exit.md",
        &page("Exit", &[("One", "exit text.")]),
    );

    let from = "notes/A#src";
    assert_eq!(
        links_of(&project.show("notes/A")),
        links(
            vec![
                link(
                    from,
                    "[[1011-process.exit]]",
                    Some("notes/1011-process.exit")
                ),
                link(from, "[[B]]", Some("notes/B")),
                link(from, "[[memory.adr.graph]]", Some("notes/memory.adr.graph")),
            ],
            vec![]
        )
    );
}

// `[[1]](url)` is a footnote whose text is `[1]`; a space before the parenthesis, or a parenthesis
// that holds prose instead of a URL, leaves the wikilink.
#[test]
fn a_footnote_spelling_is_not_a_wikilink_but_a_spaced_or_prose_parenthesis_is() {
    let project = Project::notes();
    project.write(
        "notes/A.md",
        &page(
            "A",
            &[
                ("One", "[[1]](https://x) [[전문]](https://x)"),
                ("Two", "[[1]] (https://x)"),
                ("Three", "[[B]](→ `b` 슬러그로 바뀜) [[2단계 인증]](2FA)"),
            ],
        ),
    );
    project.write("notes/B.md", &page("B", &[("One", "text")]));

    assert_eq!(
        links_of(&project.show("notes/A")),
        links(
            vec![
                link("notes/A#three", "[[2단계 인증]]", None),
                link("notes/A#three", "[[B]]", Some("notes/B")),
                link("notes/A#two", "[[1]]", None),
            ],
            vec![]
        )
    );
}
