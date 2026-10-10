//! A spec that names its `executable` runs that file and nothing else: the file is the
//! command, the verb is its first argument, and neither the install graph above the root nor
//! `PATH` is consulted. A relative path resolves against the calling process's cwd. The file
//! is not inspected ahead of the spawn, so one that cannot run comes back through the spawn
//! failure branch each verb already has.

use std::cell::RefCell;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use polydeukes_sdk::{
    CheckChangeSetSpec, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, MemoryIngestSpec,
    MemorySearchOutcome, MemorySearchSpec, SpawnOutcome, SpawnSpec, check_change_set,
    check_covenant, memory_ingest, memory_search,
};
use serde_json::json;
use tempfile::TempDir;

/// The umbrella's own manifest spells the bin with a leading `./`, so the stub does too.
const STUB_BIN_REL: &str = "./dist/bin.js";
/// Injected fixture value — the query the fake CLI is asked.
const QUERY: &str = "hook block";
const EMPTY_OUTPUT: &str = "{\"ingestedAt\":\"2026-10-10T14:00:00.000Z\",\"results\":[]}";
const DIFF: &str = "diff --git a/src/answer.ts b/src/answer.ts\n--- a/src/answer.ts\n+++ b/src/answer.ts\n@@ -1 +1 @@\n-export const answer = 41;\n+export const answer = 42;\n";
/// An executable path with no file behind it; the seam never runs it.
const EXECUTABLE_NAME: &str = "pdks-single";
/// A manifest that does not parse, so the nearest install has no readable bin.
const BROKEN_MANIFEST: &str = "{\"name\":\"polydeukes\",\"bin\":{";
/// A relative executable, meaningful only from the calling process's cwd.
const RELATIVE_EXECUTABLE: &str = "tools/pdks";

/// A fixture tree whose path is canonical, so a path computed from it agrees with one
/// computed through the filesystem (macOS hands out `/var/...` for `/private/var/...`).
fn fixture_dir(prefix: &str) -> (TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix(prefix)
        .tempdir()
        .expect("tempdir");
    let path = dir.path().canonicalize().expect("canonical tempdir");
    (dir, path)
}

/// A root with a consumer manifest and nothing installed under it.
fn bare_root() -> (TempDir, PathBuf) {
    let (dir, root) = fixture_dir("pdks-sdk-rust-executable-root-");
    fs::write(
        root.join("package.json"),
        "{\"name\":\"consumer\",\"private\":true}\n",
    )
    .expect("consumer manifest");
    (dir, root)
}

/// A `polydeukes` install under `dir` carrying `manifest`.
fn install_polydeukes(dir: &Path, manifest: &str) {
    let pkg_dir = dir.join("node_modules").join("polydeukes");
    fs::create_dir_all(pkg_dir.join("dist")).expect("stub dist dir");
    fs::write(pkg_dir.join("package.json"), manifest).expect("stub manifest");
    fs::write(pkg_dir.join("dist").join("bin.js"), "").expect("stub bin");
}

fn pdks_manifest() -> String {
    json!({ "name": "polydeukes", "bin": { "pdks": STUB_BIN_REL } }).to_string()
}

fn empty_input() -> CovenantInput {
    CovenantInput {
        tool_calls: vec![],
        subagent_spawns: vec![],
        user_messages: vec![],
        actor: None,
        session: None,
        tools: None,
    }
}

/// A seam that records every spec it is handed and answers status 0 with an empty search.
struct RecordingSeam {
    calls: RefCell<Vec<SpawnSpec>>,
}

impl RecordingSeam {
    fn new() -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
        }
    }

    fn spawn(&self, spec: SpawnSpec) -> io::Result<SpawnOutcome> {
        self.calls.borrow_mut().push(spec);
        Ok(SpawnOutcome {
            status: Some(0),
            stdout: EMPTY_OUTPUT.into(),
            stderr: String::new(),
        })
    }
}

