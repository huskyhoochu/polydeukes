//! `pdks covenant check` — judge one observation of the repository from the input IR.
//!
//! The stages run in this order: settle the telemetry path and load the config, read the
//! input, refuse a shape the judge cannot read, compare the protected state against the
//! last baseline (session input only), judge every tool call, re-establish the baseline.
//! A stage that cannot proceed fails closed with one `blocked` row.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use serde_json::{Map, Value};

use crate::baseline;
use crate::core::config::{Config, DEFAULT_TELEMETRY_LOG_PATH, Entry, Witness};
use crate::core::declaration::Binding;
use crate::core::exit_codes::Exit;
use crate::core::protocol::{Input, parse_input};
use crate::core::telemetry::{self, Event, iso_utc};
use crate::core::transcript::{UserMessage, user_messages};
use crate::covenant::discipline::{
    self, Supply, relativize_for_scope, shell_unjudgeable_registration,
};
use crate::covenant::dispatch::{Context, Registration, dispatch};
use crate::covenant::extract::normalize;
use crate::covenant::run_covenant::{Enforce, Verdict};
use crate::covenant::ttl_witness::{TtlSpec, Valve, witness_expired_at};
use crate::covenant::{self_mod, shell_mod, transcript_mod};
use crate::load_config::{
    LayerSource, discover_config_path, parse_config_source, parse_layer_source,
};

/// The mutating roster of a host that declared none.
const STAGED_WRITE: &str = "staged-write";
const STAGED_DELETE: &str = "staged-delete";

const TELEMETRY_ENV: &str = "POLYDEUKES_TELEMETRY_PATH";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Ir,
    InputFailure,
    Diff,
}

pub struct CheckSpec<'a> {
    pub root: &'a Path,
    pub mode: Mode,
    pub stdin: &'a str,
    pub enforce: Enforce,
    pub config_layer: Option<&'a str>,
    pub telemetry_path: Option<&'a Path>,
}

/// Where a config load stopped, which decides what can be said about repairing it.
enum Stage {
    Discovery,
    Read,
    Parse {
        config_path: String,
        source: String,
        layer: Option<LayerSource>,
    },
}

struct LoadFailure {
    error: String,
    telemetry_path: PathBuf,
    stage: Stage,
}

struct Settled {
    telemetry_path: PathBuf,
    config: Config,
    config_path: String,
}

struct Tools {
    mutating: Vec<String>,
    shell: Vec<String>,
    command_args: Vec<String>,
}

struct Session {
    evidence_path: Option<String>,
    user_messages: Vec<UserMessage>,
    user_message_count: usize,
    sidecar: Option<String>,
    /// The session flattened for a `transcript` binding.
    snapshot: Value,
}

fn fail_closed(telemetry_path: &Path, reason: &str, suffix: &str, exit: Exit) -> Exit {
    eprintln!("covenant check failed closed: {reason}{suffix}");
    telemetry::append(telemetry_path, Event::Blocked, "covenant-check", "-");
    exit
}

/// `path.resolve` against the root: an absolute argument replaces the root, then `.`, `..` and
/// repeated separators are folded lexically, without touching the filesystem.
fn resolve_from(root: &Path, argument: &str) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in root.join(argument).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            other => resolved.push(other),
        }
    }
    resolved
}

