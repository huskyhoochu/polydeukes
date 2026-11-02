#![cfg(unix)]
#![expect(
    clippy::indexing_slicing,
    reason = "serde_json::Value indexing yields Null for a missing key and the assertions fail loudly"
)]
// Process-level tests of `pdks-claude-code hook`. The judge is a shell script passed as `--pdks`;
// it records its argv, working directory and stdin in a directory outside the project root, so a
// file left inside the root is always something the adapter wrote.

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

const ADAPTER: &str = env!("CARGO_BIN_EXE_pdks-claude-code");
const MUTATING: [&str; 4] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const BASE_ARGV: &str = "covenant\ncheck\n--enforce\nblock\n";

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Sandbox {
    dir: PathBuf,
    root: PathBuf,
    record: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let raw = std::env::temp_dir().join(format!(
            "pdks-cc-hook-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let root = raw.join("project");
        let record = raw.join("record");
        fs::create_dir_all(&root).expect("the project directory is creatable");
        fs::create_dir_all(&record).expect("the record directory is creatable");
        // The adapter and the fake judge both see the physical path, so compare against it.
        let dir = fs::canonicalize(&raw).expect("the sandbox is canonicalizable");
        Self {
            root: dir.join("project"),
            record: dir.join("record"),
            dir,
        }
    }

    fn script(&self, name: &str, body: &str) -> PathBuf {
        let path = self.dir.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("the script is writable");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
            .expect("the script is chmod-able");
        path
    }

    // A judge that records what it was given, then runs `tail`.
    fn judge(&self, tail: &str) -> PathBuf {
        let record = self.record.display();
        self.script(
            "judge",
            &format!(
                "printf '%s\\n' \"$@\" > '{record}/argv'\npwd > '{record}/cwd'\ncat > '{record}/stdin'\n{tail}"
            ),
        )
    }

    fn run(&self, args: &[&str], stdin: &str) -> Output {
        let mut child = Command::new(ADAPTER)
            .args(args)
            .current_dir(&self.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the adapter starts");
        // An adapter that exits before reading closes the pipe; that is not a test error.
        child
            .stdin
            .take()
            .expect("stdin is piped")
            .write_all(stdin.as_bytes())
            .ok();
        child.wait_with_output().expect("the adapter finishes")
    }

    fn hook(&self, pdks: &Path, stdin: &str) -> Output {
        let root = self.root.to_string_lossy().into_owned();
        let pdks = pdks.to_string_lossy().into_owned();
        self.run(&["hook", "--project-root", &root, "--pdks", &pdks], stdin)
    }

    fn recorded(&self, file: &str) -> String {
        fs::read_to_string(self.record.join(file)).expect("the judge recorded this file")
    }

    fn payload(&self) -> String {
        json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "tool_input": {"file_path": "a.txt", "content": "x\n"},
            "cwd": self.root,
        })
        .to_string()
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        // Cleanup failure leaves a temp directory behind and nothing else.
        #[expect(
            clippy::let_underscore_must_use,
            reason = "temp-dir removal is best effort"
        )]
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn out(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn err(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

mod judge_cannot_run {
    use super::*;

    #[test]
    fn a_judge_that_does_not_exist_lets_the_call_proceed_and_says_to_install_pdks() {
        let sandbox = Sandbox::new();
        let output = sandbox.hook(&sandbox.dir.join("no-such-pdks"), &sandbox.payload());
        // An adapter left behind after pdks was removed must not stop every edit and shell call.
        // Catches: blocking the call, proceeding without telling the user why nothing was
        // judged, or writing a telemetry row the judge never produced.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert!(
            err(&output).contains("install pdks"),
            "stderr: {}",
            err(&output)
        );
        assert_eq!(out(&output), "");
        assert!(!sandbox.root.join(".polydeukes/roi.log").exists());
    }

    #[test]
    fn a_missing_project_root_lets_the_call_proceed_without_running_the_judge() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 2");
        let root = sandbox
            .dir
            .join("moved-away")
            .to_string_lossy()
            .into_owned();
        let pdks = judge.to_string_lossy().into_owned();
        let output = sandbox.run(
            &["hook", "--project-root", &root, "--pdks", &pdks],
            &sandbox.payload(),
        );
        // Catches: reporting a project that was moved after init as a missing judge (the
        // "install pdks" hint), blocking the call, or starting the judge anyway.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert!(
            err(&output).contains("does not exist"),
            "stderr: {}",
            err(&output)
        );
        assert!(
            !err(&output).contains("install pdks"),
            "stderr: {}",
            err(&output)
        );
        assert!(!sandbox.record.join("argv").exists());
    }

    #[test]
    fn a_judge_that_outlives_the_deadline_is_killed_and_exits_2() {
        let sandbox = Sandbox::new();
        // `exec` makes the sleeper the process the adapter kills; a shell parent would leave the
        // grandchild holding the stderr pipe open for the full 30 seconds.
        let judge = sandbox.script("sleeper", "exec sleep 30");
        let started = Instant::now();
        let output = sandbox.hook(&judge, &sandbox.payload());
        // Catches: no deadline (the hook hangs until the host timeout), a deadline that exits 0,
        // or a missing reason on stderr.
        assert!(started.elapsed() < Duration::from_secs(20));
        assert_eq!(output.status.code(), Some(2), "stderr: {}", err(&output));
        assert!(
            err(&output).contains("process communication deadline timed out"),
            "stderr: {}",
            err(&output)
        );
        assert_eq!(out(&output), "");
        assert!(!sandbox.root.join(".polydeukes/roi.log").exists());
    }
}