/// Every verb once, from `root` with `executable`, through one recording seam; returns what
/// the seam was handed in verb order: check_covenant, check_change_set, memory_ingest,
/// memory_search.
fn spawns_of_every_verb(root: &Path, executable: &Path) -> Vec<SpawnSpec> {
    let seam = RecordingSeam::new();
    let spawn = |s| seam.spawn(s);
    let input = empty_input();
    check_covenant(CheckCovenantSpec {
        repo_root: root,
        input: &input,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: Some(executable),
        spawn: Some(&spawn),
    });
    check_change_set(CheckChangeSetSpec {
        repo_root: root,
        diff: DIFF,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: Some(executable),
        spawn: Some(&spawn),
    });
    memory_ingest(MemoryIngestSpec {
        root,
        executable: Some(executable),
        spawn: Some(&spawn),
    });
    memory_search(MemorySearchSpec {
        root,
        query: QUERY,
        limit: None,
        executable: Some(executable),
        spawn: Some(&spawn),
    });
    seam.calls.into_inner()
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn unjudged(verdict: CheckCovenantVerdict) -> String {
    match verdict {
        CheckCovenantVerdict::Unjudged { reason } => reason,
        CheckCovenantVerdict::Upheld { advisories } => {
            panic!("expected unjudged, got upheld: {advisories}")
        }
        CheckCovenantVerdict::Blocked { reason } => {
            panic!("expected unjudged, got blocked: {reason}")
        }
    }
}

fn unavailable(outcome: MemorySearchOutcome) -> String {
    match outcome {
        MemorySearchOutcome::Unavailable { reason } => reason,
        MemorySearchOutcome::Found { hits } => {
            panic!("expected unavailable, got found with {} hits", hits.len())
        }
        MemorySearchOutcome::Empty => panic!("expected unavailable, got empty"),
    }
}

#[test]
fn an_absolute_executable_is_the_command_and_the_verb_its_first_argument_over_an_install() {
    // The install above the root is what the lookup would otherwise choose, so a resolution
    // that still prefers the install spawns `node <bin>` here; one that keeps the bin path
    // in front of the verb hands the executable an argument it reads as a file to judge.
    let (_root_dir, root) = bare_root();
    install_polydeukes(&root, &pdks_manifest());
    let (_bin_dir, bin_dir) = fixture_dir("pdks-sdk-rust-executable-bin-");
    let executable = bin_dir.join(EXECUTABLE_NAME);

    let calls = spawns_of_every_verb(&root, &executable);

    assert_eq!(calls.len(), 4);
    for call in &calls {
        assert_eq!(call.command, executable.to_string_lossy());
        assert_eq!(call.cwd, root);
    }
    assert_eq!(
        calls[0].args,
        strings(&["covenant", "check", "--enforce", "block"])
    );
    assert_eq!(
        calls[1].args,
        strings(&["covenant", "check", "--diff", "--enforce", "block"])
    );
    assert_eq!(calls[2].args, strings(&["memory", "ingest"]));
    assert_eq!(
        calls[3].args,
        strings(&["memory", "search", QUERY, "--json"])
    );
}

#[test]
fn a_broken_nearest_install_does_not_stop_a_named_executable() {
    // With no `executable`, a manifest that does not parse stops the walk and nothing is
    // spawned. A resolution that reads the install before honouring the field carries that
    // stop over and leaves the caller unjudged with a runnable file in hand.
    let (_root_dir, root) = bare_root();
    install_polydeukes(&root, BROKEN_MANIFEST);
    let (_bin_dir, bin_dir) = fixture_dir("pdks-sdk-rust-executable-bin-");
    let executable = bin_dir.join(EXECUTABLE_NAME);

    let calls = spawns_of_every_verb(&root, &executable);

    assert_eq!(calls.len(), 4);
    for call in &calls {
        assert_eq!(call.command, executable.to_string_lossy());
    }
}

#[test]
fn a_relative_executable_resolves_against_the_calling_process_cwd_not_the_root() {
    // The root is a tempdir, never the process cwd, so a resolution that joins the relative
    // path onto the root (or passes it through for the child to resolve from its cwd, which
    // is the root) names a file the caller never meant.
    let (_root_dir, root) = bare_root();
    install_polydeukes(&root, &pdks_manifest());
    let cwd = std::env::current_dir().expect("cwd");
    assert_ne!(cwd, root);

    let calls = spawns_of_every_verb(&root, Path::new(RELATIVE_EXECUTABLE));

    assert_eq!(calls.len(), 4);
    let expected = cwd.join(RELATIVE_EXECUTABLE);
    for call in &calls {
        assert_eq!(Path::new(&call.command), expected);
        assert!(Path::new(&call.command).is_absolute());
    }
}

#[test]
fn an_executable_that_cannot_be_spawned_is_unjudged_or_unavailable_through_the_spawn_branch() {
    // A crate that falls back to the install when the named file cannot run answers from
    // the install instead. The install is broken so that fallback reports "no readable bin"
    // whether or not `node` is on this machine's `PATH`.
    let (_root_dir, root) = bare_root();
    install_polydeukes(&root, BROKEN_MANIFEST);
    let missing = root.join(EXECUTABLE_NAME);
    let input = empty_input();

    let reason = unjudged(check_covenant(CheckCovenantSpec {
        repo_root: &root,
        input: &input,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: Some(&missing),
        spawn: None,
    }));
    assert!(
        reason.starts_with("the judge could not be spawned: "),
        "covenant reason: {reason}"
    );

    let reason = unavailable(memory_search(MemorySearchSpec {
        root: &root,
        query: QUERY,
        limit: None,
        executable: Some(&missing),
        spawn: None,
    }));
    assert!(
        reason.starts_with("pdks memory could not be spawned: "),
        "memory reason: {reason}"
    );
}

#[cfg(unix)]
#[test]
fn a_symlinked_executable_is_the_command_as_named_not_its_target() {
    // The target exists, so a crate that canonicalizes the path whenever it can would hand
    // the seam the target; the missing files the other cases name would not show that.
    let (_root_dir, root) = bare_root();
    let (_bin_dir, bin_dir) = fixture_dir("pdks-sdk-rust-executable-bin-");
    let target = bin_dir.join("pdks-linux-x64");
    fs::write(&target, "").expect("link target");
    let link = bin_dir.join(EXECUTABLE_NAME);
    std::os::unix::fs::symlink(&target, &link).expect("symlink");

    let calls = spawns_of_every_verb(&root, &link);

    assert_eq!(calls.len(), 4);
    for call in &calls {
        assert_eq!(call.command, link.to_string_lossy());
    }
}

#[test]
fn an_empty_executable_spawns_nothing_rather_than_falling_back_to_the_install() {
    // An empty path is the one input that cannot be made absolute. Reading it as "not named"
    // would hand the call to the valid install above the root, so the caller's mistake would
    // come back as a verdict from a judge it did not choose.
    let (_root_dir, root) = bare_root();
    install_polydeukes(&root, &pdks_manifest());
    let seam = RecordingSeam::new();
    let spawn = |s| seam.spawn(s);
    let input = empty_input();
    let empty = Path::new("");

    let reason = unjudged(check_covenant(CheckCovenantSpec {
        repo_root: &root,
        input: &input,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: Some(empty),
        spawn: Some(&spawn),
    }));
    assert!(
        reason.starts_with("the judge could not be spawned: "),
        "covenant reason: {reason}"
    );
    let reason = unavailable(memory_search(MemorySearchSpec {
        root: &root,
        query: QUERY,
        limit: None,
        executable: Some(empty),
        spawn: Some(&spawn),
    }));
    assert!(
        reason.starts_with("pdks memory could not be spawned: "),
        "memory reason: {reason}"
    );
    assert!(seam.calls.borrow().is_empty());
}
