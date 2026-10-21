#![cfg(unix)]

use std::cell::RefCell;
use std::fs;
use std::io;
use std::num::NonZeroU32;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use polydeukes_sdk::{
    CheckChangeSetSpec, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, Enforce,
    MemoryIngestOutcome, MemoryIngestSpec, MemorySearchOutcome, MemorySearchSpec, SpawnOutcome,
    SpawnSpec, check_change_set, check_covenant, memory_ingest, memory_search,
};
use serde_json::{Value, json};

const QUERY: &str = "two words; $(touch unwanted)";
const EMPTY: &[u8] = b"{\"ingestedAt\":\"fixture-time\",\"results\":[]}";
static ENVIRONMENT: Mutex<()> = Mutex::new(());

fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../fixtures/sdk/contract.json")).unwrap()
}

fn input() -> CovenantInput {
    serde_json::from_value(fixture()["input"].clone()).unwrap()
}

fn invoke(
    root: &Path,
    executable: Option<&Path>,
    spawn: &dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>,
    timeout: Option<Duration>,
) -> Vec<String> {
    let ir = input();
    let data = fixture();
    vec![
        format!(
            "{:?}",
            check_covenant(CheckCovenantSpec {
                repo_root: root,
                input: &ir,
                enforce: Some(Enforce::Advise),
                config_layer: Some(Path::new("host layer.json")),
                telemetry_path: Some(Path::new("rows.log")),
                executable,
                timeout,
                spawn: Some(spawn)
            })
        ),
        format!(
            "{:?}",
            check_change_set(CheckChangeSetSpec {
                repo_root: root,
                diff: data["diff"].as_str().unwrap(),
                enforce: None,
                config_layer: None,
                telemetry_path: None,
                executable,
                timeout,
                spawn: Some(spawn)
            })
        ),
        format!(
            "{:?}",
            memory_ingest(MemoryIngestSpec {
                root,
                executable,
                timeout,
                spawn: Some(spawn)
            })
        ),
        format!(
            "{:?}",
            memory_search(MemorySearchSpec {
                root,
                query: QUERY,
                limit: NonZeroU32::new(7),
                executable,
                timeout,
                spawn: Some(spawn)
            })
        ),
    ]
}

fn success() -> SpawnOutcome {
    SpawnOutcome {
        status: Some(0),
        stdout: EMPTY.to_vec(),
        stderr: Vec::new(),
    }
}

fn search(root: &Path, status: Option<i32>, stdout: Vec<u8>) -> MemorySearchOutcome {
    let spawn = move |_| {
        Ok(SpawnOutcome {
            status,
            stdout: stdout.clone(),
            stderr: b" reason\n".to_vec(),
        })
    };
    memory_search(MemorySearchSpec {
        root,
        query: QUERY,
        limit: None,
        executable: Some(Path::new("/chosen/pdks")),
        timeout: None,
        spawn: Some(&spawn),
    })
}

fn script(root: &Path, name: &str, body: &str) -> PathBuf {
    let executable = root.join(name);
    fs::write(
        &executable,
        format!("#!/bin/sh\nif [ \"$1\" = --warmup ]; then exit 0; fi\n{body}\n"),
    )
    .unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        Command::new(&executable)
            .arg("--warmup")
            .status()
            .unwrap()
            .success()
    );
    executable
}

#[test]
fn all_verbs_share_a_byte_transport_and_literal_arguments() {
    // Separate memory transports often lose deadlines or acquire covenant-only flags.
    let dir = tempfile::tempdir().unwrap();
    let calls = RefCell::new(Vec::new());
    let spawn = |spec| {
        calls.borrow_mut().push(spec);
        Ok(success())
    };
    invoke(
        dir.path(),
        Some(Path::new("tools/pdks")),
        &spawn,
        Some(Duration::from_millis(123)),
    );
    let calls = calls.borrow();
    assert_eq!(calls.len(), 4);
    for call in calls.iter() {
        assert_eq!(
            Path::new(&call.command),
            std::env::current_dir().unwrap().join("tools/pdks")
        );
        assert_eq!(call.cwd, dir.path());
        assert_eq!(call.timeout, Some(Duration::from_millis(123)));
    }
    assert_eq!(
        calls[0].args,
        [
            "covenant",
            "check",
            "--enforce",
            "advise",
            "--config-layer",
            "host layer.json",
            "--telemetry-path",
            "rows.log"
        ]
    );
    assert_eq!(
        calls[1].args,
        ["covenant", "check", "--diff", "--enforce", "block"]
    );
    assert_eq!(calls[2].args, ["memory", "ingest"]);
    assert_eq!(
        calls[3].args,
        ["memory", "search", QUERY, "--json", "--limit", "7"]
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&calls[0].stdin).unwrap(),
        fixture()["input"]
    );
    assert_eq!(
        calls[1].stdin,
        fixture()["diff"].as_str().unwrap().as_bytes()
    );
    assert!(calls[2].stdin.is_empty());
    assert!(calls[3].stdin.is_empty());
}