mod judge_invocation {
    use super::*;

    #[test]
    fn the_judge_runs_covenant_check_in_block_mode_from_the_project_root() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 0");
        let output = sandbox.hook(&judge, &sandbox.payload());
        // Catches: a missing `--enforce block` (the judge would only advise), an extra argument
        // on an ordinary payload (`--input-failure` leaking in), or a child that inherits the
        // adapter's cwd instead of the project root the config is read from.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(sandbox.recorded("argv"), BASE_ARGV);
        assert_eq!(
            sandbox.recorded("cwd").trim_end(),
            sandbox.root.to_string_lossy()
        );
    }

    #[test]
    fn the_judge_receives_the_translated_call_and_the_tool_lists_on_stdin() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 0");
        sandbox.hook(&judge, &sandbox.payload());
        let ir: Value =
            serde_json::from_str(&sandbox.recorded("stdin")).expect("stdin is one JSON document");
        // Catches: forwarding the raw payload instead of the IR, a call translated under the
        // wrong name, or a mutating-tool list that drops a member (that tool would go unjudged).
        assert_eq!(ir["toolCalls"][0]["name"], json!("Write"));
        assert_eq!(ir["tools"]["mutating"], json!(MUTATING));
    }

    #[test]
    fn a_payload_that_is_not_json_goes_to_the_judge_as_an_input_failure() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 0");
        let output = sandbox.hook(&judge, "not json");
        // Catches: answering a translation failure inside the adapter, which leaves no
        // `blocked covenant-check` row, or putting the flag anywhere but last.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(
            sandbox.recorded("argv"),
            format!("{BASE_ARGV}--input-failure\n")
        );
        let failure: Value =
            serde_json::from_str(&sandbox.recorded("stdin")).expect("stdin is one JSON document");
        assert!(
            failure["reason"].as_str().is_some_and(|r| !r.is_empty()),
            "stdin: {failure}"
        );
    }
}

mod judge_answer {
    use super::*;

    #[test]
    fn a_judge_exit_2_relays_its_stderr_and_exits_2() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("printf 'blocked: x\\n' >&2\nexit 2");
        let output = sandbox.hook(&judge, &sandbox.payload());
        // Catches: swallowing the reason the host shows the agent, or decorating it.
        assert_eq!(output.status.code(), Some(2));
        assert_eq!(err(&output).trim_end(), "blocked: x");
        assert_eq!(out(&output), "");
    }

    #[test]
    fn any_judge_status_other_than_0_and_2_is_a_block_naming_the_status() {
        for status in [1, 3, 255] {
            let sandbox = Sandbox::new();
            let judge = sandbox.judge(&format!("exit {status}"));
            let output = sandbox.hook(&judge, &sandbox.payload());
            // Catches: treating "not 2" as allow (a judge that crashed with 1, or the fail-closed
            // status 3, would let the call through), or dropping the status from the reason.
            assert_eq!(output.status.code(), Some(2), "status: {status}");
            assert!(
                err(&output).contains(&format!("judge returned unexpected status {status}")),
                "stderr: {}",
                err(&output)
            );
        }
    }

    #[test]
    fn a_judge_killed_by_a_signal_is_a_block() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("printf 'last words\\n' >&2\nkill -9 $$");
        let output = sandbox.hook(&judge, &sandbox.payload());
        // Catches: reading a missing exit code (signal death) as success, or a reason that omits
        // the signal number or the judge's own stderr.
        assert_eq!(output.status.code(), Some(2), "stderr: {}", err(&output));
        assert!(
            err(&output).contains("signal 9"),
            "stderr: {}",
            err(&output)
        );
        assert!(
            err(&output).contains("last words"),
            "stderr: {}",
            err(&output)
        );
    }

    #[test]
    fn the_judge_stdout_never_reaches_the_host() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("printf 'noise\\n'\nexit 0");
        let output = sandbox.hook(&judge, &sandbox.payload());
        // Catches: forwarding judge stdout, which the host would parse as a hook response.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(out(&output), "");
    }
}

