//! `check_covenant` is the whole crate: one input in, one `pdks covenant check` spawn, the
//! child's status and stderr back as a verdict value. It judges nothing, writes no row, and
//! neither adds to nor removes from the input. Every case injects the `spawn` seam and reads
//! what the seam was handed — command, args, cwd, stdin — because those four values are the
//! contract between this crate and the judge process, and the status → verdict table.
//!
//! `polydeukes` is located from the caller's `repo_root` upward: a stub package under a
//! fixture's `node_modules` carrying `bin.pdks` is what resolution finds, and a tree without
//! it is the not-installed case. The test process's own cwd never enters the lookup.

use std::cell::RefCell;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use polydeukes_sdk::{
    CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, Enforce, FileChange, SpawnOutcome,
    SpawnSpec, ToolCall, Tools, check_covenant,
};
use serde_json::{Value, json};
use tempfile::TempDir;

/// Injected fixture values — the consumer's own tool roster and a target it writes.
const WRITE_FILE: &str = "writeFile";
const RM: &str = "rm";
const EXEC: &str = "exec";
const COMMAND_ARG: &str = "command";
const TARGET: &str = "src/answer.ts";
const CONTENT: &str = "export const answer = 42;\n";
/// The umbrella's own manifest spells the bin with a leading `./`, so the stub does too.
const STUB_BIN_REL: &str = "./dist/bin.js";
/// What the child must be asked to run, after the bin path, under each posture.
const BLOCK_ARGS: [&str; 4] = ["covenant", "check", "--enforce", "block"];
const ADVISE_ARGS: [&str; 4] = ["covenant", "check", "--enforce", "advise"];
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
fn install_stub_polydeukes(dir: &Path, manifest: &str) -> PathBuf {
    let pkg_dir = dir.join("node_modules").join("polydeukes");
    fs::create_dir_all(pkg_dir.join("dist")).expect("stub dist dir");
    fs::write(
        dir.join("package.json"),
        "{\"name\":\"consumer\",\"private\":true}\n",
    )
    .expect("consumer manifest");
    fs::write(pkg_dir.join("package.json"), manifest).expect("stub manifest");
    let bin = pkg_dir.join("dist").join("bin.js");
    fs::write(&bin, "").expect("stub bin");
    bin
}

/// The manifest every resolving case uses: `bin.pdks` as a string.
fn pdks_manifest() -> String {
    json!({ "name": "polydeukes", "bin": { "pdks": STUB_BIN_REL } }).to_string()
}

/// The consumer-built input: one write under the consumer's own roster, no `session`, no `actor`.
fn write_input() -> CovenantInput {
    let mut args = serde_json::Map::new();
    args.insert("path".into(), Value::String(TARGET.into()));
    args.insert("content".into(), Value::String(CONTENT.into()));
    CovenantInput {
        tool_calls: vec![ToolCall {
            name: WRITE_FILE.into(),
            args,
            file_change: Some(FileChange::Create {
                path: TARGET.into(),
                post: CONTENT.into(),
            }),
        }],
        subagent_spawns: vec![],
        user_messages: vec![],
        actor: None,
        session: None,
        tools: Some(Tools {
            mutating: vec![WRITE_FILE.into(), RM.into()],
            shell: vec![EXEC.into()],
            command_args: vec![COMMAND_ARG.into()],
        }),
    }
}

