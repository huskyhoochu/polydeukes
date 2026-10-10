//! When no `node_modules/polydeukes` sits at or above the root, the verbs run the first
//! `pdks` regular file on `PATH` directly — the single executable a host without Node
//! installs — with the verb as the first argument and no bin path. An install in the graph
//! still wins, a broken nearest install stops the walk before `PATH`, and with nothing to
//! run the verbs spawn nothing. `PATH` is process-wide, so every case that sets it takes one
//! lock and the original is restored when the case ends.

use std::cell::RefCell;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use polydeukes_sdk::{
    CheckChangeSetSpec, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput,
    MemorySearchOutcome, MemorySearchSpec, SpawnOutcome, SpawnSpec, check_change_set,
    check_covenant, memory_search,
};
use serde_json::json;
use tempfile::TempDir;

/// The umbrella's own manifest spells the bin with a leading `./`, so the stub does too.
const STUB_BIN_REL: &str = "./dist/bin.js";
const EXECUTABLE_NAME: &str = "pdks";
/// Injected fixture value — the query the fake CLI is asked.
const QUERY: &str = "hook block";
const SEARCH_TAIL: [&str; 4] = ["memory", "search", QUERY, "--json"];
const EMPTY_OUTPUT: &str = "{\"ingestedAt\":\"2026-10-10T14:00:00.000Z\",\"results\":[]}";
const DIFF: &str = "diff --git a/src/answer.ts b/src/answer.ts\n--- a/src/answer.ts\n+++ b/src/answer.ts\n@@ -1 +1 @@\n-export const answer = 41;\n+export const answer = 42;\n";
/// A `PATH` entry that is not absolute; only the process cwd could resolve it.
const RELATIVE_ENTRY: &str = "rel-dir";

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
    let (dir, root) = fixture_dir("pdks-sdk-rust-path-root-");
    fs::write(
        root.join("package.json"),
        "{\"name\":\"consumer\",\"private\":true}\n",
    )
    .expect("consumer manifest");
    (dir, root)
}

/// A `polydeukes` install under `dir` carrying `manifest`; returns the bin file it points at.
fn install_polydeukes(dir: &Path, manifest: &str) -> PathBuf {
    let pkg_dir = dir.join("node_modules").join("polydeukes");
    fs::create_dir_all(pkg_dir.join("dist")).expect("stub dist dir");
    fs::write(pkg_dir.join("package.json"), manifest).expect("stub manifest");
    let bin = pkg_dir.join("dist").join("bin.js");
    fs::write(&bin, "").expect("stub bin");
    bin
}

fn pdks_manifest() -> String {
    json!({ "name": "polydeukes", "bin": { "pdks": STUB_BIN_REL } }).to_string()
}

/// A regular file at `path` with the exec bit when `executable`.
fn write_executable(path: &Path, executable: bool) {
    fs::write(path, "#!/bin/sh\n").expect("fake executable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if executable { 0o755 } else { 0o644 };
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("chmod");
    }
    let _ = executable;
}

/// A directory holding one `pdks` regular file; returns the directory and that file.
fn dir_with_pdks(executable: bool) -> (TempDir, PathBuf, PathBuf) {
    let (dir, path) = fixture_dir("pdks-sdk-rust-path-bin-");
    let pdks = path.join(EXECUTABLE_NAME);
    write_executable(&pdks, executable);
    (dir, path, pdks)
}

/// A seam that records every spec it is handed and answers an empty search at status 0.
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

    fn calls(&self) -> std::cell::Ref<'_, Vec<SpawnSpec>> {
        self.calls.borrow()
    }

    /// The one command the seam was handed.
    fn only_command(&self) -> String {
        let calls = self.calls();
        assert_eq!(calls.len(), 1, "one spawn");
        calls[0].command.clone()
    }
}

