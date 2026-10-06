//! `check_covenant` and `check_change_set` against the BUILT `pdks`: a throwaway tree
//! scaffolded by `pdks init`, wired to the checkout's install graph by symlink, with one
//! protected path of its own. Only a real spawn proves that the crate finds the umbrella from
//! the consumer's repo_root, that the child reads the consumer's config, and that the row the
//! child writes is the judge's own. `check_covenant.rs` and `check_change_set.rs` pin the same
//! contract through the injected seam.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use polydeukes_sdk::{
    CheckChangeSetSpec, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, FileChange,
    ToolCall, Tools, check_change_set, check_covenant,
};
use serde_json::Value;
use tempfile::TempDir;

/// Injected fixture values — the consumer's roster, its protected directory, its targets.
const WRITE_FILE: &str = "writeFile";
const RM: &str = "rm";
const EXEC: &str = "exec";
const COMMAND_ARG: &str = "command";
const PROTECTED_DIR: &str = "pipeline/gates";
const PROTECTED_TARGET: &str = "pipeline/gates/policy.json";
const ORDINARY_TARGET: &str = "src/answer.ts";
const TELEMETRY_REL: &str = "roi.log";
/// The meta-covenant that judges a write under a protected path.
const SELF_MOD_LABEL: &str = "self-mod";
const BLOCKED_EVENT: &str = "blocked";
/// The consumer's config file, which `pdks init` writes and the judge protects on its own;
/// the change-set cases hand its row file by `telemetry_path` instead of the config's.
const CONFIG_FILE: &str = "polydeukes.config.yaml";
const CHANGE_SET_TELEMETRY_REL: &str = "change-set.log";
/// A unified diff adding an entry to the config, paths in `a/`/`b/` form from repo_root.
const CONFIG_DIFF: &str = "diff --git a/polydeukes.config.yaml b/polydeukes.config.yaml\n--- a/polydeukes.config.yaml\n+++ b/polydeukes.config.yaml\n@@ -5,2 +5,3 @@\n protectedPaths:\n   - 'pipeline/gates'\n+  - 'src/secrets'\n";
/// A unified diff creating the ordinary target.
const ORDINARY_DIFF: &str = "diff --git a/src/answer.ts b/src/answer.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/answer.ts\n@@ -0,0 +1 @@\n+export const answer = 42;\n";

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
        .prefix("pdks-sdk-rust-e2e-")
        .tempdir()
        .expect("tempdir");
    let root = dir.path().canonicalize().expect("canonical tempdir");
    (dir, root)
}

/// The whole real install graph by one symlink, `pdks init` for the scaffold, then the
/// consumer's own config over the scaffolded one: one protected directory and a telemetry
/// path inside the fixture, so the rows this suite reads are this tree's alone.
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
    let config = format!(
        "languages:\n  typescript:\n    productionGlob: 'src/**/*.ts'\n    testCmd: 'echo {{scope}}'\nprotectedPaths:\n  - '{PROTECTED_DIR}'\ntelemetry:\n  logPath: '{}'\n",
        root.join(TELEMETRY_REL).display()
    );
    fs::write(root.join("polydeukes.config.yaml"), config).expect("consumer config");
}