#[test]
fn path_selection_skips_invalid_entries_and_ignores_npm_installations() {
    // An install lookup or permissive PATH search selects a different judge.
    let _lock = ENVIRONMENT.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let dirs: Vec<_> = ["noexec", "directory", "first", "second"]
        .iter()
        .map(|name| root.join(name))
        .collect();
    for path in &dirs {
        fs::create_dir(path).unwrap();
    }
    fs::write(dirs[0].join("pdks"), "").unwrap();
    fs::create_dir(dirs[1].join("pdks")).unwrap();
    for path in &dirs[2..] {
        fs::write(path.join("pdks"), "").unwrap();
        fs::set_permissions(path.join("pdks"), fs::Permissions::from_mode(0o755)).unwrap();
    }
    let npm = root.join("node_modules/polydeukes");
    fs::create_dir_all(&npm).unwrap();
    fs::write(npm.join("package.json"), r#"{"bin":{"pdks":"wrong.js"}}"#).unwrap();
    let old_path = std::env::var_os("PATH");
    let candidate_path = format!(
        ":.:relative:{}",
        dirs.iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(":")
    );
    // This integration binary serializes its environment-mutating tests.
    unsafe {
        std::env::set_var("PATH", candidate_path);
    }
    let calls = RefCell::new(Vec::new());
    let spawn = |spec| {
        calls.borrow_mut().push(spec);
        Ok(success())
    };
    invoke(root, None, &spawn, None);
    unsafe {
        if let Some(value) = old_path {
            std::env::set_var("PATH", value);
        } else {
            std::env::remove_var("PATH");
        }
    }
    assert_eq!(calls.borrow().len(), 4);
    for call in calls.borrow().iter() {
        assert_eq!(Path::new(&call.command), dirs[2].join("pdks"));
    }
}

#[test]
fn selected_path_failure_does_not_retry_a_later_executable() {
    // A fallback would conceal the selected CLI failure and run the marker-producing candidate.
    let _lock = ENVIRONMENT.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let first = root.join("first-bin");
    let second = root.join("second-bin");
    fs::create_dir(&first).unwrap();
    fs::create_dir(&second).unwrap();
    let marker = root.join("fallback-ran");
    script(&first, "pdks", "exit 1");
    script(
        &second,
        "pdks",
        &format!("printf ran > '{}'\nexit 0", marker.display()),
    );
    struct RestorePath(Option<std::ffi::OsString>);
    impl Drop for RestorePath {
        fn drop(&mut self) {
            unsafe {
                if let Some(value) = &self.0 {
                    std::env::set_var("PATH", value);
                } else {
                    std::env::remove_var("PATH");
                }
            }
        }
    }
    let restore = RestorePath(std::env::var_os("PATH"));
    unsafe {
        std::env::set_var("PATH", format!("{}:{}", first.display(), second.display()));
    }
    let outcome = memory_ingest(MemoryIngestSpec {
        root,
        executable: None,
        timeout: None,
        spawn: None,
    });
    drop(restore);
    assert!(matches!(outcome, MemoryIngestOutcome::Unavailable { .. }));
    assert!(!marker.exists());
}

#[test]
fn explicit_symlink_spelling_is_preserved_for_all_verbs() {
    let _lock = ENVIRONMENT.lock().unwrap();
    // Resolving a symlink target changes the caller-selected executable spelling.
    let dir = tempfile::tempdir().unwrap();
    let target = script(dir.path(), "target", "exit 0");
    let link = dir.path().join("named-pdks");
    std::os::unix::fs::symlink(target, &link).unwrap();
    let calls = RefCell::new(Vec::new());
    let spawn = |spec| {
        calls.borrow_mut().push(spec);
        Ok(success())
    };
    invoke(dir.path(), Some(&link), &spawn, None);
    for call in calls.borrow().iter() {
        assert_eq!(Path::new(&call.command), link);
    }
}

#[test]
fn all_verbs_map_binary_statuses_and_preserve_stderr() {
    // A byte migration must not trim diagnostic text or read stdout as a covenant verdict.
    let dir = tempfile::tempdir().unwrap();
    for status in [Some(0), Some(2), Some(1), None] {
        let spawn = |_| {
            Ok(SpawnOutcome {
                status,
                stdout: EMPTY.to_vec(),
                stderr: " reason \u{d55c}\u{ae00}\n".as_bytes().to_vec(),
            })
        };
        let results = invoke(dir.path(), Some(Path::new("/pdks")), &spawn, None);
        let expected = if status == Some(0) {
            ["Upheld", "Upheld", "Ingested", "Empty"]
        } else if status == Some(2) {
            ["Blocked", "Blocked", "Unavailable", "Unavailable"]
        } else {
            ["Unjudged", "Unjudged", "Unavailable", "Unavailable"]
        };
        for (result, prefix) in results.iter().zip(expected) {
            assert!(result.starts_with(prefix), "{result}");
        }
        if status.is_some() {
            for result in &results[..2] {
                assert!(result.contains(" reason \u{d55c}\u{ae00}\\n"), "{result}");
            }
        }
    }
}

#[test]
fn selected_spawn_errors_and_timeouts_return_failures_without_retry() {
    // Falling back to another executable after selection silently changes the judge.
    let dir = tempfile::tempdir().unwrap();
    for kind in [io::ErrorKind::PermissionDenied, io::ErrorKind::TimedOut] {
        let calls = RefCell::new(Vec::new());
        let spawn = |spec| {
            calls.borrow_mut().push(spec);
            Err(io::Error::new(kind, "selected fixture failure"))
        };
        let results = invoke(
            dir.path(),
            Some(Path::new("/chosen/pdks")),
            &spawn,
            Some(Duration::from_millis(200)),
        );
        for (result, prefix) in
            results
                .iter()
                .zip(["Unjudged", "Unjudged", "Unavailable", "Unavailable"])
        {
            assert!(result.starts_with(prefix), "{result}");
        }
        assert_eq!(calls.borrow().len(), 4);
        for call in calls.borrow().iter() {
            assert_eq!(call.command, "/chosen/pdks");
        }
    }
}

#[test]
fn strict_search_rejects_bad_utf8_missing_fields_types_enums_and_non_json_numbers() {
    // Lossy UTF-8 conversion could turn malformed bytes into apparently valid search JSON.
    let dir = tempfile::tempdir().unwrap();
    let data = fixture();
    let hit = data["hit"].clone();
    let valid = json!({"ingestedAt":"fixture-time", "results":[hit.clone()]});
    let mut invalid = vec![
        b"{".to_vec(),
        b"{\"ingestedAt\":\"t\",\"results\":[],\"extra\":NaN}".to_vec(),
        b"null".to_vec(),
        b"[]".to_vec(),
        b"{\"ingestedAt\":7,\"results\":[]}".to_vec(),
        b"{\"ingestedAt\":\"t\",\"results\":{}}".to_vec(),
        b"{\"ingestedAt\":\"t\",\"results\":[null]}".to_vec(),
    ];
    let mut utf8 = b"{\"ingestedAt\":\"".to_vec();
    utf8.push(255);
    utf8.extend_from_slice(b"\",\"results\":[]}");
    invalid.push(utf8);
    for field in ["ingestedAt", "results"] {
        let mut value = valid.clone();
        value.as_object_mut().unwrap().remove(field);
        invalid.push(serde_json::to_vec(&value).unwrap());
    }
    for field in hit.as_object().unwrap().keys() {
        let mut value = valid.clone();
        value["results"][0].as_object_mut().unwrap().remove(field);
        invalid.push(serde_json::to_vec(&value).unwrap());
        let mut value = valid.clone();
        value["results"][0][field] = json!(9);
        invalid.push(serde_json::to_vec(&value).unwrap());
    }
    for (field, wrong) in [
        ("trust", json!("unknown")),
        ("matchPath", json!("unknown")),
        ("supersededBy", json!([false])),
    ] {
        let mut value = valid.clone();
        value["results"][0][field] = wrong;
        invalid.push(serde_json::to_vec(&value).unwrap());
    }
    for (index, stdout) in invalid.into_iter().enumerate() {
        assert!(
            matches!(
                search(dir.path(), Some(0), stdout),
                MemorySearchOutcome::Unavailable { .. }
            ),
            "invalid case {index}"
        );
    }
}

#[test]
fn search_accepts_open_objects_and_keeps_cli_ranking() {
    // Sorting hits or refusing future fields rejects a valid newer CLI response.
    let dir = tempfile::tempdir().unwrap();
    let data = fixture();
    let mut first = data["hit"].clone();
    first["id"] = json!("z#first");
    first["future"] = json!(true);
    let mut second = data["hit"].clone();
    second["id"] = json!("a#second");
    let stdout = serde_json::to_vec(
        &json!({"ingestedAt":"fixture-time","results":[first,second],"future":true}),
    )
    .unwrap();
    match search(dir.path(), Some(0), stdout) {
        MemorySearchOutcome::Found { hits } => assert_eq!(
            hits.iter().map(|hit| hit.id.as_str()).collect::<Vec<_>>(),
            ["z#first", "a#second"]
        ),
        other => panic!("expected ordered found hits, got {other:?}"),
    }
    assert!(matches!(
        search(dir.path(), Some(0), EMPTY.to_vec()),
        MemorySearchOutcome::Empty
    ));
}

struct ProcessCleanup(Vec<PathBuf>);
impl Drop for ProcessCleanup {
    fn drop(&mut self) {
        for file in &self.0 {
            if let Ok(pid) = fs::read_to_string(file) {
                let _ = Command::new("/bin/kill")
                    .args(["-KILL", pid.trim()])
                    .status();
            }
        }
    }
}

#[test]
fn communication_deadline_covers_sleeping_unread_and_descendant_pipe_cases() {
    let _lock = ENVIRONMENT.lock().unwrap();
    // Child exit is not communication completion when descendants still hold stdout/stderr.
    for shape in ["sleeping", "unread", "live-parent", "exited-parent"] {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let pid = root.join("parent.pid");
        let descendant = root.join("descendant.pid");
        let _cleanup = ProcessCleanup(vec![pid.clone(), descendant.clone()]);
        let body = if shape.ends_with("parent") {
            format!(
                "echo $$ > '{}'\n/bin/sleep 2 &\necho $! > '{}'\n{}",
                pid.display(),
                descendant.display(),
                if shape == "exited-parent" {
                    "exit 0"
                } else {
                    "wait"
                }
            )
        } else {
            format!("echo $$ > '{}'\nwhile :; do :; done", pid.display())
        };
        let executable = script(root, "deadline-pdks", &body);
        let diff = if shape == "unread" {
            "x".repeat(1024 * 1024)
        } else {
            fixture()["diff"].as_str().unwrap().to_owned()
        };
        let started = Instant::now();
        let result = check_change_set(CheckChangeSetSpec {
            repo_root: root,
            diff: &diff,
            enforce: None,
            config_layer: None,
            telemetry_path: None,
            executable: Some(&executable),
            timeout: Some(Duration::from_millis(200)),
            spawn: None,
        });
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "{shape}: {:?}",
            started.elapsed()
        );
        assert!(
            matches!(&result, CheckCovenantVerdict::Unjudged { reason } if reason.contains("within") || reason.contains("timed") || reason.contains("deadline")),
            "{shape}: {result:?}"
        );
        let child = fs::read_to_string(pid).unwrap();
        assert!(
            !Command::new("/bin/kill")
                .args(["-0", child.trim()])
                .status()
                .unwrap()
                .success(),
            "direct child was not reaped: {shape}"
        );
    }
}