/// A seam that records every spec it is handed and answers `outcome` for each.
struct RecordingSeam {
    calls: RefCell<Vec<SpawnSpec>>,
    outcome: Option<(Option<i32>, &'static str)>,
}

impl RecordingSeam {
    fn answering(status: Option<i32>, stderr: &'static str) -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            outcome: Some((status, stderr)),
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
            Some((status, stderr)) => Ok(SpawnOutcome {
                status,
                stdout: String::new(),
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

/// The spec every case starts from: default posture, no layer, no row path, the seam injected.
fn spec<'a>(
    repo_root: &'a Path,
    input: &'a CovenantInput,
    spawn: &'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>,
) -> CheckCovenantSpec<'a> {
    CheckCovenantSpec {
        repo_root,
        input,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: None,
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

fn blocked(verdict: CheckCovenantVerdict) -> String {
    match verdict {
        CheckCovenantVerdict::Blocked { reason } => reason,
        CheckCovenantVerdict::Upheld { advisories } => {
            panic!("expected blocked, got upheld: {advisories}")
        }
        CheckCovenantVerdict::Unjudged { reason } => {
            panic!("expected blocked, got unjudged: {reason}")
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
    fn default_posture_spawns_node_on_the_resolved_bin_with_block_cwd_repo_root_stdin_the_input() {
        // Four values, each its own defect: `node` from anywhere else is another runtime;
        // `advise` by default turns every break into exit 0 with no one reading stderr; a cwd
        // off the repo_root reads another config; a stdin that is not the input's own JSON is
        // an input this crate edited.
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");

        check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].command, "node");
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &BLOCK_ARGS, &[])
        );
        assert_eq!(calls[0].cwd, root);
        let sent: Value = serde_json::from_str(&calls[0].stdin).expect("stdin is JSON");
        assert_eq!(sent, serde_json::to_value(&input).unwrap());
    }

    #[test]
    fn explicit_block_is_the_same_argv_as_the_default() {
        // `Some(Block)` rendered through a derived name (`Block`) or a numeric level is an
        // argv the bin refuses as usage — exit 2 with no judgment on every call.
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");
        let spawn = |s| seam.spawn(s);
        let mut s = spec(&root, &input, &spawn);
        s.enforce = Some(Enforce::Block);

        check_covenant(s);

        assert_eq!(
            argv_with_canonical_bin(&seam.calls()[0]),
            expected_argv(&bin, &BLOCK_ARGS, &[])
        );
    }

    #[test]
    fn advise_swaps_only_the_level() {
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");
        let spawn = |s| seam.spawn(s);
        let mut s = spec(&root, &input, &spawn);
        s.enforce = Some(Enforce::Advise);

        check_covenant(s);

        assert_eq!(
            argv_with_canonical_bin(&seam.calls()[0]),
            expected_argv(&bin, &ADVISE_ARGS, &[])
        );
    }

    #[test]
    fn config_layer_appends_its_flag_after_the_fixed_argv_verbatim() {
        // The path is the host's, resolved by the umbrella against repo_root; a crate that
        // resolves it here, or drops it, hands the child another file or none.
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");
        let spawn = |s| seam.spawn(s);
        let mut s = spec(&root, &input, &spawn);
        s.config_layer = Some(Path::new(LAYER_PATH));

        check_covenant(s);

        assert_eq!(
            argv_with_canonical_bin(&seam.calls()[0]),
            expected_argv(&bin, &BLOCK_ARGS, &["--config-layer", LAYER_PATH])
        );
    }

    #[test]
    fn telemetry_path_appends_its_flag_after_the_fixed_argv_verbatim() {
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");
        let spawn = |s| seam.spawn(s);
        let mut s = spec(&root, &input, &spawn);
        s.telemetry_path = Some(Path::new(TELEMETRY_PATH));

        check_covenant(s);

        assert_eq!(
            argv_with_canonical_bin(&seam.calls()[0]),
            expected_argv(&bin, &BLOCK_ARGS, &["--telemetry-path", TELEMETRY_PATH])
        );
    }

    #[test]
    fn both_fields_send_the_layer_pair_then_the_telemetry_pair() {
        // One field overwriting the other's slot, or the two values swapped under the wrong
        // flag, sends the row file as the layer and fails every call closed.
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");
        let spawn = |s| seam.spawn(s);
        let mut s = spec(&root, &input, &spawn);
        s.enforce = Some(Enforce::Advise);
        s.config_layer = Some(Path::new(LAYER_PATH));
        s.telemetry_path = Some(Path::new(TELEMETRY_PATH));

        check_covenant(s);

        assert_eq!(
            argv_with_canonical_bin(&seam.calls()[0]),
            expected_argv(
                &bin,
                &ADVISE_ARGS,
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
    fn an_input_with_no_actor_session_or_tools_travels_without_them() {
        // The host proves session evidence; this crate is not a host. A crate that fills in
        // `session`, an `actor`, or an empty `tools` roster makes the judge read a proof
        // nobody gave.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, &pdks_manifest());
        let input = CovenantInput {
            tool_calls: vec![],
            subagent_spawns: vec![],
            user_messages: vec![],
            actor: None,
            session: None,
            tools: None,
        };
        let seam = RecordingSeam::answering(Some(0), "");

        check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        let sent: Value = serde_json::from_str(&seam.calls()[0].stdin).expect("stdin is JSON");
        let keys: Vec<&String> = sent.as_object().expect("an object").keys().collect();
        assert_eq!(keys, ["subagentSpawns", "toolCalls", "userMessages"]);
    }
}

mod the_child_status_is_the_verdict {
    use super::*;

    #[test]
    fn status_0_is_upheld_carrying_stderr_as_advisories() {
        // Advisory lines travel on stderr at exit 0; a consumer with no TTY decides whether
        // the model sees them, so they must come back as the value, not be swallowed.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "advised: no-todo adds TODO\n");

        let verdict = check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        assert_eq!(upheld(verdict), "advised: no-todo adds TODO\n");
    }

    #[test]
    fn status_2_is_blocked_carrying_stderr_as_the_reason() {
        // The reason is the valve's replacement on an unattended surface: the consumer
        // writes it where a human later reads and stops. A `Blocked` with no reason is a
        // stop nobody can act on.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(2), "self-mod: .grok/hooks\n");

        let verdict = check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        assert_eq!(blocked(verdict), "self-mod: .grok/hooks\n");
    }

    #[test]
    fn status_1_is_unjudged_with_a_reason_naming_the_status() {
        // A crashed child is not a verdict. Mapping 1 onto `Blocked` invents a break;
        // mapping it onto `Upheld` is the fail-open hole an uninstalled dist would fall
        // through.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(1), "TypeError: covenant.x is not a function");

        let verdict = check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        let reason = unjudged(verdict);
        assert!(
            reason.contains("status 1"),
            "reason names the status: {reason}"
        );
    }

    #[test]
    fn a_status_outside_0_and_2_is_unjudged_not_blocked() {
        // Only 2 is a break. Reading every non-zero status as `Blocked` invents a violation
        // the judge never found, and the caller retries a call nothing objected to.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(3), "");

        let verdict = check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        unjudged(verdict);
    }

    #[test]
    fn a_signalled_child_is_unjudged_with_a_reason_naming_the_signal() {
        // `None` is a child that never left a status; `unwrap_or(0)` reads a kill as uphold.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(None, "");

        let verdict = check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        let reason = unjudged(verdict);
        assert!(
            reason.to_lowercase().contains("signal"),
            "reason names the signal: {reason}"
        );
    }

    #[test]
    fn a_seam_that_fails_is_unjudged_carrying_the_failure_never_a_panic() {
        // No process ran, so no verdict and no row: the failure comes back as the value the
        // caller was promised rather than as a panic it did not sign up for.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::failing();

        let verdict = check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        let reason = unjudged(verdict);
        assert!(
            reason.contains("spawn EACCES"),
            "reason carries the error: {reason}"
        );
    }
}

mod resolving_the_umbrella {
    use super::*;

    #[test]
    fn an_install_in_an_ancestor_of_repo_root_is_found_and_cwd_stays_repo_root() {
        // A workspace installs once at its top and judges a nested project. Looking only in
        // repo_root reads a monorepo member as not installed; setting cwd to the manifest's
        // directory makes the child read the workspace's config instead of the member's.
        let (_dir, workspace) = fixture_root();
        let bin = install_stub_polydeukes(&workspace, &pdks_manifest());
        let repo_root = workspace.join("apps").join("consumer");
        fs::create_dir_all(&repo_root).expect("nested repo_root");
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");

        check_covenant(spec(&repo_root, &input, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &BLOCK_ARGS, &[])
        );
        assert_eq!(calls[0].cwd, repo_root);
    }

    #[test]
    fn the_nearest_install_wins_over_an_ancestors() {
        // Two installs on the walk: the one the judged project would itself resolve is the
        // nearest. A walk that starts at the top, or keeps the last hit, spawns the other.
        let (_dir, workspace) = fixture_root();
        install_stub_polydeukes(&workspace, &pdks_manifest());
        let repo_root = workspace.join("apps").join("consumer");
        let near_bin = install_stub_polydeukes(&repo_root, &pdks_manifest());
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");

        check_covenant(spec(&repo_root, &input, &|s| seam.spawn(s)));

        assert_eq!(
            argv_with_canonical_bin(&seam.calls()[0]),
            expected_argv(&near_bin, &BLOCK_ARGS, &[])
        );
    }

    #[test]
    fn an_unparseable_manifest_spawns_nothing_and_is_unjudged() {
        // A half-written install is not an install; spawning `node <nothing>` or panicking on
        // the parse both leave the caller without the value it was promised.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, "{\"name\":\"polydeukes\",\"bin\":{");
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");

        let verdict = check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        unjudged(verdict);
        assert_eq!(seam.calls().len(), 0);
    }

    #[test]
    fn a_manifest_with_no_bin_pdks_spawns_nothing_and_is_unjudged() {
        // A manifest found but carrying no bin would otherwise be spawned on an empty path, a
        // crash the status table turns into `Unjudged` without saying why.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, "{\"name\":\"polydeukes\",\"version\":\"0.0.0\"}");
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");

        let verdict = check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        unjudged(verdict);
        assert_eq!(seam.calls().len(), 0);
    }

    #[test]
    fn a_broken_nearest_install_stops_the_walk_rather_than_using_an_ancestors() {
        // The nearest manifest is the install the judged project resolves. Skipping past a
        // broken one to a healthy ancestor judges with an umbrella the project does not use.
        let (_dir, workspace) = fixture_root();
        install_stub_polydeukes(&workspace, &pdks_manifest());
        let repo_root = workspace.join("apps").join("consumer");
        install_stub_polydeukes(&repo_root, "{\"name\":\"polydeukes\",\"bin\":{");
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");

        let verdict = check_covenant(spec(&repo_root, &input, &|s| seam.spawn(s)));

        unjudged(verdict);
        assert_eq!(seam.calls().len(), 0);
    }

    #[test]
    fn a_relative_repo_root_resolves_from_the_current_directory_and_spawns_absolute_paths() {
        // A relative root has no ancestors above `.`, and a relative bin would be read again
        // from the child's cwd. The fixture is reached through `..` from the test's own cwd,
        // so no test changes the process-wide current directory.
        let (_dir, workspace) = fixture_root();
        let bin = install_stub_polydeukes(&workspace, &pdks_manifest());
        let repo_root = workspace.join("apps").join("consumer");
        fs::create_dir_all(&repo_root).expect("nested repo_root");
        let cwd = std::env::current_dir()
            .expect("cwd")
            .canonicalize()
            .expect("canonical cwd");
        let mut relative = PathBuf::new();
        for _ in cwd.components().skip(1) {
            relative.push("..");
        }
        relative.push(repo_root.strip_prefix("/").expect("absolute fixture"));
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");

        check_covenant(spec(&relative, &input, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert!(Path::new(&calls[0].args[0]).is_absolute());
        assert!(calls[0].cwd.is_absolute());
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &BLOCK_ARGS, &[])
        );
        assert_eq!(calls[0].cwd.canonicalize().expect("cwd exists"), repo_root);
    }

    #[test]
    fn an_install_directory_without_a_manifest_stops_the_walk() {
        // Node resolves the nearest `node_modules/polydeukes` directory whether or not its
        // manifest survived; passing over a half-pruned one judges with an ancestor's umbrella.
        let (_dir, workspace) = fixture_root();
        install_stub_polydeukes(&workspace, &pdks_manifest());
        let repo_root = workspace.join("apps").join("consumer");
        fs::create_dir_all(repo_root.join("node_modules").join("polydeukes")).expect("bare dir");
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");

        let verdict = check_covenant(spec(&repo_root, &input, &|s| seam.spawn(s)));

        unjudged(verdict);
        assert_eq!(seam.calls().len(), 0);
    }

    #[test]
    fn a_bin_written_as_a_plain_string_is_not_bin_pdks() {
        // npm's string shorthand names the bin after the package, so there is no `pdks`
        // entry to spawn; reading the string as if it were `bin.pdks` runs another file.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root, "{\"name\":\"polydeukes\",\"bin\":\"./dist/bin.js\"}");
        let input = write_input();
        let seam = RecordingSeam::answering(Some(0), "");

        let verdict = check_covenant(spec(&root, &input, &|s| seam.spawn(s)));

        unjudged(verdict);
        assert_eq!(seam.calls().len(), 0);
    }
}
