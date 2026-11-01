//! Turns one Codex hook event into the input the judge reads, records a lifecycle event, or says
//! why it cannot.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};

use crate::apply_patch;
use crate::evidence;
use crate::paths::{canonical, canonical_target, name_below, relative, resolve};

/// Any of these set to `true` means the host cut the payload short.
const TRUNCATION_KEYS: [&str; 5] = [
    "truncated",
    "toolInputTruncated",
    "tool_input_truncated",
    "inputTruncated",
    "input_truncated",
];

/// A tool absent from these lists is judged by nobody: removing an entry that looks unused stops
/// judging that tool.
const MUTATING_TOOLS: [&str; 1] = ["apply_patch"];
const SHELL_TOOLS: [&str; 1] = ["Bash"];
const COMMAND_ARGS: [&str; 1] = ["command"];

/// The judge's input for a `PreToolUse` event, `None` for a lifecycle event that was recorded and
/// needs no judgment. `root` is the project the evidence files and shell `cwd`s belong to.
pub fn translate(raw: &[u8], root: &Path) -> Result<Option<Value>, String> {
    let text =
        std::str::from_utf8(raw).map_err(|error| format!("payload is not valid UTF-8: {error}"))?;
    let Value::Object(payload) =
        serde_json::from_str::<Value>(text).map_err(|error| error.to_string())?
    else {
        return Err("payload must be an object".to_owned());
    };
    if TRUNCATION_KEYS
        .iter()
        .any(|key| payload.get(*key) == Some(&Value::Bool(true)))
    {
        return Err("host payload is truncated".to_owned());
    }
    let Some(session_id) = nonempty(payload.get("session_id")) else {
        return Err("payload session_id must be a nonempty string".to_owned());
    };
    let identity = match payload.get("agent_id") {
        None => session_id.to_owned(),
        Some(agent) => {
            let Some(agent_id) = nonempty(Some(agent)) else {
                return Err("payload agent_id must be a nonempty string".to_owned());
            };
            json!([session_id, agent_id]).to_string()
        }
    };
    let file = evidence::path(root, &identity);
    match payload.get("hook_event_name").and_then(Value::as_str) {
        Some("SessionEnd") => {
            evidence::remove(&file)?;
            Ok(None)
        }
        Some("PostToolUse") => {
            record_tool(&payload, &file)?;
            Ok(None)
        }
        Some("PreToolUse") => pre_tool_use(&payload, &file, root).map(Some),
        _ => Err("unsupported hook event".to_owned()),
    }
}

fn nonempty(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

fn record_tool(payload: &Map<String, Value>, file: &Path) -> Result<(), String> {
    let (Some(name), Some(args)) = (
        payload.get("tool_name").and_then(Value::as_str),
        payload.get("tool_input").filter(|input| input.is_object()),
    ) else {
        return Err("post-tool payload must name a tool and object input".to_owned());
    };
    // A corrupt file is reported now rather than buried under another line.
    evidence::read(file)?;
    let mut record = Map::new();
    record.insert("kind".to_owned(), Value::from("tool"));
    record.insert("name".to_owned(), Value::from(name));
    record.insert("args".to_owned(), args.clone());
    if let Some(success) = payload
        .get("success")
        .filter(|success| success.is_boolean())
    {
        record.insert("succeeded".to_owned(), success.clone());
    }
    evidence::append(file, &Value::Object(record))
}

fn pre_tool_use(payload: &Map<String, Value>, file: &Path, root: &Path) -> Result<Value, String> {
    let input = payload.get("tool_input").and_then(Value::as_object);
    let (Some(cwd), Some(tool), Some(input), Some(command)) = (
        payload.get("cwd").and_then(Value::as_str),
        payload.get("tool_name").and_then(Value::as_str),
        input,
        input
            .and_then(|input| input.get("command"))
            .and_then(Value::as_str),
    ) else {
        return Err("invalid pre-tool envelope".to_owned());
    };
    let patch = MUTATING_TOOLS.contains(&tool);
    if !patch && !SHELL_TOOLS.contains(&tool) {
        return Err(format!("unsupported tool {tool}"));
    }
    let session = evidence::read(file)?;
    let tool_calls = if patch {
        patch_calls(tool, command, cwd, root)?
    } else {
        let from_root = relative(&canonical(root)?, &canonical(Path::new(cwd))?);
        let from_root = if from_root.is_empty() {
            ".".to_owned()
        } else {
            from_root
        };
        vec![json!({ "name": tool, "args": input, "cwd": from_root })]
    };
    Ok(json!({
        "toolCalls": tool_calls,
        "subagentSpawns": [],
        "userMessages": [],
        "session": session,
        "tools": {
            "mutating": MUTATING_TOOLS,
            "shell": SHELL_TOOLS,
            "commandArgs": COMMAND_ARGS,
        },
    }))
}

/// One call per file change per name the target is known by.
fn patch_calls(tool: &str, command: &str, cwd: &str, root: &Path) -> Result<Vec<Value>, String> {
    let base = canonical(Path::new(cwd))?;
    let changes = apply_patch::parse(command, |path| {
        let full = if Path::new(path).is_absolute() {
            PathBuf::from(path)
        } else {
            resolve(&base.join(path))?
        };
        read_pre(&full)
    })?;
    let real_root = canonical(root)?;
    let mut calls = Vec::new();
    for mut change in changes {
        if change.kind == "create"
            && let Some(pre) = read_pre(&resolve(&base.join(&change.path))?)?
        {
            change.kind = "modify";
            change.pre = Some(pre);
        }
        for path in target_paths(&change.path, &base, &real_root)? {
            calls.push(json!({ "name": tool, "fileChange": change.to_value(&path) }));
        }
    }
    Ok(calls)
}

/// The file's text, `None` when it does not exist. Any other read failure fails the call.
fn read_pre(path: &Path) -> Result<Option<String>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(error) if matches!(error.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory) => {
            Ok(None)
        }
        Err(error) => Err(format!(
            "the pre-state of a patch target could not be read ({}: {error})",
            path.display()
        )),
    }
}

/// The names a patch target is judged under, relative to the project root: the spelled one, and
/// the real one when a link makes it differ.
fn target_paths(path: &str, base: &Path, real_root: &Path) -> Result<Vec<String>, String> {
    let absolute = resolve(&base.join(path))?;
    let spelled = name_below(&absolute, real_root);
    let Some(real) = canonical_target(&absolute)? else {
        return Ok(vec![spelled]);
    };
    let real_name = name_below(&real, real_root);
    Ok(if real_name == spelled {
        vec![spelled]
    } else {
        vec![spelled, real_name]
    })
}
