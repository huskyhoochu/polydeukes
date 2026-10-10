//! Hand one covenant input, or one change set as a unified diff, to `pdks covenant check` and
//! read the verdict as a value; ingest and search a project's memory through `pdks memory` and
//! read the hits as values.
//!
//! The crate locates the `polydeukes` umbrella in the project's install graph, spawns its bin
//! under `node`, and maps the child's exit status. It judges nothing and opens no index.

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
use std::thread;

const UMBRELLA_PACKAGE: &str = "polydeukes";

/// The observer's posture for the run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Enforce {
    Advise,
    Block,
}

/// What the spawn seam is handed: the executable, its arguments, its cwd, and its stdin.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnSpec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub stdin: String,
}

/// What the spawned child left: its exit status (`None` when a signal ended it), its stdout, and
/// its stderr. The covenant verbs read no stdout.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnOutcome {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// `check_covenant` input.
pub struct CheckCovenantSpec<'a> {
    /// The project being judged — config discovery, the child's cwd, and the install graph.
    pub repo_root: &'a Path,
    /// The caller's own input, sent verbatim.
    pub input: &'a CovenantInput,
    /// `None` is `Block`.
    pub enforce: Option<Enforce>,
    /// A config layer merged over the discovered config; the umbrella resolves it against `repo_root`.
    pub config_layer: Option<&'a Path>,
    /// Where the child writes its telemetry rows, ahead of the config's own log path.
    pub telemetry_path: Option<&'a Path>,
    /// Injected spawn seam — `None` runs `node` from `PATH` with every stream piped.
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
}

/// What the judge answered.
///
/// `advisories` and `reason` are the child's stderr verbatim. `Unjudged` is every outcome that
/// is not a verdict: no judgment happened, and reading it as an uphold would let an absent judge
/// pass every call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckCovenantVerdict {
    Upheld { advisories: String },
    Blocked { reason: String },
    Unjudged { reason: String },
}