/// Flag, then a non-empty environment variable, then the config's `logPath` against the root.
fn telemetry_path(spec: &CheckSpec, log_path: &str) -> PathBuf {
    spec.telemetry_path
        .map(Path::to_path_buf)
        .or_else(|| {
            env::var_os(TELEMETRY_ENV)
                .filter(|path| !path.is_empty())
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| resolve_from(spec.root, log_path))
}

/// The provisional path is settled before the load so a config that never loads still has
/// somewhere to write its blocked row.
fn settle_config(spec: &CheckSpec) -> Result<Settled, Box<LoadFailure>> {
    let provisional = telemetry_path(spec, DEFAULT_TELEMETRY_LOG_PATH);
    let failure = |error: String, stage: Stage| {
        Box::new(LoadFailure {
            error,
            telemetry_path: provisional.clone(),
            stage,
        })
    };

    let config_path =
        discover_config_path(spec.root).map_err(|error| failure(error, Stage::Discovery))?;
    let source = match fs::read(spec.root.join(&config_path)) {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(error) => return Err(failure(error.to_string(), Stage::Read)),
    };
    let layer = match spec.config_layer {
        Some(layer_path) => {
            let path = resolve_from(spec.root, layer_path);
            match fs::read(&path) {
                Ok(bytes) => Some(LayerSource {
                    source: String::from_utf8_lossy(&bytes).into_owned(),
                    path: path.to_string_lossy().into_owned(),
                }),
                Err(error) => {
                    let stage = Stage::Parse {
                        config_path,
                        source,
                        layer: None,
                    };
                    return Err(failure(error.to_string(), stage));
                }
            }
        }
        None => None,
    };
    match parse_config_source(&source, &config_path, layer.as_ref()) {
        Ok(config) => Ok(Settled {
            telemetry_path: telemetry_path(spec, &config.log_path),
            config,
            config_path,
        }),
        Err(error) => Err(failure(
            error,
            Stage::Parse {
                config_path,
                source,
                layer,
            },
        )),
    }
}

fn read_input(spec: &CheckSpec) -> Result<Input, String> {
    match spec.mode {
        Mode::Ir => parse_input(spec.stdin),
        Mode::InputFailure => {
            let failure: Value = serde_json::from_str(spec.stdin)
                .map_err(|error| format!("input failure is not JSON: {error}"))?;
            match failure
                .get("reason")
                .and_then(Value::as_str)
                .filter(|reason| !reason.is_empty())
            {
                Some(reason) => Err(reason.to_string()),
                None => Err("input failure reason must be a non-empty string".to_string()),
            }
        }
        Mode::Diff => Err("--diff input translation is not ported".to_string()),
    }
}

fn string_list(object: &serde_json::Map<String, Value>, key: &str) -> Result<Vec<String>, String> {
    let Some(names) = object.get(key).and_then(Value::as_array) else {
        return Err(format!("input carries no tools.{key} array"));
    };
    names
        .iter()
        .map(|name| name.as_str().map(str::to_string))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| format!("input carries a non-string name in tools.{key}"))
}

/// Refuse a roster or session this runner cannot judge. A shape it cannot read is a block,
/// never a default: folding a missing list into `[]` would judge an input nobody wrote.
fn assert_judgeable_shape(input: &Input) -> Result<(Option<Tools>, Option<Session>), String> {
    if input.has_world {
        return Err("input carries a world key: the world axis is the runner’s".to_string());
    }
    let tools = match &input.tools {
        None => None,
        Some(value) => {
            let Some(object) = value.as_object() else {
                return Err("input carries a tools key that is not an object".to_string());
            };
            let mutating = string_list(object, "mutating")?;
            let shell = string_list(object, "shell")?;
            let command_args = string_list(object, "commandArgs")?;
            for (key, names) in [
                ("mutating", &mutating),
                ("shell", &shell),
                ("commandArgs", &command_args),
            ] {
                if !names.is_empty() && names.iter().all(String::is_empty) {
                    return Err(format!(
                        "input carries a tools.{key} roster with only empty names"
                    ));
                }
            }
            // Every routed call would land unjudgeable, which no posture softens.
            if !shell.is_empty() && command_args.is_empty() {
                return Err(
                    "input carries tools.shell without a tools.commandArgs key to read".to_string(),
                );
            }
            Some(Tools {
                mutating,
                shell,
                command_args,
            })
        }
    };
    let session = match &input.session {
        None => None,
        Some(value) => {
            let Some(object) = value.as_object() else {
                return Err("input carries a session key that is not an object".to_string());
            };
            let mut lists = Vec::new();
            for key in ["userMessages", "toolCalls"] {
                let Some(list) = object.get(key).and_then(Value::as_array) else {
                    return Err(format!("input carries no session.{key} array"));
                };
                lists.push(list);
            }
            let evidence_path = match object.get("evidencePath") {
                None => None,
                Some(Value::String(path)) => Some(path.clone()),
                Some(_) => {
                    return Err(
                        "input carries a session.evidencePath that is not a string".to_string()
                    );
                }
            };
            let mut sidecar = None;
            match object.get("channels") {
                None => {}
                Some(Value::Object(channels)) => match channels.get("sidecar") {
                    None => {}
                    Some(Value::String(text)) => sidecar = Some(text.clone()),
                    Some(_) => {
                        return Err(
                            "input carries a session.channels.sidecar that is not text".to_string()
                        );
                    }
                },
                Some(_) => {
                    return Err(
                        "input carries a session.channels that is not an object".to_string()
                    );
                }
            }
            let messages = lists.first().copied().map_or(&[][..], Vec::as_slice);
            let calls = lists.get(1).copied().map_or(&[][..], Vec::as_slice);
            Some(Session {
                evidence_path,
                user_messages: user_messages(messages),
                user_message_count: messages.len(),
                sidecar,
                snapshot: session_snapshot(messages, calls),
            })
        }
    };
    Ok((tools, session))
}

