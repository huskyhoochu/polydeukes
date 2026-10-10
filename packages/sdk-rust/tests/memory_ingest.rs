//! `memory_ingest` is one `pdks memory ingest` spawn in the memory root and the child's
//! status back as a value: `Ingested` for status 0, `Unavailable { reason }` for everything
//! else. Every case injects the `spawn` seam and reads what it was handed — command, args,
//! cwd, stdin — because those are the contract between this crate and the CLI, and the
//! status → outcome table. The umbrella is resolved from `root` upward exactly as the
//! covenant verbs resolve it; `check_covenant.rs` pins that walk in depth.

use std::cell::RefCell;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use polydeukes_sdk::{
    MemoryIngestOutcome, MemoryIngestSpec, SpawnOutcome, SpawnSpec, memory_ingest,
};
use serde_json::json;
use tempfile::TempDir;

/// The umbrella's own manifest spells the bin with a leading `./`, so the stub does too.
const STUB_BIN_REL: &str = "./dist/bin.js";
/// What the child must be asked to run, after the bin path.
const INGEST_ARGS: [&str; 2] = ["memory", "ingest"];

/// A fixture tree whose path is canonical, so a bin path and a cwd computed from it agree
/// with one computed through the filesystem (macOS hands out `/var/...` for `/private/var/...`).
fn fixture_root() -> (TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix("pdks-sdk-rust-memory-")
        .tempdir()
        .expect("tempdir");
    let root = dir.path().canonicalize().expect("canonical tempdir");
    (dir, root)
}

/// A stub `polydeukes` install under `dir`; returns the bin file it points at.
fn install_stub_polydeukes(dir: &Path) -> PathBuf {
    let pkg_dir = dir.join("node_modules").join("polydeukes");
    fs::create_dir_all(pkg_dir.join("dist")).expect("stub dist dir");
    fs::write(
        dir.join("package.json"),
        "{\"name\":\"consumer\",\"private\":true}\n",
    )
    .expect("consumer manifest");
    fs::write(
        pkg_dir.join("package.json"),
        json!({ "name": "polydeukes", "bin": { "pdks": STUB_BIN_REL } }).to_string(),
    )
    .expect("stub manifest");
    let bin = pkg_dir.join("dist").join("bin.js");
    fs::write(&bin, "").expect("stub bin");
    bin
}

/// A seam that records every spec it is handed and answers `outcome` for each.
struct RecordingSeam {
    calls: RefCell<Vec<SpawnSpec>>,
    outcome: Option<(Option<i32>, &'static str, &'static str)>,
}

impl RecordingSeam {
    fn answering(status: Option<i32>, stdout: &'static str, stderr: &'static str) -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            outcome: Some((status, stdout, stderr)),
        }
    }

    fn failing() -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            outcome: None,
        }
    }

    fn spawn(&self, spec: SpawnSpec) -> io::Result<SpawnOutcome> {
        self.calls.borrow_mut().push(spec);
        match self.outcome {
            Some((status, stdout, stderr)) => Ok(SpawnOutcome {
                status,
                stdout: stdout.to_string(),
                stderr: stderr.to_string(),
            }),
            None => Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "spawn EACCES",
            )),
        }
    }

    fn calls(&self) -> std::cell::Ref<'_, Vec<SpawnSpec>> {
        self.calls.borrow()
    }
}

fn spec<'a>(
    root: &'a Path,
    spawn: &'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>,
) -> MemoryIngestSpec<'a> {
    MemoryIngestSpec {
        root,
        executable: None,
        spawn: Some(spawn),
    }
}

fn unavailable(outcome: MemoryIngestOutcome) -> String {
    match outcome {
        MemoryIngestOutcome::Unavailable { reason } => reason,
        MemoryIngestOutcome::Ingested => panic!("expected unavailable, got ingested"),
    }
}

/// `args` with the bin path canonicalized, so `./dist/bin.js` and `dist/bin.js` read alike.
fn argv_with_canonical_bin(spec: &SpawnSpec) -> Vec<String> {
    let mut args = spec.args.clone();
    let bin = Path::new(&args[0])
        .canonicalize()
        .expect("the bin path names a file");
    args[0] = bin.to_string_lossy().into_owned();
    args
}

fn expected_argv(bin: &Path, fixed: &[&str]) -> Vec<String> {
    std::iter::once(bin.to_string_lossy().into_owned())
        .chain(fixed.iter().map(|s| s.to_string()))
        .collect()
}

mod what_the_seam_is_handed {
    use super::*;

    #[test]
    fn spawns_node_on_the_resolved_bin_with_memory_ingest_cwd_root_and_an_empty_stdin() {
        // Four values, each its own defect: `node` from anywhere else is another runtime; an
        // argv carrying `--json`, `--rebuild`, or the covenant verb's flags is one the CLI
        // refuses as usage (exit 2); a cwd off `root` reads another config and writes
        // another index; a non-empty stdin is input the CLI never asked for.
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(0), "", "");

