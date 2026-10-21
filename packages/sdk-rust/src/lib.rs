//! Hand one covenant input, or one change set as a unified diff, to `pdks covenant check` and
//! read the verdict as a value; ingest and search a project's memory through `pdks memory` and
//! read the hits as values.
//!
//! The crate runs the `pdks` executable a caller names in the spec, or otherwise locates the
//! first `pdks` executable in an absolute `PATH` directory, and maps the child's exit status. It
//! judges nothing and opens no index.

#[rustfmt::skip]
mod ir;
#[rustfmt::skip]
mod memory;

pub use ir::*;
pub use memory::{
    MemorySearchOutput, MemorySearchResult, MemorySearchResultMatchPath, MemorySearchResultTrust,
};

use std::fs;
use std::io::{self, Read, Write};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

/// The observer's posture for the run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Enforce {
    Advise,
    Block,
}

/// The executable, literal arguments, cwd, stdin bytes, and communication deadline.
/// A seam enforces `timeout` after spawning through completion of all piped streams,
/// returning `io::ErrorKind::TimedOut` after killing and reaping the direct child.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnSpec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub stdin: Vec<u8>,
    pub timeout: Option<Duration>,
}

/// What the spawned child left: its exit status (`None` when a signal ended it), its stdout, and
/// its stderr. The covenant verbs read no stdout.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnOutcome {
    pub status: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// `check_covenant` input.
pub struct CheckCovenantSpec<'a> {
    /// The project being judged — config discovery and the child's cwd.
    pub repo_root: &'a Path,
    /// The caller's own input, sent verbatim.
    pub input: &'a CovenantInput,
    /// `None` is `Block`.
    pub enforce: Option<Enforce>,
    /// A config layer merged over the discovered config; the umbrella resolves it against `repo_root`.
    pub config_layer: Option<&'a Path>,
    /// Where the child writes its telemetry rows, ahead of the config's own log path.
    pub telemetry_path: Option<&'a Path>,
    /// The `pdks` executable to run. `None` selects the first executable in an absolute `PATH` directory.
    pub executable: Option<&'a Path>,
    /// The communication deadline after spawn; `None` waits for exit and all piped streams.
    pub timeout: Option<Duration>,
    /// Injected spawn seam — `None` runs the selected executable with every stream piped.
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
}

/// What the judge answered.
///
/// `advisories` and `reason` preserve valid UTF-8 stderr; malformed bytes use replacement characters. `Unjudged` is every outcome that
/// is not a verdict: no judgment happened, and reading it as an uphold would let an absent judge
/// pass every call. Its `reason` is the child's stderr when the child exited with some other
/// status and wrote any, else a line naming the status, the signal, the deadline the child
/// outlived, or the spawn error.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckCovenantVerdict {
    Upheld { advisories: String },
    Blocked { reason: String },
    Unjudged { reason: String },
}

/// The first `pdks` on `PATH` that is a regular file (after following symlinks) and, on unix,
/// carries an exec bit. Relative and empty entries are skipped: only the process cwd could
/// resolve them.
fn find_pdks_on_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join("pdks"))
        .find(|candidate| {
            fs::metadata(candidate).is_ok_and(|meta| {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    meta.is_file() && meta.permissions().mode() & 0o111 != 0
                }
                #[cfg(not(unix))]
                {
                    meta.is_file()
                }
            })
        })
}