fn search(root: &Path, seam: &RecordingSeam) -> MemorySearchOutcome {
    memory_search(MemorySearchSpec {
        root,
        query: QUERY,
        limit: None,
        spawn: Some(&|s| seam.spawn(s)),
    })
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

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// The reason's fixed head when neither an install nor a `PATH` entry is found.
fn no_umbrella_head(root: &Path) -> String {
    format!(
        "no polydeukes in the install graph of {} and no pdks on PATH",
        root.display()
    )
}

/// `PATH` is one value for the whole process, so the tests that set it take this lock first
/// and the harness's threads never see each other's fixture directories.
static PATH_LOCK: Mutex<()> = Mutex::new(());

/// Restores the original `PATH` when dropped, so a failed assertion leaves none of the
/// fixture directories on it for the rest of the process.
struct PathRestore(Option<OsString>);

impl PathRestore {
    fn set(entries: &[&Path]) -> Self {
        let original = std::env::var_os("PATH");
        let joined = std::env::join_paths(entries).expect("fixture entries join into one PATH");
        unsafe { std::env::set_var("PATH", joined) };
        Self(original)
    }

    fn unset() -> Self {
        let original = std::env::var_os("PATH");
        unsafe { std::env::remove_var("PATH") };
        Self(original)
    }
}

impl Drop for PathRestore {
    fn drop(&mut self) {
        match &self.0 {
            Some(original) => unsafe { std::env::set_var("PATH", original) },
            None => unsafe { std::env::remove_var("PATH") },
        }
    }
}

fn path_lock() -> MutexGuard<'static, ()> {
    PATH_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Every verb spawns nothing from `root` and answers the shared reason head with its own tail.
fn assert_every_verb_resolves_nothing(root: &Path) {
    let seam = RecordingSeam::new();
    let reason = unavailable(search(root, &seam));
    assert!(
        reason.starts_with(&no_umbrella_head(root)),
        "memory reason starts with the shared head: {reason}"
    );
    assert!(
        reason.ends_with("install it to use memory"),
        "memory reason keeps its tail: {reason}"
    );
    assert_eq!(seam.calls().len(), 0);

    let input = CovenantInput {
        tool_calls: vec![],
        subagent_spawns: vec![],
        user_messages: vec![],
        actor: None,
        session: None,
        tools: None,
    };
    let seam = RecordingSeam::new();
    let reason = unjudged(check_covenant(CheckCovenantSpec {
        repo_root: root,
        input: &input,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        spawn: Some(&|s| seam.spawn(s)),
    }));
    assert!(
        reason.starts_with(&no_umbrella_head(root)),
        "covenant reason starts with the shared head: {reason}"
    );
    assert!(
        reason.ends_with("install it to have this input judged"),
        "covenant reason keeps its tail: {reason}"
    );
    assert_eq!(seam.calls().len(), 0);

    let seam = RecordingSeam::new();
    let reason = unjudged(check_change_set(CheckChangeSetSpec {
        repo_root: root,
        diff: DIFF,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        spawn: Some(&|s| seam.spawn(s)),
    }));
    assert!(
        reason.starts_with(&no_umbrella_head(root)),
        "change-set reason starts with the shared head: {reason}"
    );
    assert!(
        reason.ends_with("install it to have this change set judged"),
        "change-set reason keeps its tail: {reason}"
    );
    assert_eq!(seam.calls().len(), 0);
}

#[test]
fn the_first_pdks_regular_file_on_path_runs_when_no_install_is_above_root() {
    // The executable itself is the command and the verb is its first argument: a
    // resolution that keeps `node` as the command, or puts the executable's path where the
    // bin path used to go, hands a Node-less host a spawn it cannot run.
    let _lock = path_lock();
    let (_root_dir, root) = bare_root();
    let (_path_dir, path_dir, pdks) = dir_with_pdks(true);
    let _path = PathRestore::set(&[&path_dir]);
    let seam = RecordingSeam::new();

    let outcome = search(&root, &seam);

    assert!(matches!(outcome, MemorySearchOutcome::Empty));
    let calls = seam.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].command, pdks.to_string_lossy());
    assert_eq!(calls[0].args, strings(&SEARCH_TAIL));
    assert_eq!(calls[0].cwd, root);
    drop(calls);

    // An install in the graph wins over `PATH`: the project's lockfile pinned that
    // version. A lookup that consults `PATH` first runs a different umbrella than the one
    // the project installed.
    let (_installed_dir, installed_root) = bare_root();
    let bin = install_polydeukes(&installed_root, &pdks_manifest());
    let seam = RecordingSeam::new();

    search(&installed_root, &seam);

    let calls = seam.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].command, "node");
    assert_eq!(
        Path::new(&calls[0].args[0])
            .canonicalize()
            .expect("the bin path names a file"),
        bin
    );
    assert_eq!(&calls[0].args[1..], strings(&SEARCH_TAIL).as_slice());
}

#[test]
fn neither_an_install_nor_a_path_entry_spawns_nothing_and_names_both_in_the_reason() {
    // Spawning nothing is the fail-closed answer: an `Empty` or `Upheld` here reads a
    // host with no umbrella as one that answered. The reason tells the operator both
    // places it looked, each of the three verbs keeping its own tail, whether `PATH` holds
    // no executable or is not set at all — an unset `PATH` read as an error would turn the
    // reason into a spawn failure, and read as `.` would search the process cwd.
    let _lock = path_lock();
    let (_root_dir, root) = bare_root();
    let (_empty_dir, empty_dir) = fixture_dir("pdks-sdk-rust-path-empty-");

    {
        let _path = PathRestore::set(&[&empty_dir]);
        assert_every_verb_resolves_nothing(&root);
    }
    {
        let _path = PathRestore::unset();
        assert_every_verb_resolves_nothing(&root);
    }
}

