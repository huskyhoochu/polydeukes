//! Which files are documents: the `include` and `exclude` globs, the `.md` suffix, and the id.
//!
//! The ids are read from `usage`, which lists every document no log entry returned in id order.

use serde_json::json;

use crate::common::{Project, page};

fn write_pages(project: &Project, files: &[&str]) {
    for file in files {
        project.write(file, &page("Page", &[("One", "text.")]));
    }
}

// A walk of the whole directory picks up `outside/`; keeping every glob hit reads the `folder.md`
// directory or a `.txt`; skipping a file by its name drops `index.md` and `log.md` at any depth
// though no exclude glob names them; cutting the id at the first dot turns `v1.2` into `v1`;
// refusing a parse failure drops `broken`; a document reached by both globs is listed once; an id
// sort that is not by byte puts `Zeta` after `alpha`.
#[test]
fn the_documents_are_the_markdown_files_any_include_glob_reaches() {
    let project = Project::new(&json!({
        "include": ["notes/**/*.md", "notes/guides/*.md"]
    }));
    write_pages(
        &project,
        &[
            "notes/alpha.md",
            "notes/Zeta.md",
            "notes/guides/beta.md",
            "notes/guides/deep/gamma.md",
            "notes/index-notes.md",
            "notes/changelog.md",
            "notes/v1.2.md",
            "notes/index.md",
            "notes/log.md",
            "notes/folder.md/inner.md",
            "notes/guides/index.md",
            "notes/guides/deep/log.md",
            "notes/readme.txt",
            "notes/guides/draft.md.bak",
            "outside/omega.md",
        ],
    );
    project.write(
        "notes/broken.md",
        "---\n: [\n---\n## One\nunparseable frontmatter.",
    );

    assert_eq!(
        project.document_ids(),
        [
            "notes/Zeta",
            "notes/alpha",
            "notes/broken",
            "notes/changelog",
            "notes/folder.md/inner",
            "notes/guides/beta",
            "notes/guides/deep/gamma",
            "notes/guides/deep/log",
            "notes/guides/index",
            "notes/index",
            "notes/index-notes",
            "notes/log",
            "notes/v1.2"
        ]
    );
}

const ROOT_INCLUDE: [&str; 3] = ["*.md", "notes/**/*.md", "notes/releases/*.md"];
const ROOT_FILES: [&str; 8] = [
    "index.md",
    "log.md",
    "notes/alpha.md",
    "notes/index.md",
    "notes/index-notes.md",
    "notes/guides/index.md",
    "notes/releases/v1.md",
    "notes/releases/deep/v2.md",
];
const EVERY_ROOT_DOCUMENT: [&str; 8] = [
    "index",
    "log",
    "notes/alpha",
    "notes/guides/index",
    "notes/index",
    "notes/index-notes",
    "notes/releases/deep/v2",
    "notes/releases/v1",
];

// An exclude that is ignored keeps `index.md` and the release records; one applied to the name
// alone or to the last segment misses `notes/releases/deep/v2` or drops `index-notes`; one that
// lets an include hit outrank an exclude hit keeps `notes/releases/v1`; one that anchors
// `**/index.md` below the first directory keeps the root `index`.
#[test]
fn an_exclude_glob_removes_what_it_matches_even_when_an_include_glob_names_it_too() {
    let project = Project::new(&json!({
        "include": ROOT_INCLUDE,
        "exclude": ["**/index.md", "notes/releases/**"]
    }));
    write_pages(&project, &ROOT_FILES);

    assert_eq!(
        project.document_ids(),
        ["log", "notes/alpha", "notes/index-notes"]
    );
}

// An empty `exclude` read as "exclude everything" leaves no document; read as absent it leaves all.
#[test]
fn an_empty_exclude_list_excludes_nothing() {
    let empty = Project::new(&json!({ "include": ROOT_INCLUDE, "exclude": [] }));
    write_pages(&empty, &ROOT_FILES);
    let absent = Project::new(&json!({ "include": ROOT_INCLUDE }));
    write_pages(&absent, &ROOT_FILES);

    assert_eq!(empty.document_ids(), EVERY_ROOT_DOCUMENT);
    assert_eq!(absent.document_ids(), EVERY_ROOT_DOCUMENT);
}

// An exclude glob that matches a directory leaves out everything under it, though the files below
// do not match the glob themselves.
#[test]
fn an_exclude_glob_that_matches_a_directory_removes_everything_under_it() {
    let project =
        Project::new(&json!({ "include": ROOT_INCLUDE, "exclude": ["notes/releases/*"] }));
    write_pages(&project, &ROOT_FILES);

    assert_eq!(
        project.document_ids(),
        [
            "index",
            "log",
            "notes/alpha",
            "notes/guides/index",
            "notes/index",
            "notes/index-notes"
        ]
    );
}

// `*` does not cross a directory separator: `*.md` reaches the root's files only.
#[test]
fn a_star_glob_does_not_cross_a_directory_separator() {
    let project = Project::new(&json!({ "include": ["*.md"] }));
    write_pages(&project, &["a.md", "notes/b.md", "notes/deep/c.md"]);

    assert_eq!(project.document_ids(), ["a"]);
}

// Node's glob reaches no entry whose name starts with a dot through a wildcard component.
#[test]
fn dot_files_and_dot_directories_are_not_reached_through_a_wildcard() {
    let project = Project::new(&json!({ "include": ["docs/**/*.md"] }));
    write_pages(&project, &["docs/a.md", "docs/.h.md", "docs/.trash/t.md"]);

    assert_eq!(project.document_ids(), ["docs/a"]);
}

// A leading `./` on a pattern names the same files as the pattern without it.
#[test]
fn a_leading_dot_slash_on_an_include_names_the_same_documents() {
    let project = Project::new(&json!({ "include": ["./notes/**/*.md"] }));
    write_pages(&project, &["notes/a.md"]);

    assert_eq!(project.document_ids(), ["notes/a"]);
}

// Node's glob matches without regard to case on macOS.
#[cfg(target_os = "macos")]
#[test]
fn globs_match_without_regard_to_case_on_macos() {
    let project = Project::new(&json!({ "include": ["**/*.md"], "exclude": ["notes/**"] }));
    write_pages(&project, &["Notes/n.md"]);

    assert_eq!(project.document_ids(), Vec::<String>::new());
}
