#![cfg(unix)]
#![expect(
    clippy::indexing_slicing,
    reason = "serde_json::Value indexing yields Null for a missing key and the assertions fail loudly"
)]
// Process-level tests of `pdks-codex hook`. The judge is a shell script passed as `--pdks`; it
// records its argv, working directory and stdin in a directory outside the project root, so a
// file left inside the root is always something the adapter wrote.

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const ADAPTER: &str = env!("CARGO_BIN_EXE_pdks-codex");
const SHELL_TOOL: &str = "Bash";
const PATCH_TOOL: &str = "apply_patch";
const BASE_ARGV: &str = "covenant\ncheck\n--enforce\nblock\n";
const SESSION: &str = "s1";

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn digest(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 15])
        .map(|nibble| char::from_digit(u32::from(nibble), 16).expect("a nibble is a hex digit"))
        .collect()
}

fn agent_id_text(session: &str, agent: &str) -> String {
    format!(r#"["{session}","{agent}"]"#)
}

struct Sandbox {
    dir: PathBuf,
    root: PathBuf,
    record: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let raw = std::env::temp_dir().join(format!(
            "pdks-codex-hook-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(raw.join("project")).expect("the project directory is creatable");
        fs::create_dir_all(raw.join("record")).expect("the record directory is creatable");
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

    fn judge_ran(&self) -> bool {
        self.record.join("argv").exists()
    }

    fn ir(&self) -> Value {
        serde_json::from_str(&self.recorded("stdin")).expect("stdin is one JSON document")
    }

    fn evidence_for(&self, id_text: &str) -> PathBuf {
        self.root
            .join(".polydeukes/codex-sessions")
            .join(format!("{}.jsonl", digest(id_text)))
    }

    fn evidence(&self) -> PathBuf {
        self.evidence_for(SESSION)
    }

    fn seed(&self, id_text: &str, contents: &str) {
        let path = self.evidence_for(id_text);
        fs::create_dir_all(path.parent().expect("an evidence file has a parent"))
            .expect("the sessions directory is creatable");
        fs::write(path, contents).expect("the evidence file is writable");
    }

    fn base(&self, event: &str) -> Value {
        json!({"hook_event_name": event, "session_id": SESSION, "cwd": self.root})
    }

    fn post(&self, tool: &str, input: Value) -> Value {
        let mut payload = self.base("PostToolUse");
        payload["tool_name"] = json!(tool);
        payload["tool_input"] = input;
        payload
    }

    fn pre_bash(&self, command: &str) -> Value {
        let mut payload = self.base("PreToolUse");
        payload["tool_name"] = json!(SHELL_TOOL);
        payload["tool_input"] = json!({"command": command});
        payload
    }

    fn pre(&self) -> String {
        self.pre_bash("ls").to_string()
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

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("the directory is readable")
        .map(|entry| {
            entry
                .expect("an entry is readable")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

fn tool_line(command: &str, suffix: &str) -> String {
    format!(r#"{{"kind":"tool","name":"{SHELL_TOOL}","args":{{"command":"{command}"}}{suffix}}}"#)
}

// A judge that exits 2 after recording; a call that wrongly reaches it fails the exit-0 check.
fn assert_recorded_silently(sandbox: &Sandbox, output: &Output) {
    assert_eq!(output.status.code(), Some(0), "stderr: {}", err(output));
    assert_eq!(out(output), "");
    assert_eq!(err(output), "");
    assert!(!sandbox.judge_ran());
}

fn assert_input_failure(sandbox: &Sandbox, output: &Output, status: i32, label: &str) {
    assert_eq!(
        output.status.code(),
        Some(status),
        "{label}: {}",
        err(output)
    );
    assert_eq!(
        sandbox.recorded("argv"),
        format!("{BASE_ARGV}--input-failure\n"),
        "{label}"
    );
    let failure = sandbox.ir();
    assert!(
        failure["reason"].as_str().is_some_and(|r| !r.is_empty()),
        "{label}: stdin {failure}"
    );
}

mod post_tool_use {
    use super::*;

    #[test]
    fn appends_one_tool_line_under_the_hashed_session_name_and_stays_silent() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 2");
        let id = "../../host/session:one";
        let mut payload = sandbox.post(SHELL_TOOL, json!({"command": "pwd"}));
        payload["session_id"] = json!(id);
        payload["tool_response"] = json!({"output": "not recorded"});
        let output = sandbox.hook(&judge, &payload.to_string());
        // Catches: a raw session id as the file name (path traversal out of the sessions
        // directory), a stray key such as the tool response in the line, a judge spawned for an
        // observe-only event, output the host would read as a response, or any other file under
        // `.polydeukes`.
        assert_recorded_silently(&sandbox, &output);
        assert_eq!(
            fs::read_to_string(sandbox.evidence_for(id)).expect("the evidence file exists"),
            format!("{}\n", tool_line("pwd", ""))
        );
        assert_eq!(
            names(&sandbox.root.join(".polydeukes")),
            vec!["codex-sessions".to_owned()]
        );
        assert_eq!(
            names(&sandbox.root.join(".polydeukes/codex-sessions")),
            vec![format!("{}.jsonl", digest(id))]
        );
    }

    #[test]
    fn succeeded_is_recorded_only_when_success_is_a_boolean() {
        let cases = [
            (Some(json!(true)), r#","succeeded":true"#),
            (Some(json!(false)), r#","succeeded":false"#),
            (Some(json!("yes")), ""),
            (Some(json!(1)), ""),
            (Some(json!(null)), ""),
            (None, ""),
        ];
        for (success, suffix) in cases {
            let sandbox = Sandbox::new();
            let judge = sandbox.judge("exit 2");
            let mut payload = sandbox.post(SHELL_TOOL, json!({"command": "pwd"}));
            if let Some(value) = &success {
                payload["success"] = value.clone();
            }
            let output = sandbox.hook(&judge, &payload.to_string());
            // Catches: inventing success for an absent flag, coercing a truthy non-boolean into
            // `true`, or dropping a real `false` (a failed call recorded as a clean precedent).
            assert_eq!(output.status.code(), Some(0), "success: {success:?}");
            assert_eq!(
                fs::read_to_string(sandbox.evidence()).expect("the evidence file exists"),
                format!("{}\n", tool_line("pwd", suffix)),
                "success: {success:?}"
            );
        }
    }

    #[test]
    fn two_events_append_in_order_without_touching_the_first_line() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 2");
        sandbox.hook(
            &judge,
            &sandbox
                .post(SHELL_TOOL, json!({"command": "pwd"}))
                .to_string(),
        );
        sandbox.hook(
            &judge,
            &sandbox
                .post(PATCH_TOOL, json!({"command": "patch"}))
                .to_string(),
        );
        // Catches: truncating the file on each event (history lost), or prepending.
        let second =
            format!(r#"{{"kind":"tool","name":"{PATCH_TOOL}","args":{{"command":"patch"}}}}"#);
        assert_eq!(
            fs::read_to_string(sandbox.evidence()).expect("the evidence file exists"),
            format!("{}\n{second}\n", tool_line("pwd", ""))
        );
    }

    #[test]
    fn an_agent_event_writes_to_the_hash_of_the_session_and_agent_pair() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 2");
        let mut payload = sandbox.post(SHELL_TOOL, json!({"command": "pwd"}));
        payload["agent_id"] = json!("a1");
        let output = sandbox.hook(&judge, &payload.to_string());
        // Catches: ignoring `agent_id` (a subagent's calls land in its parent's history), or
        // hashing the two ids in a different text form than the JSON array.
        assert_recorded_silently(&sandbox, &output);
        assert_eq!(
            fs::read_to_string(sandbox.evidence_for(&agent_id_text(SESSION, "a1")))
                .expect("the agent evidence file exists"),
            format!("{}\n", tool_line("pwd", ""))
        );
        assert!(!sandbox.evidence().exists());
    }

    #[test]
    fn a_tool_input_that_is_not_an_object_adds_no_line_and_goes_to_the_judge_as_a_failure() {
        for input in [json!("opaque"), json!([1]), json!(null), json!(7)] {
            let sandbox = Sandbox::new();
            let judge = sandbox.judge("printf 'blocked: x\\n' >&2\nexit 2");
            let output = sandbox.hook(&judge, &sandbox.post(PATCH_TOOL, input.clone()).to_string());
            // Catches: recording an invented argument object, dropping the event without a
            // `blocked covenant-check` row, or answering inside the adapter instead of by the
            // judge's status.
            assert_input_failure(&sandbox, &output, 2, &format!("input: {input}"));
            assert_eq!(err(&output).trim_end(), "blocked: x");
            assert!(!sandbox.evidence().exists(), "input: {input}");
        }
    }

    #[test]
    fn a_missing_or_non_string_tool_name_is_a_failure_with_no_line() {
        for name in [None, Some(json!(7))] {
            let sandbox = Sandbox::new();
            let judge = sandbox.judge("exit 0");
            let mut payload = sandbox.post(SHELL_TOOL, json!({"command": "pwd"}));
            match &name {
                Some(value) => payload["tool_name"] = value.clone(),
                None => {
                    payload
                        .as_object_mut()
                        .expect("the payload is an object")
                        .remove("tool_name");
                }
            }
            let output = sandbox.hook(&judge, &payload.to_string());
            // Catches: writing a line with an empty or stringified name.
            assert_input_failure(&sandbox, &output, 0, &format!("name: {name:?}"));
            assert!(!sandbox.evidence().exists(), "name: {name:?}");
        }
    }

    #[test]
    fn a_corrupt_existing_file_is_a_failure_and_is_not_appended_to() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 2");
        sandbox.seed(SESSION, "{not-json}\n");
        let output = sandbox.hook(
            &judge,
            &sandbox
                .post(SHELL_TOOL, json!({"command": "pwd"}))
                .to_string(),
        );
        // Catches: appending to a file the next reader will reject (burying the corruption), or
        // repairing it silently.
        assert_input_failure(&sandbox, &output, 2, "corrupt file");
        assert_eq!(
            fs::read_to_string(sandbox.evidence()).expect("the evidence file exists"),
            "{not-json}\n"
        );
    }
}

mod session_end {
    use super::*;

    #[test]
    fn removes_only_its_own_session_file() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 2");
        let line = format!("{}\n", tool_line("pwd", ""));
        sandbox.seed(SESSION, &line);
        sandbox.seed("s2", &line);
        let output = sandbox.hook(&judge, &sandbox.base("SessionEnd").to_string());
        // Catches: clearing the whole sessions directory (every other live session loses its
        // history), leaving the file behind, or spawning the judge for a cleanup event.
        assert_recorded_silently(&sandbox, &output);
        assert!(!sandbox.evidence().exists());
        assert!(sandbox.evidence_for("s2").exists());
    }

    #[test]
    fn an_agent_session_end_removes_the_agent_file_and_keeps_the_parent_file() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 2");
        let line = format!("{}\n", tool_line("pwd", ""));
        sandbox.seed(SESSION, &line);
        sandbox.seed(&agent_id_text(SESSION, "a1"), &line);
        let mut payload = sandbox.base("SessionEnd");
        payload["agent_id"] = json!("a1");
        let output = sandbox.hook(&judge, &payload.to_string());
        // Catches: deleting by session id alone, so a subagent ending erases its parent's
        // history, and leaving its own file behind.
        assert_recorded_silently(&sandbox, &output);
        assert!(sandbox.evidence().exists());
        assert!(!sandbox.evidence_for(&agent_id_text(SESSION, "a1")).exists());
    }
}

mod identity_keys {
    use super::*;

    #[test]
    fn a_missing_or_invalid_session_or_agent_id_is_a_failure_that_writes_nothing() {
        let mutations: Vec<(&str, Option<Value>)> = vec![
            ("session_id", None),
            ("session_id", Some(json!(""))),
            ("session_id", Some(json!(5))),
            ("agent_id", Some(json!(""))),
            ("agent_id", Some(json!(7))),
        ];
        for event in ["PostToolUse", "SessionEnd"] {
            for (key, value) in &mutations {
                let sandbox = Sandbox::new();
                let judge = sandbox.judge("exit 0");
                let mut payload = sandbox.post(SHELL_TOOL, json!({"command": "pwd"}));
                payload["hook_event_name"] = json!(event);
                match value {
                    Some(value) => payload[*key] = value.clone(),
                    None => {
                        payload
                            .as_object_mut()
                            .expect("the payload is an object")
                            .remove(*key);
                    }
                }
                let output = sandbox.hook(&judge, &payload.to_string());
                // Catches: hashing an empty or stringified id (every anonymous call shares one
                // file), or accepting a present-but-empty `agent_id` as no agent.
                let label = format!("{event} {key}={value:?}");
                assert_input_failure(&sandbox, &output, 0, &label);
                assert!(
                    !sandbox.root.join(".polydeukes").exists(),
                    "{label}: the failure wrote under .polydeukes"
                );
            }
        }
    }
}

mod pre_tool_use {
    use super::*;

    #[test]
    fn the_judge_receives_the_bash_call_with_empty_user_messages_and_the_tool_lists() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 0");
        sandbox.hook(&judge, &sandbox.pre());
        let ir = sandbox.ir();
        // Catches: forwarding the raw payload, a call translated under the wrong name, a cwd that
        // is absolute instead of root-relative, user messages carried from the prompt, or a
        // tool list that drops a member (that tool would go unjudged).
        assert_eq!(ir["toolCalls"].as_array().map(Vec::len), Some(1));
        assert_eq!(ir["toolCalls"][0]["name"], json!(SHELL_TOOL));
        assert_eq!(ir["toolCalls"][0]["args"], json!({"command": "ls"}));
        assert_eq!(ir["toolCalls"][0]["cwd"], json!("."));
        assert_eq!(ir["userMessages"], json!([]));
        assert_eq!(ir["session"]["userMessages"], json!([]));
        assert_eq!(ir["subagentSpawns"], json!([]));
        assert_eq!(
            ir["tools"],
            json!({"mutating": [PATCH_TOOL], "shell": [SHELL_TOOL], "commandArgs": ["command"]})
        );
    }

    #[test]
    fn the_session_history_a_post_tool_use_wrote_reaches_the_judge_with_the_file_path() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("exit 0");
        sandbox.hook(
            &judge,
            &sandbox
                .post(SHELL_TOOL, json!({"command": "pwd"}))
                .to_string(),
        );
        sandbox.hook(&judge, &sandbox.pre());
        let ir = sandbox.ir();
        // Catches: a writer and a reader that disagree on the file name, a history that never
        // reaches the IR, and an evidence path that is not the file itself.
        assert_eq!(
            ir["session"]["toolCalls"],
            json!([{"name": SHELL_TOOL, "args": {"command": "pwd"}}])
        );
        assert_eq!(
            ir["session"]["evidencePath"],
            json!(sandbox.evidence().to_string_lossy())
        );
        assert_eq!(ir["session"]["userMessages"], json!([]));
    }

    #[test]
    fn events_other_than_the_three_supported_go_to_the_judge_as_an_input_failure() {
        for event in [Some("UserPromptSubmit"), Some("Stop"), None] {
            let sandbox = Sandbox::new();
            let judge = sandbox.judge("exit 2");
            let mut payload = sandbox.pre_bash("ls");
            if let Some(name) = event {
                payload["hook_event_name"] = json!(name);
            } else {
                payload
                    .as_object_mut()
                    .expect("the payload is an object")
                    .remove("hook_event_name");
                payload["hookEventName"] = json!("PreToolUse");
            }
            let output = sandbox.hook(&judge, &payload.to_string());
            // Catches: the prompt event passing silently (a stale registration left unjudged),
            // a camelCase event name read as the event, or an unknown event translated as a call.
            assert_input_failure(&sandbox, &output, 2, &format!("event: {event:?}"));
            assert!(
                sandbox.ir()["reason"]
                    .as_str()
                    .is_some_and(|r| r.contains("unsupported hook event")),
                "event: {event:?}, stdin: {}",
                sandbox.ir()
            );
        }
    }
}

mod judge_cannot_run {
    use super::*;

    #[test]
    fn a_judge_that_does_not_exist_lets_the_call_proceed_and_says_to_install_pdks() {
        let sandbox = Sandbox::new();
        let output = sandbox.hook(&sandbox.dir.join("no-such-pdks"), &sandbox.pre());
        // An adapter left behind after pdks was removed must not stop every edit and shell call.
        // Catches: blocking the call, proceeding without telling the user why nothing was
        // judged, a hint that omits the re-init command, or writing a telemetry row the judge
        // never produced.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert!(
            err(&output).contains("install pdks"),
            "stderr: {}",
            err(&output)
        );
        assert!(
            err(&output).contains("pdks codex init"),
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
            &sandbox.pre(),
        );
        // Catches: reporting a project that was moved after init as a missing judge, blocking the
        // call, starting the judge anyway, or a message that does not name the root.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert!(err(&output).contains(&root), "stderr: {}", err(&output));
        assert!(
            err(&output).contains("pdks codex init"),
            "stderr: {}",
            err(&output)
        );
        assert!(
            !err(&output).contains("install pdks"),
            "stderr: {}",
            err(&output)
        );
        assert!(!sandbox.judge_ran());
    }

    #[test]
    fn a_judge_that_outlives_the_deadline_is_killed_and_exits_2() {
        let sandbox = Sandbox::new();
        // `exec` makes the sleeper the process the adapter kills; a shell parent would leave the
        // grandchild holding the stderr pipe open for the full 30 seconds.
        let judge = sandbox.script("sleeper", "exec sleep 30");
        let started = Instant::now();
        let output = sandbox.hook(&judge, &sandbox.pre());
        // Catches: no deadline (the hook hangs until the host timeout), a deadline that exits 0,
        // or a missing reason on stderr.
        assert!(started.elapsed() < Duration::from_secs(15));
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
        let output = sandbox.hook(&judge, &sandbox.pre());
        // Catches: a missing `--enforce block` (the judge would only advise), an extra argument
        // on an ordinary payload, or a child that inherits the adapter's cwd instead of the
        // project root the config is read from.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(sandbox.recorded("argv"), BASE_ARGV);
        assert_eq!(
            sandbox.recorded("cwd").trim_end(),
            sandbox.root.to_string_lossy()
        );
    }
}

mod judge_answer {
    use super::*;

    #[test]
    fn a_judge_exit_0_relays_its_stderr_and_keeps_its_stdout_from_the_host() {
        let sandbox = Sandbox::new();
        let judge = sandbox.judge("printf 'advice: x\\n' >&2\nprintf 'noise\\n'\nexit 0");
        let output = sandbox.hook(&judge, &sandbox.pre());
        // Catches: swallowing an advisory the agent should see, or forwarding judge stdout,
        // which the host would parse as a hook response.
        assert_eq!(output.status.code(), Some(0));
        assert_eq!(err(&output).trim_end(), "advice: x");
        assert_eq!(out(&output), "");
    }

    #[test]
    fn any_judge_status_other_than_0_and_2_is_a_block_naming_the_status() {
        for status in [1, 3, 255] {
            let sandbox = Sandbox::new();
            let judge = sandbox.judge(&format!("exit {status}"));
            let output = sandbox.hook(&judge, &sandbox.pre());
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
}

mod missing_project_root {
    use super::*;

    #[test]
    fn post_tool_use_and_session_end_proceed_and_do_not_recreate_the_root() {
        for event in ["PostToolUse", "SessionEnd"] {
            let sandbox = Sandbox::new();
            let judge = sandbox.judge("exit 2");
            let missing = sandbox.dir.join("moved-away");
            let root = missing.to_string_lossy().into_owned();
            let pdks = judge.to_string_lossy().into_owned();
            let mut payload = sandbox.post(SHELL_TOOL, json!({"command": "pwd"}));
            payload["hook_event_name"] = json!(event);
            let output = sandbox.run(
                &["hook", "--project-root", &root, "--pdks", &pdks],
                &payload.to_string(),
            );
            // Catches: an evidence write that recreates `.polydeukes/codex-sessions` under a root
            // that no longer exists, leaving a config-less directory the judge then blocks in.
            assert_eq!(
                output.status.code(),
                Some(0),
                "{event}: stderr: {}",
                err(&output)
            );
            assert!(err(&output).contains(&root), "{event}: {}", err(&output));
            assert!(!missing.exists(), "{event}: the root was recreated");
            assert!(!sandbox.judge_ran(), "{event}");
        }
    }
}

mod apply_patch_translation {
    use super::*;

    fn pre_patch(sandbox: &Sandbox, patch: &str) -> String {
        let mut payload = sandbox.base("PreToolUse");
        payload["tool_name"] = json!(PATCH_TOOL);
        payload["tool_input"] = json!({"command": patch});
        payload.to_string()
    }

    #[test]
    fn an_end_of_file_marker_closes_the_block_it_follows() {
        let sandbox = Sandbox::new();
        fs::write(sandbox.root.join("a.txt"), "x\ny\n").expect("the file is writable");
        let judge = sandbox.judge("exit 0");
        let patch = "*** Begin Patch\n*** Update File: a.txt\n@@\n x\n-y\n+Y\n*** End of File\n*** End Patch";
        let output = sandbox.hook(&judge, &pre_patch(&sandbox, patch));
        // Catches: the closing marker read as a stray line, which fails a patch Codex applies.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(sandbox.recorded("argv"), BASE_ARGV);
        assert_eq!(
            sandbox.ir()["toolCalls"][0]["fileChange"],
            json!({"kind": "modify", "path": "a.txt", "pre": "x\ny\n", "post": "x\nY\n"})
        );
    }

    #[test]
    fn a_delete_section_with_a_body_line_is_an_input_failure() {
        let sandbox = Sandbox::new();
        fs::write(sandbox.root.join("a.txt"), "a\n").expect("the file is writable");
        fs::write(sandbox.root.join("prot.txt"), "p\n").expect("the file is writable");
        let judge = sandbox.judge("exit 2");
        let patch =
            "*** Begin Patch\n*** Delete File: a.txt\n *** Delete File: prot.txt\n*** End Patch";
        let output = sandbox.hook(&judge, &pre_patch(&sandbox, patch));
        // Catches: an indented line filed as the body of a Delete section and dropped, although
        // Codex reads it as a second header and deletes that file too.
        assert_input_failure(&sandbox, &output, 2, "delete with body");
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
            vec!["hook", "--project-root", &root, "--pdks", "relative/pdks"],
        ];
        for args in cases {
            let output = sandbox.run(&args, &sandbox.pre());
            // Catches: running the judge with a guessed root or a missing `--pdks`, which would
            // judge against the wrong config, and any exit code other than 2.
            assert_eq!(output.status.code(), Some(2), "args: {args:?}");
            assert!(
                err(&output).starts_with("usage:"),
                "stderr: {}",
                err(&output)
            );
            assert_eq!(out(&output), "");
            assert!(!sandbox.judge_ran(), "args: {args:?}");
        }
    }
}
