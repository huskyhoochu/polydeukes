//! `hook`: translate the payload on stdin, have the judge decide, and answer the host.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command, ExitCode, ExitStatus, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::translate::translate;

const DEADLINE: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(5);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Input {
    Translated,
    Failure,
}

struct Answer {
    allowed: bool,
    stderr: String,
}

impl Answer {
    fn blocked(reason: impl Into<String>) -> Self {
        Self {
            allowed: false,
            stderr: reason.into(),
        }
    }
}

pub fn run(root: &Path, pdks: &Path) -> ExitCode {
    // Under the Grok runtime the Grok registration owns the judgment.
    if std::env::var_os("GROK_WORKSPACE_ROOT").is_some_and(|value| !value.is_empty()) {
        return ExitCode::SUCCESS;
    }
    let mut raw = Vec::new();
    let translated = match std::io::stdin().lock().read_to_end(&mut raw) {
        Ok(_) => translate(&raw, root),
        Err(error) => Err(format!("cannot read stdin: {error}")),
    };
    let (input, document) = match translated {
        Ok(ir) => (Input::Translated, ir.to_string()),
        Err(reason) => (Input::Failure, json!({ "reason": reason }).to_string()),
    };
    let answer = judge(pdks, root, &document, input);
    if !answer.stderr.is_empty() {
        eprintln!("{}", answer.stderr);
    }
    if answer.allowed {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(2)
    }
}

/// Run the judge on one input document. A judge that cannot start lets the call proceed; one that
/// started allows the call only by exiting 0.
fn judge(pdks: &Path, root: &Path, document: &str, input: Input) -> Answer {
    if !root.is_dir() {
        return Answer {
            allowed: true,
            stderr: format!(
                "pdks-claude-code: project root {} does not exist; this call was not judged; run `pdks claude-code init` in the project again",
                root.display()
            ),
        };
    }
    let mut command = Command::new(pdks);
    command.args(["covenant", "check", "--enforce", "block"]);
    if input == Input::Failure {
        command.arg("--input-failure");
    }
    let mut child = match command
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        // Without the judge nothing can be decided, so the call proceeds and the user is told.
        Err(error) => {
            return Answer {
                allowed: true,
                stderr: format!(
                    "pdks-claude-code: cannot start {}: {error}; this call was not judged; install pdks, then run `pdks claude-code init` again",
                    pdks.display()
                ),
            };
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        // A judge that exits before reading closes the pipe; its status still decides.
        stdin.write_all(document.as_bytes()).ok();
    }
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < DEADLINE => sleep(POLL),
            Ok(None) => return stop(child, "process communication deadline timed out"),
            Err(error) => return stop(child, &error.to_string()),
        }
    };
    let mut stderr = Vec::new();
    if let Some(mut pipe) = child.stderr.take() {
        pipe.read_to_end(&mut stderr).ok();
    }
    let stderr = String::from_utf8_lossy(&stderr).trim_end().to_owned();
    match status.code() {
        Some(0) => Answer {
            allowed: true,
            stderr,
        },
        Some(2) => Answer::blocked(stderr),
        Some(code) if stderr.is_empty() => {
            Answer::blocked(format!("judge returned unexpected status {code}"))
        }
        Some(_) => Answer::blocked(stderr),
        None => {
            let reason = signal_reason(status);
            Answer::blocked(if stderr.trim().is_empty() {
                reason
            } else {
                format!("{reason}\n{}", stderr.trim())
            })
        }
    }
}

#[cfg(unix)]
fn signal_reason(status: ExitStatus) -> String {
    use std::os::unix::process::ExitStatusExt;
    match status.signal() {
        Some(number) => format!("process terminated by signal {number}"),
        None => "process terminated by signal".to_owned(),
    }
}

#[cfg(not(unix))]
fn signal_reason(_status: ExitStatus) -> String {
    "process terminated by signal".to_owned()
}

fn stop(mut child: Child, reason: &str) -> Answer {
    child.kill().ok();
    child.wait().ok();
    Answer::blocked(reason)
}