mod payload_extremes {
    use super::*;

    const LARGE: usize = 200_000;

    fn write_payload(root: &Path, content: &str) -> String {
        json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "tool_input": {"file_path": "a.txt", "content": content},
            "cwd": root,
        })
        .to_string()
    }

    #[test]
    fn a_large_ir_reaches_a_reading_judge_whole_without_blocking() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 0");
        let payload = write_payload(&sandbox.root, &"~".repeat(LARGE));
        let started = Instant::now();
        let output = sandbox.hook(&judge, &payload);
        // `~` is a content character the temp path and the IR keys do not contain, so the count
        // measures the file content alone.
        // Catches: writing the judge's stdin and waiting for it before reading its output
        // without a bound (a pipe-buffer deadlock), or truncating the IR at a buffer size.
        assert!(started.elapsed() < Duration::from_secs(8));
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        let stdin = sandbox.recorded("stdin");
        serde_json::from_str::<Value>(&stdin).expect("the IR arrives as one complete document");
        assert!(stdin.matches('~').count() >= LARGE);
    }

    #[test]
    fn a_judge_that_exits_without_reading_a_large_ir_is_still_answered() {
        let sandbox = Sandbox::new();
        let judge = sandbox.script("early", "echo early >&2\nexit 2");
        let output = sandbox.hook(&judge, &write_payload(&sandbox.root, &"~".repeat(LARGE)));
        // Catches: treating the broken pipe from the unread stdin as a panic (exit 101) or as a
        // spawn failure, which replaces the judge's own reason.
        assert_eq!(output.status.code(), Some(2), "stderr: {}", err(&output));
        assert!(err(&output).contains("early"), "stderr: {}", err(&output));
    }
}

mod other_events {
    use super::*;

    #[test]
    fn events_other_than_pre_tool_use_go_to_the_judge_as_an_input_failure() {
        for event in ["UserPromptSubmit", "PostToolUse", "SessionEnd"] {
            let sandbox = Sandbox::new();
            let judge = sandbox.judge("exit 2");
            let payload = json!({
                "hook_event_name": event,
                "tool_name": "Write",
                "tool_input": {"file_path": "a.txt", "content": "x\n"},
                "cwd": sandbox.root,
            })
            .to_string();
            let output = sandbox.hook(&judge, &payload);
            // Catches: translating a post-hoc event as if it were a call about to run (a
            // judged-but-already-executed write), or dropping it silently so a stale 0.20.x
            // registration passes without a `blocked covenant-check` row.
            assert_eq!(output.status.code(), Some(2), "event: {event}");
            assert_eq!(
                sandbox.recorded("argv"),
                format!("{BASE_ARGV}--input-failure\n"),
                "event: {event}"
            );
            let failure: Value = serde_json::from_str(&sandbox.recorded("stdin"))
                .expect("stdin is one JSON document");
            assert!(
                failure["reason"]
                    .as_str()
                    .is_some_and(|r| r.contains("unsupported hook event")),
                "event: {event}, stdin: {failure}"
            );
        }
    }
}

mod usage {
    use super::*;

    #[test]
    fn anything_but_the_two_commands_with_absolute_paths_is_a_usage_error() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 0");
        let root = sandbox.root.to_string_lossy().into_owned();
        let pdks = judge.to_string_lossy().into_owned();
        let cases: Vec<Vec<&str>> = vec![
            vec![],
            vec!["bogus"],
            vec!["hook", "--project-root", &root],
            vec!["hook", "--pdks", &pdks],
            vec!["hook", "--project-root", "relative/root", "--pdks", &pdks],
        ];
        for args in cases {
            let output = sandbox.run(&args, &sandbox.payload());
            // Catches: running the judge with a guessed root or a missing `--pdks`, which would
            // judge against the wrong config, and any exit code other than 2.
            assert_eq!(output.status.code(), Some(2), "args: {args:?}");
            assert!(
                err(&output).starts_with("usage:"),
                "stderr: {}",
                err(&output)
            );
            assert_eq!(out(&output), "");
            assert!(!sandbox.record.join("argv").exists(), "args: {args:?}");
        }
    }
}