#[cfg(unix)]
#[test]
fn a_pdks_without_the_exec_bit_or_a_pdks_directory_is_skipped_and_the_first_executable_wins() {
    // A file the kernel would refuse to exec, or a directory of that name, is not the
    // executable: a lookup that takes the first name match hands the host a spawn that
    // fails with EACCES, and one that stops at the first miss never reaches the real one.
    // Two executables after them: a lookup that takes the last match, or collects every
    // match and sorts, runs the one the operator put second.
    let _lock = path_lock();
    let (_root_dir, root) = bare_root();
    let (_plain_dir, plain_dir, _) = dir_with_pdks(false);
    let (_dir_dir, dir_dir) = fixture_dir("pdks-sdk-rust-path-dir-");
    fs::create_dir(dir_dir.join(EXECUTABLE_NAME)).expect("a directory named pdks");
    let (_first_dir, first_dir, first) = dir_with_pdks(true);
    let (_second_dir, second_dir, _) = dir_with_pdks(true);
    let _path = PathRestore::set(&[&plain_dir, &dir_dir, &first_dir, &second_dir]);
    let seam = RecordingSeam::new();

    search(&root, &seam);

    assert_eq!(seam.only_command(), first.to_string_lossy());

    // With no executable entry after them, the same two are not a fallback either.
    let _path = PathRestore::set(&[&plain_dir, &dir_dir]);
    let seam = RecordingSeam::new();

    let reason = unavailable(search(&root, &seam));

    assert!(
        reason.starts_with(&no_umbrella_head(&root)),
        "reason starts with the shared head: {reason}"
    );
    assert_eq!(seam.calls().len(), 0);
}

#[cfg(unix)]
#[test]
fn a_pdks_symlink_to_an_executable_is_used_and_a_dangling_one_is_skipped() {
    // A `pdks` that is a symlink is what a package manager's bin directory holds, and
    // the command stays the `PATH` entry joined with the name — what the operator put on
    // `PATH`. A lookup that refuses symlinks as "not a regular file" skips every such
    // install; one that reads the link itself as a file hands the host a dangling target.
    let _lock = path_lock();
    let (_root_dir, root) = bare_root();
    let (_dangling_dir, dangling_dir) = fixture_dir("pdks-sdk-rust-path-dangling-");
    std::os::unix::fs::symlink(
        dangling_dir.join("gone"),
        dangling_dir.join(EXECUTABLE_NAME),
    )
    .expect("dangling symlink");
    let (_link_dir, link_dir) = fixture_dir("pdks-sdk-rust-path-link-");
    let target = link_dir.join("real-pdks");
    write_executable(&target, true);
    let link = link_dir.join(EXECUTABLE_NAME);
    std::os::unix::fs::symlink(&target, &link).expect("symlink to the executable");
    let _path = PathRestore::set(&[&dangling_dir, &link_dir]);
    let seam = RecordingSeam::new();

    search(&root, &seam);

    assert_eq!(seam.only_command(), link.to_string_lossy());
}

#[test]
fn a_relative_or_empty_path_entry_is_skipped_for_the_first_absolute_one() {
    // A relative entry and an empty entry only resolve against the process cwd, which is
    // not the root: a lookup that joins them anyway runs whatever file the test binary
    // happens to sit beside, or spawns a command whose path means something else to the
    // child. The absolute entry after them is the one chosen.
    let _lock = path_lock();
    let (_root_dir, root) = bare_root();
    let (_abs_dir, abs_dir, pdks) = dir_with_pdks(true);
    let _path = PathRestore::set(&[Path::new(RELATIVE_ENTRY), Path::new(""), &abs_dir]);
    let seam = RecordingSeam::new();

    search(&root, &seam);

    assert_eq!(seam.only_command(), pdks.to_string_lossy());
}

#[test]
fn a_broken_nearest_install_stops_the_walk_before_path() {
    // The nearest `node_modules/polydeukes` is the one the project installed; a manifest
    // that does not parse is still that install. A lookup that falls through to `PATH`
    // judges the project with an umbrella the project does not use.
    let _lock = path_lock();
    let (_root_dir, root) = bare_root();
    install_polydeukes(&root, "{\"name\":\"polydeukes\",\"bin\":{");
    let (_path_dir, path_dir, _) = dir_with_pdks(true);
    let _path = PathRestore::set(&[&path_dir]);
    let seam = RecordingSeam::new();

    let reason = unavailable(search(&root, &seam));

    assert_eq!(seam.calls().len(), 0);
    // The walk never reached `PATH`, so the reason does not claim it looked there.
    assert!(!reason.contains("PATH"), "reason: {reason}");
}
