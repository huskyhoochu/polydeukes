//! Adapter-owned lifecycle evidence for one Codex session: one JSONL file per session or agent.

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

/// The file for one session identity, named by the hash of the identity so that a host-supplied id
/// never becomes a path.
pub fn path(root: &Path, identity: &str) -> PathBuf {
    let name: String = Sha256::digest(identity.as_bytes())
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 15])
        .filter_map(|nibble| char::from_digit(u32::from(nibble), 16))
        .collect();
    root.join(".polydeukes")
        .join("codex-sessions")
        .join(format!("{name}.jsonl"))
}

/// Append one record in receive order.
pub fn append(path: &Path, record: &Value) -> Result<(), String> {
    let failed = |error: std::io::Error| format!("session evidence could not be written ({error})");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(failed)?;
    }
    let mut file = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(path)
        .map_err(failed)?;
    file.write_all(format!("{record}\n").as_bytes())
        .map_err(failed)
}

/// Remove one session's file; an already absent file is a successful cleanup.
pub fn remove(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != ErrorKind::NotFound => {
            Err(format!("session evidence could not be removed ({error})"))
        }
        _ => Ok(()),
    }
}

/// Read the file strictly into the IR's `session`. A missing file is an empty history; a user
/// line is checked for its shape but never reaches the IR, because a Codex prompt is not human
/// evidence.
pub fn read(path: &Path) -> Result<Value, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => Vec::new(),
        Err(error) => {
            return Err(format!(
                "session evidence JSONL could not be read ({error})"
            ));
        }
    };
    let source = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = source.split('\n').collect();
    let mut tool_calls = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let number = index + 1;
        if line.is_empty() && number == lines.len() {
            continue;
        }
        if line.trim().is_empty() {
            return Err(format!("session evidence JSONL record {number} is blank"));
        }
        let value: Value = serde_json::from_str(line).map_err(|error| {
            format!("session evidence JSONL record {number} is invalid ({error})")
        })?;
        if let Some(call) = parse_record(&value, number)? {
            tool_calls.push(call);
        }
    }
    Ok(json!({
        "evidencePath": path.to_string_lossy(),
        "userMessages": [],
        "toolCalls": tool_calls,
    }))
}

fn has_only(record: &Map<String, Value>, keys: &[&str]) -> bool {
    record.len() == keys.len() && keys.iter().all(|key| record.contains_key(*key))
}

/// The tool call a record carries, `None` for a well-formed user record.
fn parse_record(value: &Value, number: usize) -> Result<Option<Value>, String> {
    let Some(record) = value.as_object() else {
        return Err(format!(
            "session evidence record {number} is not an object with a kind"
        ));
    };
    let Some(kind) = record.get("kind").and_then(Value::as_str) else {
        return Err(format!(
            "session evidence record {number} is not an object with a kind"
        ));
    };
    let user = kind == "user"
        && has_only(record, &["kind", "text", "timestampMs"])
        && record.get("text").is_some_and(Value::is_string)
        && record.get("timestampMs").is_some_and(Value::is_number);
    if user {
        return Ok(None);
    }
    let tool = kind == "tool"
        && (has_only(record, &["kind", "name"])
            || has_only(record, &["kind", "name", "args"])
            || has_only(record, &["kind", "name", "args", "succeeded"]))
        && record.get("name").is_some_and(Value::is_string)
        && record.get("args").is_none_or(Value::is_object)
        && record.get("succeeded").is_none_or(Value::is_boolean);
    if tool {
        let mut call = Map::new();
        for key in ["name", "args", "succeeded"] {
            if let Some(field) = record.get(key) {
                call.insert(key.to_owned(), field.clone());
            }
        }
        return Ok(Some(Value::Object(call)));
    }
    Err(format!(
        "session evidence record {number} has an invalid {kind} shape"
    ))
}