/// Run the spec's command with every stream piped and collect stdout and stderr. Past the spec's
/// `timeout` the child is killed and reaped, and the answer is a `TimedOut` error. Only the child
/// is killed: a process it started itself keeps running.
fn default_spawn(spec: SpawnSpec) -> io::Result<SpawnOutcome> {
    let mut child = Command::new(&spec.command)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let started = Instant::now();
    let mut stdin = child.stdin.take().expect("stdin is piped");
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");
    enum Completed {
        Stdin,
        Stdout(io::Result<Vec<u8>>),
        Stderr(io::Result<Vec<u8>>),
    }
    let (sender, receiver) = mpsc::channel();
    let written = sender.clone();
    thread::spawn(move || {
        // Early child exit can break stdin; the child's exit status remains the answer.
        let _ = stdin.write_all(&spec.stdin);
        drop(stdin);
        let _ = written.send(Completed::Stdin);
    });
    let drained = sender.clone();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.read_to_end(&mut bytes).map(|_| bytes);
        let _ = drained.send(Completed::Stdout(result));
    });
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stderr.read_to_end(&mut bytes).map(|_| bytes);
        let _ = sender.send(Completed::Stderr(result));
    });
    let result = (|| {
        let mut status = None;
        let mut written = false;
        let mut out = None;
        let mut errors = None;
        loop {
            let interval = match spec.timeout {
                Some(timeout) => {
                    let remaining = timeout.saturating_sub(started.elapsed());
                    if remaining.is_zero() {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "the child's communication did not finish within its deadline",
                        ));
                    }
                    remaining.min(Duration::from_millis(10))
                }
                None => Duration::from_millis(10),
            };
            if status.is_none() {
                status = child.try_wait()?;
            }
            if written {
                if let (Some(status), Some(stdout), Some(stderr)) =
                    (status, out.as_mut(), errors.as_mut())
                {
                    return Ok(SpawnOutcome {
                        status: status.code(),
                        stdout: std::mem::take(stdout),
                        stderr: std::mem::take(stderr),
                    });
                }
            }
            match receiver.recv_timeout(interval) {
                Ok(Completed::Stdin) => written = true,
                Ok(Completed::Stdout(bytes)) => out = Some(bytes?),
                Ok(Completed::Stderr(bytes)) => errors = Some(bytes?),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => thread::sleep(interval),
            }
        }
    })();
    if result.is_err() {
        // Descendants can retain pipes after the child exits. Readers detach so they cannot
        // extend the caller's deadline; only the direct child is killed and reaped.
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

/// The selected executable and the absolute project root used as its cwd.
struct Invocation {
    cwd: PathBuf,
    command: String,
}

/// Why no invocation could be built: the root or a named executable could not be made absolute,
/// or no executable was found, where `Missing` says what was missing ahead of what the verb needed
/// it for.
enum Unresolved {
    Path(io::Error),
    Missing(String),
}

/// Every verb's one way to decide what it runs.
fn resolve_executable(root: &Path, executable: Option<&Path>) -> Result<Invocation, Unresolved> {
    let cwd = std::path::absolute(root).map_err(Unresolved::Path)?;
    // Resolve against the caller's cwd without canonicalizing the caller's symlink spelling.
    let command = match executable {
        Some(executable) => std::path::absolute(executable).map_err(Unresolved::Path)?,
        None => find_pdks_on_path().ok_or_else(|| {
            Unresolved::Missing("no executable pdks in an absolute PATH directory".into())
        })?,
    };
    Ok(Invocation {
        command: command.to_string_lossy().into_owned(),
        cwd,
    })
}

/// Spawn the selected executable with literal arguments and bytes through the shared seam.
fn spawn_invocation(
    invocation: Invocation,
    args: Vec<String>,
    stdin: Vec<u8>,
    timeout: Option<Duration>,
    spawn: Option<&dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
) -> io::Result<SpawnOutcome> {
    let spawn_spec = SpawnSpec {
        command: invocation.command,
        args,
        cwd: invocation.cwd,
        stdin,
        timeout,
    };
    match spawn {
        Some(spawn) => spawn(spawn_spec),
        None => default_spawn(spawn_spec),
    }
}

/// `check_change_set` input.
pub struct CheckChangeSetSpec<'a> {
    /// The project being judged — config discovery and the child's cwd.
    pub repo_root: &'a Path,
    /// A unified diff, sent verbatim.
    pub diff: &'a str,
    /// `None` is `Block`.
    pub enforce: Option<Enforce>,
    /// A config layer merged over the discovered config; the umbrella resolves it against `repo_root`.
    pub config_layer: Option<&'a Path>,
    /// Where the child writes its telemetry rows, ahead of the config's own log path.
    pub telemetry_path: Option<&'a Path>,
    /// The `pdks` executable to run. `None` selects the first executable in an absolute `PATH` directory.
    pub executable: Option<&'a Path>,
    /// The communication deadline after spawn; `None` waits for exit and all piped streams.
    pub timeout: Option<Duration>,
    /// Injected spawn seam — `None` runs the selected executable with every stream piped.
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
}

/// Judge one input against the covenants of `repo_root` and return the verdict as a value.
pub fn check_covenant(spec: CheckCovenantSpec) -> CheckCovenantVerdict {
    run_check(
        spec.repo_root,
        spec.enforce,
        spec.config_layer,
        spec.telemetry_path,
        spec.executable,
        spec.timeout,
        spec.spawn,
        false,
        || serde_json::to_vec(spec.input).map_err(io::Error::other),
    )
}

