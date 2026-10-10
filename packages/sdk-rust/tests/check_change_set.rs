//! `check_change_set` is `check_covenant` with one more argument and another stdin: a unified
//! diff goes to `pdks covenant check --diff` byte for byte, and the child's status and stderr
//! come back as the same verdict value. Every case injects the `spawn` seam and reads what it
//! was handed, because the argv and the stdin are the only two places this verb can differ
//! from its sibling, and the status → verdict table is the one place it must not.
//!
//! `check_covenant.rs` pins resolution in depth (ancestor walk, broken manifests, relative
//! roots); this file proves the change-set verb goes through the same path and stops there.

use std::cell::RefCell;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use polydeukes_sdk::{
    CheckChangeSetSpec, CheckCovenantVerdict, Enforce, SpawnOutcome, SpawnSpec, check_change_set,
};
use serde_json::json;
use tempfile::TempDir;

/// Injected fixture values — a consumer's own diff, as `git diff` prints it.
const DIFF: &str = "diff --git a/src/answer.ts b/src/answer.ts\n--- a/src/answer.ts\n+++ b/src/answer.ts\n@@ -1 +1 @@\n-export const answer = 41;\n+export const answer = 42;\n";
/// The umbrella's own manifest spells the bin with a leading `./`, so the stub does too.
const STUB_BIN_REL: &str = "./dist/bin.js";
/// What the child must be asked to run, after the bin path, under each posture.
const BLOCK_ARGS: [&str; 5] = ["covenant", "check", "--diff", "--enforce", "block"];
const ADVISE_ARGS: [&str; 5] = ["covenant", "check", "--diff", "--enforce", "advise"];
/// Injected fixture values — a host layer and a row file, both outside the judged tree.
const LAYER_PATH: &str = "/host/policy/discipline-layer.json";
const TELEMETRY_PATH: &str = "/host/logs/roi.log";

/// A fixture tree whose path is canonical, so a bin path and a cwd computed from it agree
/// with one computed through the filesystem (macOS hands out `/var/...` for `/private/var/...`).
fn fixture_root() -> (TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix("pdks-sdk-rust-")
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
    outcome: (Option<i32>, &'static str),
}

impl RecordingSeam {
    fn answering(status: Option<i32>, stderr: &'static str) -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            outcome: (status, stderr),
        }
    }

    fn spawn(&self, spec: SpawnSpec) -> io::Result<SpawnOutcome> {
        self.calls.borrow_mut().push(spec);
        let (status, stderr) = self.outcome;
        Ok(SpawnOutcome {
            status,
            stdout: String::new(),
            stderr: stderr.to_string(),
        })
    }

    fn calls(&self) -> std::cell::Ref<'_, Vec<SpawnSpec>> {
        self.calls.borrow()
    }
}

/// The spec every case starts from: default posture, no layer, no row path, the seam injected.
fn spec<'a>(
    repo_root: &'a Path,
    diff: &'a str,
    spawn: &'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>,
) -> CheckChangeSetSpec<'a> {
    CheckChangeSetSpec {
        repo_root,
        diff,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        spawn: Some(spawn),
    }
}