/// The consumer-built input for one `writeFile` under its own roster — no `session`, no `actor`.
fn write_input(path: &str, content: &str) -> CovenantInput {
    let mut args = serde_json::Map::new();
    args.insert("path".into(), Value::String(path.into()));
    args.insert("content".into(), Value::String(content.into()));
    CovenantInput {
        tool_calls: vec![ToolCall {
            name: WRITE_FILE.into(),
            args,
            file_change: Some(FileChange::Create {
                path: path.into(),
                post: content.into(),
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

fn judge(root: &Path, input: &CovenantInput) -> CheckCovenantVerdict {
    check_covenant(CheckCovenantSpec {
        repo_root: root,
        input,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        spawn: None,
    })
}

/// Every telemetry row under the fixture as (event, label, subject); rows are tab-separated
/// `timestamp event label subject`.
fn rows(root: &Path) -> Vec<(String, String, String)> {
    rows_in(&root.join(TELEMETRY_REL))
}

fn rows_in(file: &Path) -> Vec<(String, String, String)> {
    let Ok(text) = fs::read_to_string(file) else {
        return vec![];
    };
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let fields: Vec<&str> = line.split('\t').collect();
            (
                fields[1].to_string(),
                fields[2].to_string(),
                fields[3].to_string(),
            )
        })
        .collect()
}

fn blocked_rows(root: &Path) -> Vec<(String, String, String)> {
    rows(root)
        .into_iter()
        .filter(|(event, _, _)| event == BLOCKED_EVENT)
        .collect()
}

#[test]
fn a_write_under_the_protected_path_is_blocked_with_the_reason_and_one_self_mod_row() {
    // The exact row separates a verdict from a fail-closed crash on the same status: a crash
    // records under the runner's label, never under self-mod. The reason must name the
    // protected entry, because that text is all an unattended consumer can act on.
    let (_dir, root) = project_root();
    scaffold_consumer(&root);

    let verdict = judge(&root, &write_input(PROTECTED_TARGET, "{}\n"));

    let CheckCovenantVerdict::Blocked { reason } = verdict else {
        panic!("expected blocked");
    };
    assert!(
        reason.contains(PROTECTED_DIR),
        "reason names the protected entry: {reason}"
    );
    let expected = (
        BLOCKED_EVENT.to_string(),
        SELF_MOD_LABEL.to_string(),
        PROTECTED_DIR.to_string(),
    );
    assert_eq!(blocked_rows(&root), vec![expected]);
}

#[test]
fn a_write_outside_every_protected_path_is_upheld_and_leaves_no_blocked_row() {
    // The over-blocking end, and the repo_root end: a child anchored on the test process's
    // cwd would read THIS checkout's config, under which `src/` edits meet the disciplines.
    let (_dir, root) = project_root();
    scaffold_consumer(&root);

    let verdict = judge(
        &root,
        &write_input(ORDINARY_TARGET, "export const answer = 42;\n"),
    );

    assert!(
        matches!(verdict, CheckCovenantVerdict::Upheld { .. }),
        "expected upheld"
    );
    assert_eq!(blocked_rows(&root), vec![]);
}

fn judge_change_set(root: &Path, diff: &str) -> CheckCovenantVerdict {
    check_change_set(CheckChangeSetSpec {
        repo_root: root,
        diff,
        enforce: None,
        config_layer: None,
        telemetry_path: Some(&root.join(CHANGE_SET_TELEMETRY_REL)),
        spawn: None,
    })
}

#[test]
fn a_diff_touching_the_config_is_blocked_and_the_telemetry_path_file_holds_one_self_mod_row() {
    // Three things only a real child proves at once: `--diff` reached the argv (without it
    // the diff text is refused as an input IR, exit 2 with no self-mod row), the row landed in
    // the file this call named rather than the config's own log, and its subject is the
    // protected entry the change reached (a file entry here, so it equals the path) — the
    // value a host compares against a session's `witnessed` row.
    let (_dir, root) = project_root();
    scaffold_consumer(&root);

    let verdict = judge_change_set(&root, CONFIG_DIFF);

    let CheckCovenantVerdict::Blocked { reason } = verdict else {
        panic!("expected blocked");
    };
    assert!(
        reason.contains(CONFIG_FILE),
        "reason names the protected file: {reason}"
    );
    let expected = (
        BLOCKED_EVENT.to_string(),
        SELF_MOD_LABEL.to_string(),
        CONFIG_FILE.to_string(),
    );
    let in_named_file: Vec<_> = rows_in(&root.join(CHANGE_SET_TELEMETRY_REL))
        .into_iter()
        .filter(|(event, _, _)| event == BLOCKED_EVENT)
        .collect();
    assert_eq!(in_named_file, vec![expected]);
    assert_eq!(blocked_rows(&root), vec![]);
}

#[test]
fn a_diff_outside_every_protected_path_is_upheld_and_leaves_no_blocked_row() {
    // The over-blocking end: a child anchored on the test process's cwd would read THIS
    // checkout's config and its disciplines over `src/`; the consumer's config has none.
    let (_dir, root) = project_root();
    scaffold_consumer(&root);

    let verdict = judge_change_set(&root, ORDINARY_DIFF);

    assert!(
        matches!(verdict, CheckCovenantVerdict::Upheld { .. }),
        "expected upheld"
    );
    assert_eq!(
        rows_in(&root.join(CHANGE_SET_TELEMETRY_REL))
            .into_iter()
            .filter(|(event, _, _)| event == BLOCKED_EVENT)
            .count(),
        0
    );
}