/// The `pdks` bin of the nearest `node_modules/polydeukes` at or above `repo_root`.
///
/// The nearest `node_modules/polydeukes` directory is the one Node resolves, so one with an
/// unreadable or missing manifest, or no string `bin.pdks`, answers `None` without looking
/// further up.
fn find_umbrella_bin(repo_root: &Path) -> Option<PathBuf> {
    let manifest_dir = repo_root
        .ancestors()
        .map(|dir| dir.join("node_modules").join(UMBRELLA_PACKAGE))
        .find(|dir| dir.is_dir())?;
    let text = fs::read_to_string(manifest_dir.join("package.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
    let pdks = manifest["bin"]["pdks"].as_str()?;
    Some(manifest_dir.join(pdks))
}

/// Run the spec's command with every stream piped and collect stdout and stderr.
fn default_spawn(spec: SpawnSpec) -> io::Result<SpawnOutcome> {
    let mut child = Command::new(&spec.command)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdin = child.stdin.take().expect("stdin is piped");
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");
    // A child that exits before draining stdin breaks the pipe; the exit status is the answer.
    let writer = thread::spawn(move || {
        let _ = stdin.write_all(spec.stdin.as_bytes());
    });
    // Drained on its own thread: an unread pipe fills and stalls the child.
    let drain = thread::spawn(move || {
        let mut out = Vec::new();
        stdout.read_to_end(&mut out).map(|_| out)
    });
    let mut collected = Vec::new();
    // The child is reaped even when reading its stderr fails.
    let read = stderr.read_to_end(&mut collected);
    let status = child.wait();
    let _ = writer.join();
    let out = drain.join().expect("the stdout drain does not panic");
    read?;
    let status = status?;
    Ok(SpawnOutcome {
        status: status.code(),
        // A failed stdout read leaves it empty: the covenant verbs read the status alone, and an
        // empty search stdout fails to parse, so no outcome turns on it.
        stdout: out
            .map(|out| String::from_utf8_lossy(&out).into_owned())
            .unwrap_or_default(),
        stderr: String::from_utf8_lossy(&collected).into_owned(),
    })
}

/// What runs the umbrella from a root: the root made absolute as the child's cwd, `node`, and
/// the bin path as the first argument.
struct Invocation {
    cwd: PathBuf,
    command: String,
    args: Vec<String>,
}

/// Why no invocation could be built: the root could not be made absolute, or the install graph
/// above the absolute root holds no umbrella.
enum Unresolved {
    Path(io::Error),
    NoUmbrella(PathBuf),
}

/// Every verb's one way to decide what it runs.
fn resolve_umbrella(root: &Path) -> Result<Invocation, Unresolved> {
    // Absolute once, for the walk and the child's cwd alike: a relative root has no ancestors
    // above `.`, and a relative bin path would be read from the child's new cwd.
    let cwd = std::path::absolute(root).map_err(Unresolved::Path)?;
    let Some(bin) = find_umbrella_bin(&cwd) else {
        return Err(Unresolved::NoUmbrella(cwd));
    };
    Ok(Invocation {
        command: "node".into(),
        args: vec![bin.to_string_lossy().into_owned()],
        cwd,
    })
}

/// Spawn `invocation` with `args` after its own and `stdin`, through the seam when one is given.
fn spawn_invocation(
    invocation: Invocation,
    args: Vec<String>,
    stdin: String,
    spawn: Option<&dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
) -> io::Result<SpawnOutcome> {
    let mut all = invocation.args;
    all.extend(args);
    let spawn_spec = SpawnSpec {
        command: invocation.command,
        args: all,
        cwd: invocation.cwd,
        stdin,
    };
    match spawn {
        Some(spawn) => spawn(spawn_spec),
        None => default_spawn(spawn_spec),
    }
}

/// `check_change_set` input.
pub struct CheckChangeSetSpec<'a> {
    /// The project being judged — config discovery, the child's cwd, and the install graph.
    pub repo_root: &'a Path,
    /// A unified diff, sent verbatim.
    pub diff: &'a str,
    /// `None` is `Block`.
    pub enforce: Option<Enforce>,
    /// A config layer merged over the discovered config; the umbrella resolves it against `repo_root`.
    pub config_layer: Option<&'a Path>,
    /// Where the child writes its telemetry rows, ahead of the config's own log path.
    pub telemetry_path: Option<&'a Path>,
    /// Injected spawn seam — `None` runs `node` from `PATH` with every stream piped.
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
}

/// Judge one input against the covenants of `repo_root` and return the verdict as a value.
pub fn check_covenant(spec: CheckCovenantSpec) -> CheckCovenantVerdict {
    run_check(
        spec.repo_root,
        spec.enforce,
        spec.config_layer,
        spec.telemetry_path,
        spec.spawn,
        false,
        || serde_json::to_string(spec.input).map_err(io::Error::other),
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
        spec.spawn,
        true,
        || Ok(spec.diff.to_string()),
    )
}

/// Resolve the umbrella, spawn `pdks covenant check` (with `--diff` under `diff_mode`), and map
/// the child's status. `stdin` runs after resolution, so its error is `Unjudged`, never a panic.
fn run_check(
    repo_root: &Path,
    enforce: Option<Enforce>,
    config_layer: Option<&Path>,
    telemetry_path: Option<&Path>,
    spawn: Option<&dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
    diff_mode: bool,
    stdin: impl FnOnce() -> io::Result<String>,
) -> CheckCovenantVerdict {
    let invocation = match resolve_umbrella(repo_root) {
        Ok(invocation) => invocation,
        Err(Unresolved::Path(error)) => {
            return CheckCovenantVerdict::Unjudged {
                reason: format!("the judge could not be spawned: {error}"),
            };
        }
        Err(Unresolved::NoUmbrella(repo_root)) => {
            let subject = if diff_mode {
                "this change set"
            } else {
                "this input"
            };
            return CheckCovenantVerdict::Unjudged {
                reason: format!(
                    "no {UMBRELLA_PACKAGE} in the install graph of {}: install it to have {subject} judged",
                    repo_root.display()
                ),
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

    let outcome = stdin().and_then(|stdin| spawn_invocation(invocation, args, stdin, spawn));

    match outcome {
        Ok(SpawnOutcome {
            status: Some(0),
            stderr,
            ..
        }) => CheckCovenantVerdict::Upheld { advisories: stderr },
        Ok(SpawnOutcome {
            status: Some(2),
            stderr,
            ..
        }) => CheckCovenantVerdict::Blocked { reason: stderr },
        Ok(SpawnOutcome {
            status: Some(status),
            ..
        }) => CheckCovenantVerdict::Unjudged {
            reason: format!("the judge exited with status {status} instead of a verdict"),
        },
        Ok(SpawnOutcome { status: None, .. }) => CheckCovenantVerdict::Unjudged {
            reason: "the judge was killed by a signal before it answered".into(),
        },
        Err(error) => CheckCovenantVerdict::Unjudged {
            reason: format!("the judge could not be spawned: {error}"),
        },
    }
}

/// `memory_ingest` input.
pub struct MemoryIngestSpec<'a> {
    /// The memory root — config discovery, the child's cwd, and where the umbrella lookup starts.
    pub root: &'a Path,
    /// Injected spawn seam — `None` runs `node` from `PATH` with every stream piped.
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
    /// The memory root — config discovery, the child's cwd, and where the umbrella lookup starts.
    pub root: &'a Path,
    /// The query, sent as one argument.
    pub query: &'a str,
    /// The most hits the command returns; `None` is the command's own default.
    pub limit: Option<NonZeroU32>,
    /// Injected spawn seam — `None` runs `node` from `PATH` with every stream piped.
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
    match run_memory(spec.root, vec!["ingest".into()], spec.spawn) {
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
    let stdout = match run_memory(spec.root, args, spec.spawn) {
        Ok(stdout) => stdout,
        Err(reason) => return MemorySearchOutcome::Unavailable { reason },
    };
    match serde_json::from_str::<MemorySearchOutput>(&stdout) {
        Ok(output) if output.results.is_empty() => MemorySearchOutcome::Empty,
        Ok(output) => MemorySearchOutcome::Found {
            hits: output.results,
        },
        Err(error) => MemorySearchOutcome::Unavailable {
            reason: format!("pdks memory search printed output this crate cannot read: {error}"),
        },
    }
}

/// Resolve the umbrella, spawn `pdks memory` with `args` and an empty stdin, and return the
/// child's stdout at status 0. Every other outcome is the reason it is unavailable.
fn run_memory(
    root: &Path,
    args: Vec<String>,
    spawn: Option<&dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>>,
) -> Result<String, String> {
    let invocation = match resolve_umbrella(root) {
        Ok(invocation) => invocation,
        Err(Unresolved::Path(error)) => {
            return Err(format!("pdks memory could not be spawned: {error}"));
        }
        Err(Unresolved::NoUmbrella(root)) => {
            return Err(format!(
                "no {UMBRELLA_PACKAGE} in the install graph of {}: install it to use memory",
                root.display()
            ));
        }
    };
    let mut all = vec!["memory".to_string()];
    all.extend(args);
    match spawn_invocation(invocation, all, String::new(), spawn) {
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
        }) => Err(stderr),
        Ok(SpawnOutcome { status: None, .. }) => {
            Err("pdks memory was killed by a signal before it answered".into())
        }
        Err(error) => Err(format!("pdks memory could not be spawned: {error}")),
    }
}
