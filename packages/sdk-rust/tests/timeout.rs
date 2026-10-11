//! A spec's `timeout` is the deadline the spawn enforces on the child, measured from the
//! spawn. Past it the default spawn kills and reaps the child and answers `TimedOut`; a
//! covenant verb turns that into `Unjudged`, a memory verb into `Unavailable`, each naming
//! the deadline. A caller's spawn receives the same deadline on `SpawnSpec.timeout`.
//! `None` waits for the child as before.

use std::cell::RefCell;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use polydeukes_sdk::{
    CheckChangeSetSpec, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput,
    MemoryIngestOutcome, MemoryIngestSpec, MemorySearchOutcome, MemorySearchSpec, SpawnOutcome,
    SpawnSpec, check_change_set, check_covenant, memory_ingest, memory_search,
};
use tempfile::TempDir;

/// Injected fixture value — the query the fake CLI is asked.
const QUERY: &str = "hook block";
const EMPTY_OUTPUT: &str = "{\"ingestedAt\":\"2026-10-10T14:00:00.000Z\",\"results\":[]}";
const DIFF: &str = "diff --git a/src/answer.ts b/src/answer.ts\n--- a/src/answer.ts\n+++ b/src/answer.ts\n@@ -1 +1 @@\n-export const answer = 41;\n+export const answer = 42;\n";
/// An executable path with no file behind it; the seam never runs it.
const EXECUTABLE_NAME: &str = "pdks-single";
/// The deadline the never-ending child is given.
const SHORT: Duration = Duration::from_millis(200);
/// A deadline a child that exits at once never reaches.
const GENEROUS: Duration = Duration::from_secs(10);
/// The whole verb, including the kill and the reap, must come back well inside this.
const RETURN_BOUND: Duration = Duration::from_secs(5);

