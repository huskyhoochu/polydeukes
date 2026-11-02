//! Turns one `PreToolUse` payload into the input the judge reads, or says why it cannot.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};

use crate::file_change::{self, FileChange};
use crate::paths::{canonical, canonical_target, name_below, relative, resolve};
use crate::session;

/// Any of these set to `true` means the host cut the payload short.
const TRUNCATION_KEYS: [&str; 5] = [
    "truncated",
    "toolInputTruncated",
    "tool_input_truncated",
    "inputTruncated",
    "input_truncated",
];

/// A tool absent from this list is judged by nobody: removing an entry that looks unused stops
/// judging that tool.
const MUTATING_TOOLS: [&str; 4] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const SHELL_TOOLS: [&str; 1] = ["Bash"];
const COMMAND_ARGS: [&str; 1] = ["command"];

/// The judge's input for the payload bytes. `root` is where a payload without its own `cwd`
/// starts and what a shell call's `cwd` is made relative to.
pub fn translate(raw: &[u8], root: &Path) -> Result<Value, String> {
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
    if payload.get("hook_event_name").and_then(Value::as_str) != Some("PreToolUse") {
        return Err("unsupported hook event".to_owned());
    }

    let Some(tool) = payload.get("tool_name").and_then(Value::as_str) else {
        return Err(classification("payload is missing a string tool_name"));
    };
    let Some(tool_input) = payload.get("tool_input").and_then(Value::as_object) else {
        return Err(classification(
            "payload is missing a non-null object tool_input",
        ));
    };
    let actor = match payload.get("agent_type") {
        Some(Value::String(kind)) if !kind.is_empty() => json!({ "agentType": kind }),
        _ => json!({}),
    };
    let cwd = match payload.get("cwd") {
        None => root.to_path_buf(),
        Some(Value::String(cwd)) => PathBuf::from(cwd),
        Some(_) => return Err("payload cwd must be a string".to_owned()),
    };
    let base = canonical(&cwd)?;

    let mut tool_calls = Vec::new();
    let mut spawns = Vec::new();
    if tool == "Task" {
        let Some(kind) = tool_input.get("subagent_type").and_then(Value::as_str) else {
            return Err(classification(
                "Task payload is missing a string subagent_type",
            ));
        };
        spawns.push(json!({ "kind": kind }));
    } else {
        let mut call = Map::new();
        call.insert("name".to_owned(), Value::from(tool));
        call.insert("args".to_owned(), Value::Object(tool_input.clone()));
        let change = file_change::collect(tool, tool_input, &base)?;
        tool_calls = shape_calls(call, tool, change, &base, root)?;
    }

    let session = session::evidence(&payload)?;
    let mut ir = Map::new();
    ir.insert("toolCalls".to_owned(), Value::Array(tool_calls));
    ir.insert("subagentSpawns".to_owned(), Value::Array(spawns));
    ir.insert("userMessages".to_owned(), Value::Array(Vec::new()));
    ir.insert("actor".to_owned(), actor);
    if let Some(session) = session {
        ir.insert("session".to_owned(), session);
    }
    ir.insert(
        "tools".to_owned(),
        json!({
            "mutating": MUTATING_TOOLS,
            "shell": SHELL_TOOLS,
            "commandArgs": COMMAND_ARGS,
        }),
    );
    Ok(Value::Object(ir))
}

fn classification(reason: &str) -> String {
    format!("payload at index 0 failed classification: {reason}")
}

/// The call as the judge sees it: one call per name the target is known by, and a shell call
/// carries its working directory relative to the project root.
fn shape_calls(
    call: Map<String, Value>,
    tool: &str,
    change: Option<FileChange>,
    base: &Path,
    root: &Path,
) -> Result<Vec<Value>, String> {
    let mut calls = Vec::new();
    match change {
        None => calls.push(call),
        Some(change) => {
            for path in target_paths(&change.path, base, root)? {
                let mut named = call.clone();
                named.insert("fileChange".to_owned(), change.to_value(&path));
                calls.push(named);
            }
        }
    }
    if SHELL_TOOLS.contains(&tool) {
        let from_root = relative(&canonical(root)?, base);
        let from_root = if from_root.is_empty() {
            ".".to_owned()
        } else {
            from_root
        };
        for call in &mut calls {
            call.insert("cwd".to_owned(), Value::from(from_root.as_str()));
        }
    }
    Ok(calls.into_iter().map(Value::Object).collect())
}

/// The names a write target is judged under: the spelled one, and the real one when a link
/// makes it differ.
fn target_paths(path: &str, base: &Path, root: &Path) -> Result<Vec<String>, String> {
    let real_root = canonical(root)?;
    let absolute = resolve(&base.join(path))?;
    let spelled = name_below(&absolute, &real_root);
    let Some(real) = canonical_target(&absolute)? else {
        return Ok(vec![spelled]);
    };
    let real_name = name_below(&real, &real_root);
    Ok(if real_name == spelled {
        vec![spelled]
    } else {
        vec![spelled, real_name]
    })
}