/// The session as plain data for a declaration: each observation carries its ordinal in its
/// own list, and the clock is the moment the snapshot is taken.
fn session_snapshot(messages: &[Value], calls: &[Value]) -> Value {
    let turns: Vec<Value> = messages
        .iter()
        .enumerate()
        .filter_map(|(index, message)| {
            let mut turn = Map::new();
            turn.insert("index".to_string(), Value::from(index));
            turn.insert("text".to_string(), message.get("text")?.clone());
            if let Some(stamp) = message.get("timestampMs").filter(|stamp| stamp.is_number()) {
                turn.insert("timestampMs".to_string(), normalize(stamp.clone()));
            }
            Some(Value::Object(turn))
        })
        .collect();
    let tool_calls: Vec<Value> = calls
        .iter()
        .enumerate()
        .filter_map(|(index, call)| {
            let mut entry = Map::new();
            entry.insert("index".to_string(), Value::from(index));
            entry.insert("name".to_string(), call.get("name")?.clone());
            let args = call.get("args").filter(|args| !args.is_null());
            entry.insert(
                "args".to_string(),
                args.map_or_else(|| Value::Object(Map::new()), Clone::clone),
            );
            if let Some(succeeded) = call.get("succeeded").filter(|flag| flag.is_boolean()) {
                entry.insert("succeeded".to_string(), succeeded.clone());
            }
            Some(Value::Object(entry))
        })
        .collect();
    let mut snapshot = Map::new();
    snapshot.insert("observedAtMs".to_string(), Value::from(telemetry::now_ms()));
    snapshot.insert("userMessages".to_string(), Value::Array(turns));
    snapshot.insert("toolCalls".to_string(), Value::Array(tool_calls));
    Value::Object(snapshot)
}

/// The working-tree text of every `file` source the entries bind. A path the tree holds but
/// cannot give as text (absent, a directory, or bytes carrying a NUL) is left out.
fn read_file_sources(root: &Path, entries: &[Entry]) -> Result<HashMap<String, String>, String> {
    let mut files = HashMap::new();
    let mut read: Vec<&str> = Vec::new();
    for entry in entries {
        for (_, binding) in &entry.declaration.sources {
            let Binding::File(path) = binding else {
                continue;
            };
            if read.contains(&path.as_str()) {
                continue;
            }
            read.push(path);
            match fs::read(root.join(path)) {
                Ok(bytes) if !bytes.contains(&0) => {
                    files.insert(path.clone(), String::from_utf8_lossy(&bytes).into_owned());
                }
                Ok(_) => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        ErrorKind::NotFound | ErrorKind::NotADirectory | ErrorKind::IsADirectory
                    ) => {}
                Err(error) => return Err(format!("cannot read {path}: {error}")),
            }
        }
    }
    Ok(files)
}