#[test]
fn large_outputs_are_drained_while_large_stdin_is_written() {
    let _lock = ENVIRONMENT.lock().unwrap();
    // Sequential stdin writing deadlocks against a child that fills its output pipes first.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let executable = script(
        root,
        "duplex-pdks",
        "/bin/dd if=/dev/zero bs=65536 count=32 2>/dev/null\n/bin/dd if=/dev/zero bs=65536 count=32 1>&2\n/bin/cat >/dev/null\nexit 0",
    );
    let diff = "x".repeat(1024 * 1024);
    let result = check_change_set(CheckChangeSetSpec {
        repo_root: root,
        diff: &diff,
        enforce: None,
        config_layer: None,
        telemetry_path: None,
        executable: Some(&executable),
        timeout: Some(Duration::from_secs(3)),
        spawn: None,
    });
    assert!(
        matches!(result, CheckCovenantVerdict::Upheld { advisories } if advisories.len() >= 2 * 1024 * 1024)
    );
}

#[test]
fn normal_completion_succeeds_and_zero_deadline_expires() {
    let _lock = ENVIRONMENT.lock().unwrap();
    // Treating Duration::ZERO as absent leaves the child running indefinitely.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let fast = script(root, "fast-pdks", "exit 0");
    assert!(matches!(
        memory_ingest(MemoryIngestSpec {
            root,
            executable: Some(&fast),
            timeout: Some(Duration::from_secs(2)),
            spawn: None
        }),
        MemoryIngestOutcome::Ingested
    ));
    let slow = script(root, "slow-pdks", "while :; do :; done");
    let started = Instant::now();
    assert!(matches!(
        memory_ingest(MemoryIngestSpec {
            root,
            executable: Some(&slow),
            timeout: Some(Duration::ZERO),
            spawn: None
        }),
        MemoryIngestOutcome::Unavailable { .. }
    ));
    assert!(started.elapsed() < Duration::from_secs(5));
}