        memory_ingest(spec(&root, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].command, "node");
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &INGEST_ARGS)
        );
        assert_eq!(calls[0].cwd, root);
        assert_eq!(calls[0].stdin, "");
    }

    #[test]
    fn a_relative_root_resolves_from_the_current_directory_and_spawns_absolute_paths() {
        // A relative root has no ancestors above `.`, and a relative cwd is read by the
        // child against whatever the host's cwd is; the fixture is reached through `..`
        // from the test's own cwd so no test changes the process-wide current directory.
        let (_dir, workspace) = fixture_root();
        let bin = install_stub_polydeukes(&workspace);
        let root = workspace.join("apps").join("consumer");
        fs::create_dir_all(&root).expect("nested root");
        let cwd = std::env::current_dir()
            .expect("cwd")
            .canonicalize()
            .expect("canonical cwd");
        let mut relative = PathBuf::new();
        for _ in cwd.components().skip(1) {
            relative.push("..");
        }
        relative.push(root.strip_prefix("/").expect("absolute fixture"));
        let seam = RecordingSeam::answering(Some(0), "", "");

        memory_ingest(spec(&relative, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert!(Path::new(&calls[0].args[0]).is_absolute());
        assert!(calls[0].cwd.is_absolute());
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &INGEST_ARGS)
        );
        assert_eq!(calls[0].cwd.canonicalize().expect("cwd exists"), root);
    }
}

mod the_child_status_is_the_outcome {
    use super::*;

    #[test]
    fn status_0_is_ingested_whatever_stdout_and_stderr_say() {
        // The CLI prints its count on stdout at exit 0; a verb that parses that line, or
        // reads a non-empty stderr as failure, turns a successful ingest into `Unavailable`.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(
            Some(0),
            "indexed 3 documents into .polydeukes/memory.db\n",
            "(node) warning\n",
        );

        let outcome = memory_ingest(spec(&root, &|s| seam.spawn(s)));

        assert!(matches!(outcome, MemoryIngestOutcome::Ingested));
    }

    #[test]
    fn status_2_is_unavailable_carrying_stderr_as_the_reason() {
        // The reason is all an unattended host can log; the CLI's own line names what to
        // fix (a missing peer, an undeclared `memory.include`). Reading exit 2 as `Ingested`
        // is a recall that stays silently empty for every later session.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam =
            RecordingSeam::answering(Some(2), "", "pdks memory: memory.include is not declared\n");

        let outcome = memory_ingest(spec(&root, &|s| seam.spawn(s)));

        assert_eq!(
            unavailable(outcome),
            "pdks memory: memory.include is not declared\n"
        );
    }

    #[test]
    fn a_status_other_than_2_carries_its_stderr_as_the_reason() {
        // Every non-zero status is a failure of the same kind here; the covenant verbs'
        // split between exit 2 and the rest does not apply.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(1), "", "node: out of memory\n");

        let outcome = memory_ingest(spec(&root, &|s| seam.spawn(s)));

        assert_eq!(unavailable(outcome), "node: out of memory\n");
    }

    #[test]
    fn a_non_zero_status_with_an_empty_stderr_names_the_status() {
        // A crashed child that printed nothing still has to leave a reason; an empty
        // `reason` is an `Unavailable` nobody can act on.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(1), "", "");

        let outcome = memory_ingest(spec(&root, &|s| seam.spawn(s)));

        let reason = unavailable(outcome);
        assert!(
            reason.contains("status 1"),
            "reason names the status: {reason}"
        );
    }

    #[test]
    fn a_signalled_child_is_unavailable_with_a_reason_naming_the_signal() {
        // `None` is a child that never left a status; `unwrap_or(0)` reads a kill as a
        // finished ingest.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(None, "", "");

        let outcome = memory_ingest(spec(&root, &|s| seam.spawn(s)));

        let reason = unavailable(outcome);
        assert!(
            reason.to_lowercase().contains("signal"),
            "reason names the signal: {reason}"
        );
    }

    #[test]
    fn a_seam_that_fails_is_unavailable_carrying_the_error_never_a_panic() {
        // No process ran: the failure comes back as the value the caller was promised.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::failing();

        let outcome = memory_ingest(spec(&root, &|s| seam.spawn(s)));

        let reason = unavailable(outcome);
        assert!(
            reason.contains("spawn EACCES"),
            "reason carries the error: {reason}"
        );
    }
}

mod resolving_the_umbrella {
    use super::*;

    #[test]
    fn an_install_in_an_ancestor_of_root_is_found_and_cwd_stays_root() {
        // One probe that the verb walks the covenant verbs' path: a lookup of its own that
        // stops at `root` reads a workspace member as not installed, and a cwd moved to the
        // install's directory indexes the workspace's documents instead of the member's.
        let (_dir, workspace) = fixture_root();
        let bin = install_stub_polydeukes(&workspace);
        let root = workspace.join("apps").join("consumer");
        fs::create_dir_all(&root).expect("nested root");
        let seam = RecordingSeam::answering(Some(0), "", "");

        memory_ingest(spec(&root, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &INGEST_ARGS)
        );
        assert_eq!(calls[0].cwd, root);
    }
}
