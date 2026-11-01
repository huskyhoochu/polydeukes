//! Session evidence read from the files the host keeps beside a call: the conversation
//! transcript, one transcript per subagent, and the subagent spawn records.

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};

struct Transcript {
    user_messages: Vec<Value>,
    tool_calls: Vec<Value>,
}

enum Caller {
    Main,
    Subagent(String),
    /// A subagent call whose id cannot be joined into a file name.
    Unusable,
}

/// The IR's `session` value for a payload, `None` when the payload names no transcript. An
/// unreadable transcript keeps the evidence path with empty lists, so the judge still protects
/// the file while nothing in it can open a witness valve.
pub fn evidence(payload: &Map<String, Value>) -> Result<Option<Value>, String> {
    let Some(evidence_path) = payload.get("transcript_path").and_then(Value::as_str) else {
        return Ok(None);
    };
    let sidecar = sidecar(evidence_path)?;
    let (user_messages, tool_calls) = match read_transcript(Path::new(evidence_path)) {
        None => (Vec::new(), Vec::new()),
        Some(main) => {
            let calls = match caller(payload) {
                Caller::Main => main.tool_calls,
                Caller::Subagent(id) => {
                    let file = session_dir(Path::new(evidence_path))
                        .join("subagents")
                        .join(format!("agent-{id}.jsonl"));
                    read_transcript(&file)
                        .map(|own| own.tool_calls)
                        .unwrap_or_default()
                }
                Caller::Unusable => Vec::new(),
            };
            (main.user_messages, calls)
        }
    };
    let mut session = Map::new();
    session.insert("evidencePath".to_owned(), Value::from(evidence_path));
    session.insert("userMessages".to_owned(), Value::Array(user_messages));
    session.insert("toolCalls".to_owned(), Value::Array(tool_calls));
    if let Some(records) = sidecar {
        session.insert("channels".to_owned(), json!({ "sidecar": records }));
    }
    Ok(Some(Value::Object(session)))
}

fn caller(payload: &Map<String, Value>) -> Caller {
    match payload.get("agent_id") {
        None => Caller::Main,
        Some(Value::String(id)) if id.is_empty() => Caller::Main,
        Some(Value::String(id))
            if id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-') =>
        {
            Caller::Subagent(id.clone())
        }
        Some(_) => Caller::Unusable,
    }
}

/// `<dir>/<session id>` for a transcript at `<dir>/<session id>.jsonl`.
fn session_dir(transcript: &Path) -> PathBuf {
    let name = transcript
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let id = name.strip_suffix(".jsonl").unwrap_or(&name);
    transcript.parent().unwrap_or(Path::new("")).join(id)
}

/// The spawn records as JSON array text. `None` is no channel at all, which differs from `[]`:
/// a channel that observed no spawn.
fn sidecar(transcript: &str) -> Result<Option<String>, String> {
    let transcript = Path::new(transcript);
    // A relative spelling would resolve against the hook's working directory, where a checked-out
    // directory could pass its records off as this session's.
    if !transcript.is_absolute() {
        return Ok(None);
    }
    let dir = session_dir(transcript).join("subagents");
    let listing = match fs::read_dir(&dir) {
        Ok(listing) => listing,
        Err(error) if matches!(error.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory) => {
            return Ok(None);
        }
        Err(error) => return Err(format!("cannot read {}: {error}", dir.display())),
    };
    let mut names = Vec::new();
    for entry in listing {
        let entry = entry.map_err(|error| format!("cannot read {}: {error}", dir.display()))?;
        let is_file = entry
            .file_type()
            .map_err(|error| format!("cannot read {}: {error}", dir.display()))?
            .is_file();
        if let Ok(name) = entry.file_name().into_string()
            && is_file
            && name.starts_with("agent-")
            && name.ends_with(".meta.json")
        {
            names.push(name);
        }
    }
    names.sort();
    let mut records = Vec::new();
    for name in names {
        let file = dir.join(name);
        let bytes = match fs::read(&file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("cannot read {}: {error}", file.display())),
        };
        // A record the host wrote half-way is one fewer record, not a failed channel.
        if let Ok(record) = serde_json::from_slice::<Value>(&bytes) {
            records.push(record);
        }
    }
    serde_json::to_string(&records)
        .map(Some)
        .map_err(|error| error.to_string())
}

/// `None` when the file cannot be read, which is not the same fact as an empty transcript.
fn read_transcript(path: &Path) -> Option<Transcript> {
    let text = String::from_utf8_lossy(&fs::read(path).ok()?).into_owned();
    let mut user_messages = Vec::new();
    let mut calls: Vec<(Value, Option<String>)> = Vec::new();
    let mut outcomes: HashMap<String, bool> = HashMap::new();
    for line in text.split('\n') {
        let Ok(Value::Object(entry)) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        user_messages.extend(user_message(&entry));
        calls.extend(tool_calls(&entry));
        for (id, succeeded) in tool_results(&entry) {
            // The first result for an id wins.
            outcomes.entry(id).or_insert(succeeded);
        }
    }
    let tool_calls = calls
        .into_iter()
        .map(|(mut call, id)| {
            let succeeded = id.is_some_and(|id| outcomes.get(&id) == Some(&true));
            if let Value::Object(call) = &mut call {
                call.insert("succeeded".to_owned(), Value::Bool(succeeded));
            }
            call
        })
        .collect();
    Some(Transcript {
        user_messages,
        tool_calls,
    })
}