fn fixture_dir(prefix: &str) -> (TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix(prefix)
        .tempdir()
        .expect("tempdir");
    let path = dir.path().canonicalize().expect("canonical tempdir");
    (dir, path)
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

/// A caller's spawn that enforced the deadline itself and reports it the way the default
/// spawn does.
fn timed_out(_spec: SpawnSpec) -> io::Result<SpawnOutcome> {
    Err(io::Error::from(io::ErrorKind::TimedOut))
}

/// Every verb once with `timeout` through `spawn`; returns the four outcomes as reasons in
/// verb order: check_covenant, check_change_set, memory_ingest, memory_search. A verb that
/// did not answer `Unjudged` / `Unavailable` panics with what it answered.
fn reasons_of_every_verb(
    root: &Path,
    timeout: Option<Duration>,
    spawn: &dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>,
) -> Vec<String> {
    let executable = root.join(EXECUTABLE_NAME);
    let input = empty_input();
    vec![
        unjudged(check_covenant(CheckCovenantSpec {
            repo_root: root,
            input: &input,
            enforce: None,
            config_layer: None,
            telemetry_path: None,
            executable: Some(&executable),
            timeout,
            spawn: Some(spawn),
        })),
        unjudged(check_change_set(CheckChangeSetSpec {
            repo_root: root,
            diff: DIFF,
            enforce: None,
            config_layer: None,
            telemetry_path: None,
            executable: Some(&executable),
            timeout,
            spawn: Some(spawn),
        })),
        ingest_unavailable(memory_ingest(MemoryIngestSpec {
            root,
            executable: Some(&executable),
            timeout,
            spawn: Some(spawn),
        })),
        unavailable(memory_search(MemorySearchSpec {
            root,
            query: QUERY,
            limit: None,
            executable: Some(&executable),
            timeout,
            spawn: Some(spawn),
        })),
    ]
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

fn ingest_unavailable(outcome: MemoryIngestOutcome) -> String {
    match outcome {
        MemoryIngestOutcome::Unavailable { reason } => reason,
        MemoryIngestOutcome::Ingested => panic!("expected unavailable, got ingested"),
    }
}

#[test]
fn every_verb_hands_its_spawn_the_deadline_it_was_given() {
    // A verb that builds `SpawnSpec` with `timeout: None` compiles and passes every other
    // test while a caller's spawn can never see the deadline it was asked to enforce.
    let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");
    let seam = RecordingSeam::new();
    let spawn = |s| seam.spawn(s);
    let executable = root.join(EXECUTABLE_NAME);
    let input = empty_input();

    check_covenant(CheckCovenantSpec {
        repo_root: &root,
        input: &input,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: Some(&executable),
        timeout: Some(SHORT),
        spawn: Some(&spawn),
    });
    check_change_set(CheckChangeSetSpec {
        repo_root: &root,
        diff: DIFF,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: Some(&executable),
        timeout: Some(SHORT),
        spawn: Some(&spawn),
    });
    memory_ingest(MemoryIngestSpec {
        root: &root,
        executable: Some(&executable),
        timeout: Some(SHORT),
        spawn: Some(&spawn),
    });
    memory_search(MemorySearchSpec {
        root: &root,
        query: QUERY,
        limit: None,
        executable: Some(&executable),
        timeout: Some(SHORT),
        spawn: Some(&spawn),
    });

    let calls = seam.calls.into_inner();
    assert_eq!(calls.len(), 4);
    for call in &calls {
        assert_eq!(call.timeout, Some(SHORT));
    }
}

#[test]
fn a_spawn_without_a_deadline_is_handed_none() {
    // A crate that fills a deadline of its own when the spec has none turns every existing
    // caller's unbounded wait into a bounded one without their asking.
    let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");
    let seam = RecordingSeam::new();
    let spawn = |s| seam.spawn(s);
    let executable = root.join(EXECUTABLE_NAME);
    let input = empty_input();

    check_covenant(CheckCovenantSpec {
        repo_root: &root,
        input: &input,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: Some(&executable),
        timeout: None,
        spawn: Some(&spawn),
    });
    check_change_set(CheckChangeSetSpec {
        repo_root: &root,
        diff: DIFF,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: Some(&executable),
        timeout: None,
        spawn: Some(&spawn),
    });
    memory_ingest(MemoryIngestSpec {
        root: &root,
        executable: Some(&executable),
        timeout: None,
        spawn: Some(&spawn),
    });
    memory_search(MemorySearchSpec {
        root: &root,
        query: QUERY,
        limit: None,
        executable: Some(&executable),
        timeout: None,
        spawn: Some(&spawn),
    });

    let calls = seam.calls.into_inner();
    assert_eq!(calls.len(), 4);
    for call in &calls {
        assert_eq!(call.timeout, None);
    }
}

#[test]
fn a_timed_out_spawn_under_a_deadline_names_the_deadline_in_every_verb() {
    // The spawn-failure branch each verb already has would read `TimedOut` as "could not be
    // spawned"; the caller then cannot tell a missing bin from a judge that hung.
    let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");

    let reasons = reasons_of_every_verb(&root, Some(SHORT), &timed_out);

    assert_eq!(
        reasons,
        vec![
            format!("the judge did not answer within {SHORT:?}"),
            format!("the judge did not answer within {SHORT:?}"),
            format!("pdks memory did not answer within {SHORT:?}"),
            format!("pdks memory did not answer within {SHORT:?}"),
        ]
    );
}

#[test]
fn a_timed_out_spawn_with_no_deadline_keeps_the_spawn_failure_reason() {
    // Without a deadline there is nothing to name; a verb that matches on the error kind
    // alone would print "within None".
    let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");

    let reasons = reasons_of_every_verb(&root, None, &timed_out);

    assert!(
        reasons[0].starts_with("the judge could not be spawned: "),
        "covenant reason: {}",
        reasons[0]
    );
    assert!(
        reasons[1].starts_with("the judge could not be spawned: "),
        "change-set reason: {}",
        reasons[1]
    );
    assert!(
        reasons[2].starts_with("pdks memory could not be spawned: "),
        "ingest reason: {}",
        reasons[2]
    );
    assert!(
        reasons[3].starts_with("pdks memory could not be spawned: "),
        "search reason: {}",
        reasons[3]
    );
}

#[cfg(unix)]
mod default_spawn {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;
    use std::thread;
    use std::time::Instant;

    /// An executable `sh` script at `dir/name` with `body` after the shebang.
    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("script");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod");
        path
    }

    /// A script that records its own PID in `pid_file` and then becomes a `sleep` with that
    /// PID — `exec` keeps the recorded PID and the sleeping process the same one.
    fn never_ending(dir: &Path, pid_file: &Path) -> PathBuf {
        script(
            dir,
            "pdks-hang",
            &format!("echo $$ > '{}'\nexec sleep 30", pid_file.display()),
        )
    }

    /// Long enough for the shell to record its PID before the kill, short enough that a
    /// spawn ignoring it is caught by `RETURN_BOUND`.
    const HANG_DEADLINE: Duration = Duration::from_secs(1);

    fn pid_recorded_in(pid_file: &Path) -> String {
        fs::read_to_string(pid_file)
            .expect("pid file")
            .trim()
            .to_string()
    }

    /// `kill -0` answers success only while a process with that PID exists.
    fn is_alive(pid: &str) -> bool {
        Command::new("kill")
            .args(["-0", pid])
            .status()
            .expect("kill -0")
            .success()
    }

    /// The child is reaped before the verb returns, so this is already false on the first
    /// probe; the retries only absorb a scheduler that is slow to tear the entry down.
    fn assert_gone(pid: &str) {
        let until = Instant::now() + Duration::from_secs(1);
        while is_alive(pid) {
            assert!(
                Instant::now() < until,
                "process {pid} is still alive after the deadline"
            );
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn check_covenant_kills_a_judge_that_outlives_its_deadline_and_reports_the_deadline() {
        // A spawn that only stops waiting leaves the `sleep` running for its full 30s, and a
        // spawn that never looks at the deadline returns only after it. Both pass a
        // `Unjudged`-shaped assertion with no clock and no PID check.
        let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");
        let pid_file = root.join("child.pid");
        let executable = never_ending(&root, &pid_file);
        let input = empty_input();

        let started = Instant::now();
        let reason = unjudged(check_covenant(CheckCovenantSpec {
            repo_root: &root,
            input: &input,
            enforce: None,
            config_layer: None,
            telemetry_path: None,
            executable: Some(&executable),
            timeout: Some(HANG_DEADLINE),
            spawn: None,
        }));
        let elapsed = started.elapsed();

        assert_eq!(
            reason,
            format!("the judge did not answer within {HANG_DEADLINE:?}")
        );
        assert!(elapsed < RETURN_BOUND, "returned after {elapsed:?}");
        assert_gone(&pid_recorded_in(&pid_file));
    }

    #[test]
    fn memory_search_kills_a_cli_that_outlives_its_deadline_and_reports_the_deadline() {
        // Same contract on the memory side; the reason head differs, and a crate that threads
        // the deadline through one runner but not the other passes the covenant case alone.
        let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");
        let pid_file = root.join("child.pid");
        let executable = never_ending(&root, &pid_file);

        let started = Instant::now();
        let reason = unavailable(memory_search(MemorySearchSpec {
            root: &root,
            query: QUERY,
            limit: None,
            executable: Some(&executable),
            timeout: Some(HANG_DEADLINE),
            spawn: None,
        }));
        let elapsed = started.elapsed();

        assert_eq!(
            reason,
            format!("pdks memory did not answer within {HANG_DEADLINE:?}")
        );
        assert!(elapsed < RETURN_BOUND, "returned after {elapsed:?}");
        assert_gone(&pid_recorded_in(&pid_file));
    }

    #[test]
    fn a_child_that_never_reads_a_large_stdin_is_still_killed_at_its_deadline() {
        // A stdin larger than a pipe buffer blocks a writer whose reader never reads. A spawn
        // that writes it before starting the clock never reaches the deadline at all.
        let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");
        let pid_file = root.join("child.pid");
        let executable = never_ending(&root, &pid_file);
        let diff = format!("{DIFF}{}", "+".repeat(1024 * 1024));

        let started = Instant::now();
        let reason = unjudged(check_change_set(CheckChangeSetSpec {
            repo_root: &root,
            diff: &diff,
            enforce: None,
            config_layer: None,
            telemetry_path: None,
            executable: Some(&executable),
            timeout: Some(HANG_DEADLINE),
            spawn: None,
        }));
        let elapsed = started.elapsed();

        assert_eq!(
            reason,
            format!("the judge did not answer within {HANG_DEADLINE:?}")
        );
        assert!(elapsed < RETURN_BOUND, "returned after {elapsed:?}");
        assert_gone(&pid_recorded_in(&pid_file));
    }

    #[test]
    fn a_process_the_child_started_does_not_hold_the_call_past_its_deadline() {
        // A shell that runs `sleep` as its own child, as a version-manager shim runs `node`:
        // killing the shell leaves the `sleep` holding the pipes, and a spawn that joins its
        // readers after the kill returns only when that `sleep` ends.
        let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");
        let pid_file = root.join("grandchild.pid");
        let executable = script(
            &root,
            "pdks-shim",
            &format!("sleep 30 &\necho $! > '{}'\nwait", pid_file.display()),
        );
        let input = empty_input();

        let started = Instant::now();
        let reason = unjudged(check_covenant(CheckCovenantSpec {
            repo_root: &root,
            input: &input,
            enforce: None,
            config_layer: None,
            telemetry_path: None,
            executable: Some(&executable),
            timeout: Some(HANG_DEADLINE),
            spawn: None,
        }));
        let elapsed = started.elapsed();
        let _ = Command::new("kill")
            .arg(pid_recorded_in(&pid_file))
            .status();

        assert_eq!(
            reason,
            format!("the judge did not answer within {HANG_DEADLINE:?}")
        );
        assert!(elapsed < RETURN_BOUND, "returned after {elapsed:?}");
    }

    #[test]
    fn a_judge_that_answers_inside_its_deadline_is_judged_as_before() {
        // A spawn that reads the deadline as "how long to wait" and only then collects
        // status (or kills on any exit) turns a fast upheld answer into `Unjudged`.
        let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");
        let executable = script(&root, "pdks-fast", "exit 0");
        let input = empty_input();

        let verdict = check_covenant(CheckCovenantSpec {
            repo_root: &root,
            input: &input,
            enforce: None,
            config_layer: None,
            telemetry_path: None,
            executable: Some(&executable),
            timeout: Some(GENEROUS),
            spawn: None,
        });

        assert_eq!(
            verdict,
            CheckCovenantVerdict::Upheld {
                advisories: String::new()
            }
        );
    }

    #[test]
    fn a_cli_that_answers_inside_its_deadline_is_read_as_before() {
        // The stdout reader and the deadline wait overlap; one that drops the reader when
        // the wait returns loses the answer and reads a complete empty result as unavailable.
        let (_dir, root) = fixture_dir("pdks-sdk-rust-timeout-root-");
        let executable = script(&root, "pdks-fast", &format!("echo '{EMPTY_OUTPUT}'"));

        let outcome = memory_search(MemorySearchSpec {
            root: &root,
            query: QUERY,
            limit: None,
            executable: Some(&executable),
            timeout: Some(GENEROUS),
            spawn: None,
        });

        match outcome {
            MemorySearchOutcome::Empty => {}
            MemorySearchOutcome::Found { hits } => {
                panic!("expected empty, got found with {} hits", hits.len())
            }
            MemorySearchOutcome::Unavailable { reason } => {
                panic!("expected empty, got unavailable: {reason}")
            }
        }
    }
}