fn upheld(verdict: CheckCovenantVerdict) -> String {
    match verdict {
        CheckCovenantVerdict::Upheld { advisories } => advisories,
        CheckCovenantVerdict::Blocked { reason } => {
            panic!("expected upheld, got blocked: {reason}")
        }
        CheckCovenantVerdict::Unjudged { reason } => {
            panic!("expected upheld, got unjudged: {reason}")
        }
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

/// `args` with the bin path canonicalized, so `./dist/bin.js` and `dist/bin.js` read alike.
fn argv_with_canonical_bin(spec: &SpawnSpec) -> Vec<String> {
    let mut args = spec.args.clone();
    let bin = Path::new(&args[0])
        .canonicalize()
        .expect("the bin path names a file");
    args[0] = bin.to_string_lossy().into_owned();
    args
}

fn expected_argv(bin: &Path, fixed: &[&str], tail: &[&str]) -> Vec<String> {
    std::iter::once(bin.to_string_lossy().into_owned())
        .chain(fixed.iter().map(|s| s.to_string()))
        .chain(tail.iter().map(|s| s.to_string()))
        .collect()
}

mod what_the_seam_is_handed {
    use super::*;

    #[test]
    fn default_posture_spawns_node_on_the_resolved_bin_with_diff_block_cwd_repo_root_stdin_the_diff()
     {
        // Without `--diff` the child parses the diff as an input IR and exits 2 on every call;
        // `advise` by default lands every break at exit 0 with nobody reading stderr; a cwd off
        // the repo_root reads another config; a stdin that is not the diff byte for byte — a
        // trailing newline added or dropped, a re-encoded header — is a change set this crate
        // edited.
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(0), "");

        check_change_set(spec(&root, DIFF, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].command, "node");
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &BLOCK_ARGS, &[])
        );
        assert_eq!(calls[0].cwd, root);
        assert_eq!(calls[0].stdin, DIFF);
    }

    #[test]
    fn advise_swaps_only_the_level() {
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(0), "");
        let spawn = |s| seam.spawn(s);
        let mut s = spec(&root, DIFF, &spawn);
        s.enforce = Some(Enforce::Advise);

        check_change_set(s);

        assert_eq!(
            argv_with_canonical_bin(&seam.calls()[0]),
            expected_argv(&bin, &ADVISE_ARGS, &[])
        );
    }

    #[test]
    fn config_layer_then_telemetry_path_follow_the_fixed_argv_verbatim() {
        // Either path dropped, resolved here instead of by the umbrella, or the two swapped
        // under the wrong flag hands the child another file or none.
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(0), "");
        let spawn = |s| seam.spawn(s);
        let mut s = spec(&root, DIFF, &spawn);
        s.config_layer = Some(Path::new(LAYER_PATH));
        s.telemetry_path = Some(Path::new(TELEMETRY_PATH));

        check_change_set(s);

        assert_eq!(
            argv_with_canonical_bin(&seam.calls()[0]),
            expected_argv(
                &bin,
                &BLOCK_ARGS,
                &[
                    "--config-layer",
                    LAYER_PATH,
                    "--telemetry-path",
                    TELEMETRY_PATH
                ]
            )
        );
    }

    #[test]
    fn an_empty_diff_is_sent_as_is_and_judged() {
        // Nothing changed is a change set the judge answers (exit 0, no row). A crate that
        // short-circuits an empty diff — as `Upheld` without spawning, or as `Unjudged` —
        // answers for the judge.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(0), "");

        let verdict = check_change_set(spec(&root, "", &|s| seam.spawn(s)));

        assert_eq!(seam.calls().len(), 1);
        assert_eq!(seam.calls()[0].stdin, "");
        upheld(verdict);
    }
}

mod the_child_status_is_the_verdict {
    use super::*;

    #[test]
    fn a_status_outside_0_and_2_is_unjudged_not_blocked_and_not_upheld() {
        // A crashed child is not a verdict: `Blocked` invents a break, `Upheld` is the
        // fail-open hole a stale dist falls through.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(1), "TypeError: covenant.x is not a function");

        let verdict = check_change_set(spec(&root, DIFF, &|s| seam.spawn(s)));

        let reason = unjudged(verdict);
        assert!(
            reason.contains("status 1"),
            "reason names the status: {reason}"
        );
    }
}

mod resolving_the_umbrella {
    use super::*;

    #[test]
    fn no_install_anywhere_spawns_nothing_and_is_unjudged_naming_this_change_set() {
        // With no bin there is nothing to spawn: `Upheld` here passes every change set
        // unjudged. The reason names what went unjudged — a change set, not an input — so a
        // host logging both verbs can tell them apart. The system temp directory is assumed
        // to have no `node_modules/polydeukes` in any of its ancestors.
        let (_dir, root) = fixture_root();
        fs::write(
            root.join("package.json"),
            "{\"name\":\"consumer\",\"private\":true}\n",
        )
        .expect("consumer manifest");
        let seam = RecordingSeam::answering(Some(0), "");

        let verdict = check_change_set(spec(&root, DIFF, &|s| seam.spawn(s)));

        let reason = unjudged(verdict);
        assert!(
            reason.contains("this change set"),
            "reason names the change set: {reason}"
        );
        assert_eq!(seam.calls().len(), 0);
    }

    #[test]
    fn an_install_in_an_ancestor_of_repo_root_is_found_and_cwd_stays_repo_root() {
        // One probe that the verb walks the same path as `check_covenant`: a verb with its own
        // lookup that stops at repo_root reads a workspace member as not installed.
        let (_dir, workspace) = fixture_root();
        let bin = install_stub_polydeukes(&workspace);
        let repo_root = workspace.join("apps").join("consumer");
        fs::create_dir_all(&repo_root).expect("nested repo_root");
        let seam = RecordingSeam::answering(Some(0), "");

        check_change_set(spec(&repo_root, DIFF, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &BLOCK_ARGS, &[])
        );
        assert_eq!(calls[0].cwd, repo_root);
    }
}
