//! `memory_ingest` and `memory_search` against the BUILT `pdks`: a throwaway tree
//! scaffolded by `pdks init`, wired to the checkout's install graph by symlink, with one
//! markdown document its memory settings include. Only a real spawn proves that the crate
//! finds the umbrella from the memory root, that the child reads that root's config and
//! writes its index there, and that the generated hit type parses what the real command
//! prints. `memory_ingest.rs` and `memory_search.rs` pin the same contract through the
//! injected seam.

use std::fs;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::process::Command;

use polydeukes_sdk::{
    MemoryIngestOutcome, MemoryIngestSpec, MemorySearchOutcome, MemorySearchResult,
    MemorySearchSpec, memory_ingest, memory_search,
};
use tempfile::TempDir;

/// Injected fixture values — the consumer's include glob, one document, the section id its
/// second heading gets, and a word only that section holds.
const INCLUDE_GLOB: &str = "notes/**/*.md";
const DOC_REL: &str = "notes/alpha.md";
const HIT_WORD: &str = "shared-term";
const HIT_SECTION_ID: &str = "notes/alpha#two";
const NO_HIT_WORD: &str = "zz-no-such-term-491";
/// What the CLI prints on stderr when searched before any ingest.
const NO_INDEX_HINT: &str = "pdks memory ingest";

fn checkout_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .canonicalize()
        .expect("the crate sits two levels under the checkout")
}

fn umbrella_bin() -> PathBuf {
    let bin = checkout_root().join("packages/polydeukes/dist/bin.js");
    assert!(
        bin.exists(),
        "{} is missing: run `pnpm build` first",
        bin.display()
    );
    bin
}

fn project_root() -> (TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix("pdks-sdk-rust-memory-e2e-")
        .tempdir()
        .expect("tempdir");
    let root = dir.path().canonicalize().expect("canonical tempdir");
    (dir, root)
}

/// The whole real install graph by one symlink, `pdks init` for the scaffold, then the
/// consumer's own config over the scaffolded one: a memory section with one include glob,
/// and the document that glob reaches. The document's first section holds only ordinary
/// words; the second holds `HIT_WORD` alone, so a hit names exactly one section.
fn scaffold_consumer(root: &Path) {
    std::os::unix::fs::symlink(
        checkout_root().join("node_modules"),
        root.join("node_modules"),
    )
    .expect("node_modules symlink");
    fs::write(
        root.join("package.json"),
        "{\"name\":\"consumer\",\"private\":true}\n",
    )
    .expect("consumer manifest");
    let init = Command::new("node")
        .arg(umbrella_bin())
        .arg("init")
        .current_dir(root)
        .output()
        .expect("node on PATH");
    assert!(
        init.status.success(),
        "pdks init failed: {}",
        String::from_utf8_lossy(&init.stderr)
    );
    fs::write(
        root.join("polydeukes.config.yaml"),
        format!("memory:\n  include:\n    - '{INCLUDE_GLOB}'\n"),
    )
    .expect("consumer config");
    let doc = root.join(DOC_REL);
    fs::create_dir_all(doc.parent().unwrap()).expect("notes dir");
    fs::write(
        &doc,
        format!("---\ntitle: Alpha\ntype: note\n---\n## One\n\nalpha only.\n\n## Two\n\n{HIT_WORD} here.\n"),
    )
    .expect("document");
}

fn ingested(root: &Path) {
    match memory_ingest(MemoryIngestSpec { root, spawn: None }) {
        MemoryIngestOutcome::Ingested => {}
        MemoryIngestOutcome::Unavailable { reason } => {
            panic!("expected ingested, got unavailable: {reason}")
        }
    }
}

fn found(outcome: MemorySearchOutcome) -> Vec<MemorySearchResult> {
    match outcome {
        MemorySearchOutcome::Found { hits } => hits,
        MemorySearchOutcome::Empty => panic!("expected found, got empty"),
        MemorySearchOutcome::Unavailable { reason } => {
            panic!("expected found, got unavailable: {reason}")
        }
    }
}

fn search(root: &Path, query: &str, limit: Option<NonZeroU32>) -> MemorySearchOutcome {
    memory_search(MemorySearchSpec {
        root,
        query,
        limit,
        spawn: None,
    })
}

#[test]
fn search_before_ingest_is_unavailable_carrying_the_clis_own_hint() {
    // The CLI refuses with exit 2 and names the ingest to run; a verb that opened the index
    // itself, or read the refusal as `Empty`, would report "nothing to recall" for a tree
    // that was never indexed.
    let (_dir, root) = project_root();
    scaffold_consumer(&root);

    let reason = match search(&root, HIT_WORD, None) {
        MemorySearchOutcome::Unavailable { reason } => reason,
        MemorySearchOutcome::Empty => panic!("expected unavailable, got empty"),
        MemorySearchOutcome::Found { hits } => {
            panic!("expected unavailable, got found with {} hits", hits.len())
        }
    };
    assert!(
        reason.contains(NO_INDEX_HINT),
        "reason carries the CLI's hint: {reason}"
    );
}

#[test]
fn ingest_then_search_finds_the_section_holding_the_word_and_misses_an_absent_one() {
    // Three things only a real child proves at once: the ingest ran in `root` (the index
    // `search` reads is the one it wrote, under the consumer's own config rather than this
    // checkout's), the generated type parses the real `--json` bytes, and the hit's `id` is
    // the section the document has — not the document id, not the first section.
    let (_dir, root) = project_root();
    scaffold_consumer(&root);

    ingested(&root);

    let hits = found(search(&root, HIT_WORD, None));
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, HIT_SECTION_ID);

    assert!(
        matches!(search(&root, NO_HIT_WORD, None), MemorySearchOutcome::Empty),
        "expected empty for an absent word"
    );
}

#[test]
fn a_limit_reaches_the_cli_and_caps_the_hits() {
    // The document's two sections both hold `alpha`; a limit of one that never reached the
    // argv, or that the CLI refused as usage (`Unavailable`), answers two or none.
    let (_dir, root) = project_root();
    scaffold_consumer(&root);
    ingested(&root);
    assert_eq!(found(search(&root, "alpha", None)).len(), 2);

    let limited = found(search(&root, "alpha", NonZeroU32::new(1)));

    assert_eq!(limited.len(), 1);
}