/// The environment's `HOME` when set, even empty, since that is what the judged shell expands
/// `~` from; otherwise the passwd entry bash falls back to.
fn home_dir() -> Option<String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(env::home_dir)
        .map(|home| home.to_string_lossy().into_owned())
}

fn witness_state_line(
    config_path: &str,
    witness: Option<&Witness>,
    ttl: Option<&TtlSpec>,
    messages: &[UserMessage],
) -> String {
    let (Some(witness), Some(ttl)) = (witness, ttl) else {
        return format!(
            "no witness is configured; a person can add witness: {{ token, ttlMinutes }} to {config_path}, or make this change themselves"
        );
    };
    let open = format!(
        "a person can open this for {} minutes by sending the witness token alone on the first line of a message",
        witness.ttl_minutes
    );
    match witness_expired_at(ttl, messages) {
        Some(expired_at) => format!(
            "{open}; the last witness expired at {}",
            iso_utc(expired_at)
        ),
        None => open,
    }
}

/// An empty list is an axis the host does not have, so it registers nothing. The order is the
/// order of the rows one call leaves.
fn assemble(
    root: &Path,
    config: &Config,
    mutating: &[String],
    shell_tools: &[String],
    evidence_path: Option<&str>,
) -> Vec<Registration> {
    let mut registrations: Vec<Registration> = Vec::new();
    if !mutating.is_empty() {
        registrations.push(self_mod::registration(
            config.protected_paths.clone(),
            mutating.to_vec(),
        ));
    }
    if !shell_tools.is_empty() {
        registrations.push(shell_mod::registration(config.protected_paths.clone()));
    }
    if let Some(path) = evidence_path {
        let root = root.to_string_lossy();
        registrations.extend(transcript_mod::registration(
            path,
            &root,
            home_dir().as_deref(),
            mutating,
        ));
    }
    registrations.extend(discipline::registrations(&config.entries));
    registrations.push(shell_unjudgeable_registration());
    registrations
}