/// A human utterance: positively identified by `origin.kind` and a plain-text content. Any other
/// entry that merely has the `user` type is not human.
fn user_message(entry: &Map<String, Value>) -> Option<Value> {
    if entry.get("type").and_then(Value::as_str) != Some("user") {
        return None;
    }
    let origin = entry.get("origin")?.get("kind")?.as_str()?;
    if origin != "human" {
        return None;
    }
    let text = entry.get("message")?.get("content")?.as_str()?;
    let mut message = Map::new();
    message.insert("text".to_owned(), Value::from(text));
    // A missing timestamp stays missing: a made-up one could make an old message look fresh.
    if let Some(stamp) = entry
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(parse_instant)
    {
        message.insert("timestampMs".to_owned(), Value::from(stamp));
    }
    Some(Value::Object(message))
}

/// Every `tool_use` block of an assistant entry, with the id its result will reference.
fn tool_calls(entry: &Map<String, Value>) -> Vec<(Value, Option<String>)> {
    if entry.get("type").and_then(Value::as_str) != Some("assistant") {
        return Vec::new();
    }
    let Some(Value::Array(blocks)) = entry.get("message").and_then(|m| m.get("content")) else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter_map(|block| {
            if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                return None;
            }
            let name = block.get("name")?.as_str()?;
            let args = match block.get("input") {
                Some(input @ Value::Object(_)) => input.clone(),
                _ => json!({}),
            };
            let id = block.get("id").and_then(Value::as_str).map(str::to_owned);
            Some((json!({ "name": name, "args": args }), id))
        })
        .collect()
}

/// The call id and success of each `tool_result` block of a user entry. Success is enumerated:
/// no error marker, or a marker of exactly `false`.
fn tool_results(entry: &Map<String, Value>) -> Vec<(String, bool)> {
    if entry.get("type").and_then(Value::as_str) != Some("user") {
        return Vec::new();
    }
    let Some(Value::Array(blocks)) = entry.get("message").and_then(|m| m.get("content")) else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter_map(|block| {
            if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                return None;
            }
            let id = block.get("tool_use_id")?.as_str()?;
            let succeeded = matches!(block.get("is_error"), None | Some(Value::Bool(false)));
            Some((id.to_owned(), succeeded))
        })
        .collect()
}

/// Milliseconds since the epoch for `YYYY-MM-DD` (UTC) or `YYYY-MM-DDTHH:MM[:SS[.fff]]` followed by
/// `Z` or a `+HH:MM` / `-HH:MM` offset. A time with no offset depends on the local zone and is
/// not read.
fn parse_instant(text: &str) -> Option<i64> {
    let (date, time) = match text.split_once('T') {
        Some((date, time)) => (date, Some(time)),
        None => (text, None),
    };
    let mut parts = date.split('-');
    let year = digits(parts.next()?, 4)?;
    let month = digits(parts.next()?, 2)?;
    let day = digits(parts.next()?, 2)?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (clock, offset) = match time {
        None => (0, 0),
        Some(time) => clock_and_offset(time)?,
    };
    Some(days_from_civil(year, month, day) * 86_400_000 + clock - offset)
}

fn clock_and_offset(time: &str) -> Option<(i64, i64)> {
    let (clock, offset) = if let Some(clock) = time.strip_suffix('Z') {
        (clock, 0)
    } else {
        let at = time.rfind(['+', '-'])?;
        let (clock, zone) = time.split_at(at);
        let (sign, zone) = zone.split_at(1);
        let (hours, minutes) = zone.split_once(':')?;
        let minutes = digits(hours, 2)? * 60 + digits(minutes, 2)?;
        (clock, if sign == "-" { -minutes } else { minutes } * 60_000)
    };
    let mut fields = clock.split(':');
    let hours = digits(fields.next()?, 2)?;
    let minutes = digits(fields.next()?, 2)?;
    let (seconds, fraction) = match fields.next() {
        None => (0, 0),
        Some(field) => {
            let (whole, fraction) = field.split_once('.').unwrap_or((field, ""));
            let millis: String = fraction.chars().chain("000".chars()).take(3).collect();
            (digits(whole, 2)?, digits(&millis, 3)?)
        }
    };
    if fields.next().is_some() || hours > 24 || minutes > 59 || seconds > 59 {
        return None;
    }
    Some((
        ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction,
        offset,
    ))
}

/// A run of exactly `width` ASCII digits as a number.
fn digits(text: &str, width: usize) -> Option<i64> {
    if text.len() == width && text.bytes().all(|byte| byte.is_ascii_digit()) {
        text.parse().ok()
    } else {
        None
    }
}

/// Days from 1970-01-01 to a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