/// Judge one change set, a unified diff, against the covenants of `repo_root` and return the
/// verdict as a value.
pub fn check_change_set(spec: CheckChangeSetSpec) -> CheckCovenantVerdict {
    run_check(
        spec.repo_root,
        spec.enforce,
        spec.config_layer,
        spec.telemetry_path,
        spec.executable,
        spec.timeout,
        spec.spawn,
        true,
        || Ok(spec.diff.as_bytes().to_vec()),
    )
}

/// Resolve the executable, spawn `pdks covenant check` (with `--diff` under `diff_mode`), and map
/// the child's status. `stdin` runs after resolution, so its error is `Unjudged`, never a panic.
#[allow(clippy::too_many_arguments)]
fn run_check(
    repo_root: &Path,
    enforce: Option<Enforce>,
    config_layer: Option<&Path>,
    telemetry_path: Option<&Path>,
    executable: Option<&Path>,
    timeout: Option<Duration>,
    spawn: Option<&dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
    diff_mode: bool,
    stdin: impl FnOnce() -> io::Result<Vec<u8>>,
) -> CheckCovenantVerdict {
    let invocation = match resolve_executable(repo_root, executable) {
        Ok(invocation) => invocation,
        Err(Unresolved::Path(error)) => {
            return CheckCovenantVerdict::Unjudged {
                reason: format!("the judge could not be spawned: {error}"),
            };
        }
        Err(Unresolved::Missing(missing)) => {
            let subject = if diff_mode {
                "this change set"
            } else {
                "this input"
            };
            return CheckCovenantVerdict::Unjudged {
                reason: format!("{missing}: install it to have {subject} judged"),
            };
        }
    };

    let mut args = vec!["covenant".into(), "check".into()];
    if diff_mode {
        args.push("--diff".into());
    }
    args.push("--enforce".into());
    args.push(
        match enforce.unwrap_or(Enforce::Block) {
            Enforce::Advise => "advise",
            Enforce::Block => "block",
        }
        .into(),
    );
    if let Some(layer) = config_layer {
        args.push("--config-layer".into());
        args.push(layer.to_string_lossy().into_owned());
    }
    if let Some(path) = telemetry_path {
        args.push("--telemetry-path".into());
        args.push(path.to_string_lossy().into_owned());
    }

    let outcome =
        stdin().and_then(|stdin| spawn_invocation(invocation, args, stdin, timeout, spawn));

    match outcome {
        Ok(SpawnOutcome {
            status: Some(0),
            stderr,
            ..
        }) => CheckCovenantVerdict::Upheld {
            advisories: String::from_utf8_lossy(&stderr).into_owned(),
        },
        Ok(SpawnOutcome {
            status: Some(2),
            stderr,
            ..
        }) => CheckCovenantVerdict::Blocked {
            reason: String::from_utf8_lossy(&stderr).into_owned(),
        },
        Ok(SpawnOutcome {
            status: Some(status),
            stderr,
            ..
        }) => CheckCovenantVerdict::Unjudged {
            reason: if stderr.is_empty() {
                format!("the judge exited with status {status} instead of a verdict")
            } else {
                String::from_utf8_lossy(&stderr).into_owned()
            },
        },
        Ok(SpawnOutcome { status: None, .. }) => CheckCovenantVerdict::Unjudged {
            reason: "the judge was killed by a signal before it answered".into(),
        },
        Err(error) => CheckCovenantVerdict::Unjudged {
            reason: match timeout {
                Some(timeout) if error.kind() == io::ErrorKind::TimedOut => {
                    format!("the judge did not answer within {timeout:?}")
                }
                _ => format!("the judge could not be spawned: {error}"),
            },
        },
    }
}

/// `memory_ingest` input.
pub struct MemoryIngestSpec<'a> {
    /// The memory root — config discovery and the child's cwd.
    pub root: &'a Path,
    /// The `pdks` executable to run. `None` selects the first executable in an absolute `PATH` directory.
    pub executable: Option<&'a Path>,
    /// The communication deadline after spawn; `None` waits for exit and all piped streams.
    pub timeout: Option<Duration>,
    /// Injected spawn seam — `None` runs the selected executable with every stream piped.
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
}

/// What `pdks memory ingest` answered. `reason` is the child's stderr verbatim when it left one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MemoryIngestOutcome {
    Ingested,
    Unavailable { reason: String },
}