/// Judge every tool call as its own unit, so telemetry stays at one row per call.
fn judge_input(
    spec: &CheckSpec,
    settled: &Settled,
    input: &Input,
    tools: Option<&Tools>,
    session: Option<&Session>,
) -> Exit {
    let Settled {
        telemetry_path,
        config,
        config_path,
    } = settled;

    // One valve for every registration: a witness is a session-wide permission a human
    // granted. It exists only where a session does, since the valve reads human messages.
    let ttl = match (session, &config.witness) {
        (Some(_), Some(witness)) => {
            match TtlSpec::new(&witness.token, witness.ttl_minutes * 60_000.0) {
                Ok(ttl) => Some(ttl),
                Err(error) => return fail_closed(telemetry_path, &error, "", Exit::Blocked),
            }
        }
        _ => None,
    };
    let messages: &[UserMessage] = session.map_or(&[], |session| &session.user_messages);
    let valve = session.map(|_| Valve {
        ttl: ttl.as_ref(),
        messages,
    });

    let mutating = tools.map_or_else(
        || vec![STAGED_WRITE.to_string(), STAGED_DELETE.to_string()],
        |tools| tools.mutating.clone(),
    );
    let no_names: &[String] = &[];
    let (shell_tools, command_args) = tools.map_or((no_names, no_names), |tools| {
        (tools.shell.as_slice(), tools.command_args.as_slice())
    });
    let evidence_path = session.and_then(|session| session.evidence_path.as_deref());
    let registrations = assemble(spec.root, config, &mutating, shell_tools, evidence_path);
    let files = match read_file_sources(spec.root, &config.entries) {
        Ok(files) => files,
        Err(error) => return fail_closed(telemetry_path, &error, "", Exit::Blocked),
    };
    let supply = Supply {
        root: spec.root,
        actor: input.actor.as_ref(),
        files: &files,
        sidecar: session.and_then(|session| session.sidecar.as_deref()),
        snapshot: session.map(|session| &session.snapshot),
    };

    let context = Context {
        enforce: spec.enforce,
        valve: valve.as_ref(),
        telemetry_path,
        shell_tools,
        command_args,
        supply: &supply,
    };
    let mut blocked = false;
    let mut valve_refused_a_block = false;
    let mut advised_count = 0;
    for call in &input.tool_calls {
        let verdicts = dispatch(call, &registrations, &context);
        blocked |= verdicts.iter().any(Verdict::is_blocked);
        valve_refused_a_block |= verdicts.iter().any(|verdict| verdict.valve_refused);
        advised_count += verdicts
            .iter()
            .filter(|verdict| verdict.event == Event::Advised)
            .count();
        // A call no registration routed leaves no row of its own, so the runner writes its pass.
        if verdicts.is_empty() {
            let subject = call
                .args
                .as_ref()
                .and_then(|args| args.get("file_path"))
                .and_then(Value::as_str)
                .unwrap_or("-");
            telemetry::append(telemetry_path, Event::Passed, "covenant-check", subject);
        }
    }

    // The token itself is never written: stderr reaches the agent the valve defends against.
    // A session with no human message is a host whose message evidence is not arriving, so
    // no token typed now would reach the valve and the line would mislead.
    if valve_refused_a_block && session.is_some_and(|session| session.user_message_count > 0) {
        eprintln!(
            "{}",
            witness_state_line(config_path, config.witness.as_ref(), ttl.as_ref(), messages)
        );
    }
    if advised_count > 0 {
        let outcome = if blocked {
            "commit blocked by another verdict"
        } else {
            "commit allowed"
        };
        eprintln!("covenant advisory: {advised_count} verdict(s) recorded as advised, {outcome}");
    }
    if blocked { Exit::Blocked } else { Exit::Uphold }
}

enum Repair {
    Loads(Config),
    Refused(String),
    NotThisCall,
}

/// The config a single call would leave behind: exactly one call whose evidence modifies the
/// discovered config file, starting from the bytes the loader read, with a `post` the loader
/// accepts. Requiring the pre to be those bytes keeps a partial view of the file out.
fn repairs(
    input: &Input,
    root: &Path,
    config_path: &str,
    source: &str,
    layer: Option<&LayerSource>,
) -> Repair {
    let [call] = input.tool_calls.as_slice() else {
        return Repair::NotThisCall;
    };
    let Some(change) = call.file_change.as_ref().and_then(Value::as_object) else {
        return Repair::NotThisCall;
    };
    let targets_config = change.get("kind").and_then(Value::as_str) == Some("modify")
        && change
            .get("path")
            .and_then(Value::as_str)
            .and_then(|path| relativize_for_scope(path, root))
            .is_some_and(|path| path == config_path)
        && change.get("pre").and_then(Value::as_str) == Some(source);
    let Some(post) = change
        .get("post")
        .and_then(Value::as_str)
        .filter(|_| targets_config)
    else {
        return Repair::NotThisCall;
    };
    match (parse_config_source(post, config_path, layer), layer) {
        (Ok(config), _) => Repair::Loads(config),
        (Err(error), Some(layer)) => Repair::Refused(format!("with layer {}: {error}", layer.path)),
        (Err(_), None) => Repair::NotThisCall,
    }
}

