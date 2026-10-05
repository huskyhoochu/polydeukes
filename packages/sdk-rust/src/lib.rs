//! Hand one covenant input to `pdks covenant check` and read the verdict as a value.
//!
//! The crate locates the `polydeukes` umbrella in the judged project's install graph, spawns its
//! bin under `node` with the input on stdin, and maps the child's exit status. It judges nothing.

#[rustfmt::skip]
mod ir;

pub use ir::*;

use std::fs;
use std::io::{self, Read, Write};
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

/// What the spawned child left: its exit status (`None` when a signal ended it) and its stderr.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnOutcome {
    pub status: Option<i32>,
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

/// Run the spec's command with every stream piped, discard stdout, and collect stderr.
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
    let drain = thread::spawn(move || io::copy(&mut stdout, &mut io::sink()));
    let mut collected = Vec::new();
    // The child is reaped even when reading its stderr fails.
    let read = stderr.read_to_end(&mut collected);
    let status = child.wait();
    let _ = writer.join();
    let _ = drain.join();
    read?;
    let status = status?;
    Ok(SpawnOutcome {
        status: status.code(),
        stderr: String::from_utf8_lossy(&collected).into_owned(),
    })
}

/// Judge one input against the covenants of `repo_root` and return the verdict as a value.
pub fn check_covenant(spec: CheckCovenantSpec) -> CheckCovenantVerdict {
    // Absolute once, for the walk and the child's cwd alike: a relative root has no ancestors
    // above `.`, and a relative bin path would be read from the child's new cwd.
    let repo_root = match std::path::absolute(spec.repo_root) {
        Ok(path) => path,
        Err(error) => {
            return CheckCovenantVerdict::Unjudged {
                reason: format!("the judge could not be spawned: {error}"),
            };
        }
    };
    let Some(bin) = find_umbrella_bin(&repo_root) else {
        return CheckCovenantVerdict::Unjudged {
            reason: format!(
                "no {UMBRELLA_PACKAGE} in the install graph of {}: install it to have this input judged",
                repo_root.display()
            ),
        };
    };

    let mut args = vec![
        bin.to_string_lossy().into_owned(),
        "covenant".into(),
        "check".into(),
        "--enforce".into(),
        match spec.enforce.unwrap_or(Enforce::Block) {
            Enforce::Advise => "advise",
            Enforce::Block => "block",
        }
        .into(),
    ];
    if let Some(layer) = spec.config_layer {
        args.push("--config-layer".into());
        args.push(layer.to_string_lossy().into_owned());
    }
    if let Some(path) = spec.telemetry_path {
        args.push("--telemetry-path".into());
        args.push(path.to_string_lossy().into_owned());
    }

    let outcome = serde_json::to_string(spec.input)
        .map_err(io::Error::other)
        .and_then(|stdin| {
            let spawn_spec = SpawnSpec {
                command: "node".into(),
                args,
                cwd: repo_root,
                stdin,
            };
            match spec.spawn {
                Some(spawn) => spawn(spawn_spec),
                None => default_spawn(spawn_spec),
            }
        });

    match outcome {
        Ok(SpawnOutcome {
            status: Some(0),
            stderr,
        }) => CheckCovenantVerdict::Upheld { advisories: stderr },
        Ok(SpawnOutcome {
            status: Some(2),
            stderr,
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