/// `memory_search` input.
pub struct MemorySearchSpec<'a> {
    /// The memory root — config discovery and the child's cwd.
    pub root: &'a Path,
    /// The query, sent as one argument.
    pub query: &'a str,
    /// The most hits the command returns; `None` is the command's own default.
    pub limit: Option<NonZeroU32>,
    /// The `pdks` executable to run. `None` selects the first executable in an absolute `PATH` directory.
    pub executable: Option<&'a Path>,
    /// The communication deadline after spawn; `None` waits for exit and all piped streams.
    pub timeout: Option<Duration>,
    /// Injected spawn seam — `None` runs the selected executable with every stream piped.
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
}

/// What `pdks memory search` answered.
///
/// `Empty` is a search that ran and matched nothing; every failure is `Unavailable`, so reading
/// `Empty` never hides an index that was not searched. `hits` is never empty and keeps the
/// command's order.
#[derive(Clone, Debug)]
pub enum MemorySearchOutcome {
    Found { hits: Vec<MemorySearchResult> },
    Empty,
    Unavailable { reason: String },
}

/// Bring the memory index under `root` level with its documents.
pub fn memory_ingest(spec: MemoryIngestSpec) -> MemoryIngestOutcome {
    match run_memory(
        spec.root,
        vec!["ingest".into()],
        spec.executable,
        spec.timeout,
        spec.spawn,
    ) {
        Ok(_) => MemoryIngestOutcome::Ingested,
        Err(reason) => MemoryIngestOutcome::Unavailable { reason },
    }
}

/// Search the memory index under `root` and return its hits as values.
pub fn memory_search(spec: MemorySearchSpec) -> MemorySearchOutcome {
    let mut args = vec!["search".into(), spec.query.into(), "--json".into()];
    if let Some(limit) = spec.limit {
        args.push("--limit".into());
        args.push(limit.to_string());
    }
    let stdout = match run_memory(spec.root, args, spec.executable, spec.timeout, spec.spawn) {
        Ok(stdout) => stdout,
        Err(reason) => return MemorySearchOutcome::Unavailable { reason },
    };
    // Serde can skip unknown fields without decoding their string bytes. Validate the whole
    // response first so malformed UTF-8 in an open object's future field also fails.
    if let Err(error) = std::str::from_utf8(&stdout) {
        return MemorySearchOutcome::Unavailable {
            reason: format!("pdks memory search printed invalid UTF-8: {error}"),
        };
    }
    match serde_json::from_slice::<MemorySearchOutput>(&stdout) {
        Ok(output) if output.results.is_empty() => MemorySearchOutcome::Empty,
        Ok(output) => MemorySearchOutcome::Found {
            hits: output.results,
        },
        Err(error) => MemorySearchOutcome::Unavailable {
            reason: format!("pdks memory search printed output this crate cannot read: {error}"),
        },
    }
}

/// Resolve the executable, spawn `pdks memory` with `args` and an empty stdin, and return the
/// child's stdout at status 0. Every other outcome is the reason it is unavailable.
fn run_memory(
    root: &Path,
    args: Vec<String>,
    executable: Option<&Path>,
    timeout: Option<Duration>,
    spawn: Option<&dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
) -> Result<Vec<u8>, String> {
    let invocation = match resolve_executable(root, executable) {
        Ok(invocation) => invocation,
        Err(Unresolved::Path(error)) => {
            return Err(format!("pdks memory could not be spawned: {error}"));
        }
        Err(Unresolved::Missing(missing)) => {
            return Err(format!("{missing}: install it to use memory"));
        }
    };
    let mut all = vec!["memory".to_string()];
    all.extend(args);
    match spawn_invocation(invocation, all, Vec::new(), timeout, spawn) {
        Ok(SpawnOutcome {
            status: Some(0),
            stdout,
            ..
        }) => Ok(stdout),
        Ok(SpawnOutcome {
            status: Some(status),
            stderr,
            ..
        }) if stderr.is_empty() => Err(format!(
            "pdks memory exited with status {status} and wrote nothing on stderr"
        )),
        Ok(SpawnOutcome {
            status: Some(_),
            stderr,
            ..
        }) => Err(String::from_utf8_lossy(&stderr).into_owned()),
        Ok(SpawnOutcome { status: None, .. }) => {
            Err("pdks memory was killed by a signal before it answered".into())
        }
        Err(error) => Err(match timeout {
            Some(timeout) if error.kind() == io::ErrorKind::TimedOut => {
                format!("pdks memory did not answer within {timeout:?}")
            }
            _ => format!("pdks memory could not be spawned: {error}"),
        }),
    }
}