/// Whether an edit to the discovered config could be what makes this run load. With a layer,
/// only when the layer loads on its own and the discovered file fails on its own too: a file
/// that loads alone and clashes only with the layer is not the broken config the repair
/// path exists for.
fn repairs_the_config(
    spec: &CheckSpec,
    config_path: &str,
    source: &str,
    layer: Option<&LayerSource>,
) -> bool {
    if spec.config_layer.is_none() {
        return true;
    }
    layer.is_some_and(|layer| parse_layer_source(layer).is_ok())
        && parse_config_source(source, config_path, None).is_err()
}

/// While the discovered config does not load there is no assembly to judge against, so the
/// session surface admits one shape: a single call that rewrites that file into one that
/// loads. It lands as one `advised` row naming the config path, so the next call's baseline
/// comparison reads the change as explained. Everything else fails closed.
fn settle_load_failure(spec: &CheckSpec, failure: &LoadFailure) -> Exit {
    let LoadFailure {
        error,
        telemetry_path: provisional,
        stage,
    } = failure;
    let Stage::Parse {
        config_path,
        source,
        layer,
    } = stage
    else {
        return fail_closed(provisional, error, "", Exit::Blocked);
    };
    if spec.mode == Mode::Diff || !repairs_the_config(spec, config_path, source, layer.as_ref()) {
        return fail_closed(provisional, error, "", Exit::Blocked);
    }
    let Ok(input) = read_input(spec) else {
        return fail_closed(provisional, error, "", Exit::Blocked);
    };

    match repairs(&input, spec.root, config_path, source, layer.as_ref()) {
        Repair::Loads(config) => {
            telemetry::append(
                &telemetry_path(spec, &config.log_path),
                Event::Advised,
                "covenant-check",
                config_path,
            );
            eprintln!(
                "covenant check: {config_path} does not load ({error}) — this call rewrites it into one that does; advised, not judged"
            );
            Exit::Uphold
        }
        Repair::Refused(refusal) => {
            let suffix = format!(
                " — fix {config_path} in one Edit or Write whose result loads; every other call stays blocked until it does (this call's result does not load {refusal})"
            );
            fail_closed(provisional, error, &suffix, Exit::Blocked)
        }
        Repair::NotThisCall => {
            let suffix = format!(
                " — fix {config_path} in one Edit or Write whose result loads; every other call stays blocked until it does"
            );
            fail_closed(provisional, error, &suffix, Exit::Blocked)
        }
    }
}

/// Judge one observation of the root exactly as the session surface would. An input with no
/// tool calls is an explicit pass with no rows.
///
/// An input carrying a session is one call of a live agent session, so the baseline
/// comparison wraps the judgment: it runs first, reading the window the previous call left,
/// and the re-establishment runs last. Both are fail-open, because a mechanism whose purpose
/// is to record may never reach an exit code.
pub fn run_covenant_check(spec: &CheckSpec) -> Exit {
    let settled = match settle_config(spec) {
        Ok(settled) => settled,
        Err(failure) => return settle_load_failure(spec, &failure),
    };
    let telemetry_path = &settled.telemetry_path;

    let input = match read_input(spec) {
        Ok(input) => input,
        Err(error) => return fail_closed(telemetry_path, &error, "", Exit::InputUnreadable),
    };
    let (tools, session) = match assert_judgeable_shape(&input) {
        Ok(shape) => shape,
        Err(error) => return fail_closed(telemetry_path, &error, "", Exit::InputUnreadable),
    };

    let entries = &settled.config.protected_paths;
    // A session call with nothing judgeable still compares and re-establishes: the window it
    // opens is what the next call reads.
    if session.is_some() {
        baseline::compare(spec.root, telemetry_path, entries);
    }
    let exit = if input.tool_calls.is_empty() {
        Exit::Uphold
    } else {
        judge_input(spec, &settled, &input, tools.as_ref(), session.as_ref())
    };
    if session.is_some() {
        #[expect(
            clippy::let_underscore_must_use,
            reason = "fail-open: an unwritable baseline costs the next call's detection, never this verdict"
        )]
        let _ = baseline::update(spec.root, entries);
    }
    exit
}
