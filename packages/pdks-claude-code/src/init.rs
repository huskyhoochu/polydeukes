//! `init`: pin the judge and this executable by absolute path in `.claude/settings.json`,
//! protect the files that hold the registration, and write the generated documents.

use std::ffi::OsStr;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

use serde_json::{Map, Value, json};

use crate::paths::resolve;

const EVENTS: [&str; 4] = [
    "PreToolUse",
    "UserPromptSubmit",
    "PostToolUse",
    "SessionEnd",
];
const MATCHER: &str = "Edit|Write|MultiEdit|NotebookEdit|Bash";
const SETTINGS: &str = ".claude/settings.json";
const LOCAL_SETTINGS: &str = ".claude/settings.local.json";
const RULES_PATH: &str = ".claude/rules/polydeukes.md";
const SKILL_PATH: &str = ".claude/skills/discipline-draft/SKILL.md";
const RULES: &str = include_str!("rules.md");
const SKILL: &str = include_str!("skill.md");
const CONFIG_NAMES: [&str; 3] = [
    "polydeukes.config.yaml",
    "polydeukes.config.yml",
    "polydeukes.config.json",
];
const SELF_NAME: &str = "pdks-claude-code";

pub fn run(argv0: Option<&OsStr>) -> ExitCode {
    match init(argv0) {
        Ok(lines) => {
            let mut stdout = std::io::stdout().lock();
            for line in lines {
                writeln!(stdout, "{line}").ok();
            }
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}

fn failure(message: &str) -> String {
    format!("{SELF_NAME} init: {message}")
}

fn init(argv0: Option<&OsStr>) -> Result<Vec<String>, String> {
    let dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| {
            std::env::split_paths(&path)
                .filter(|dir| dir.is_absolute())
                .collect()
        })
        .unwrap_or_default();
    let pdks = find_on_path("pdks", &dirs)
        .ok_or_else(|| failure("no pdks executable on PATH; install pdks first"))?;
    let this = match argv0 {
        Some(arg) if arg.to_string_lossy().contains('/') => resolve(Path::new(arg))?,
        _ => find_on_path(SELF_NAME, &dirs)
            .ok_or_else(|| failure(&format!("no {SELF_NAME} executable on PATH")))?,
    };
    let root = std::env::current_dir()
        .map_err(|error| failure(&format!("cannot read the working directory: {error}")))?;

    // Planned before anything is written, so a settings file of the wrong shape stops init early.
    let (before, settings) = plan_settings(&root, &this, &pdks)?;
    let mut lines = run_pdks_init(&pdks, &root)?;
    lines.extend(protect_settings_files(&root)?);
    lines.push(write_settings(&root, before.as_deref(), &settings)?);
    for (path, text) in [(RULES_PATH, RULES), (SKILL_PATH, SKILL)] {
        lines.push(write_if_absent(&root, path, text)?);
    }
    Ok(lines)
}

fn find_on_path(name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter()
        .map(|dir| dir.join(name))
        .find(|candidate| is_executable_file(candidate))
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file())
}

/// The settings text before (if the file exists) and after this registration is merged in.
fn plan_settings(
    root: &Path,
    this: &Path,
    pdks: &Path,
) -> Result<(Option<String>, String), String> {
    let before = match fs::read_to_string(root.join(SETTINGS)) {
        Ok(text) => Some(text),
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => return Err(failure(&format!("cannot read {SETTINGS}: {error}"))),
    };
    let existing = match &before {
        None => Value::Object(Map::new()),
        Some(text) => serde_json::from_str(text)
            .map_err(|error| failure(&format!("{SETTINGS} is not valid JSON: {error}")))?,
    };
    let Value::Object(mut settings) = existing else {
        return Err(failure(&format!("{SETTINGS} must contain a JSON object")));
    };
    let Value::Object(hooks) = settings
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()))
    else {
        return Err(failure(&format!("{SETTINGS} must contain a hooks object")));
    };
    let registration = json!({
        "matcher": MATCHER,
        "hooks": [{
            "type": "command",
            "command": this.to_string_lossy(),
            "args": ["hook", "--project-root", root.to_string_lossy(), "--pdks", pdks.to_string_lossy()],
            "timeout": 60,
        }],
    });
    for event in EVENTS {
        let mut entries: Vec<Value> = match hooks.get(event) {
            None => Vec::new(),
            Some(Value::Array(entries)) => entries.iter().filter_map(without_owned).collect(),
            Some(_) => return Err(failure(&format!("{event} must be an array"))),
        };
        if event == "PreToolUse" {
            entries.push(registration.clone());
        }
        if entries.is_empty() {
            hooks.shift_remove(event);
        } else {
            hooks.insert(event.to_owned(), Value::Array(entries));
        }
    }
    let text = serde_json::to_string_pretty(&Value::Object(settings))
        .map_err(|error| failure(&error.to_string()))?;
    Ok((before, format!("{text}\n")))
}

/// The entry without the handlers this adapter or its 0.20.x predecessor registered; `None` when
/// that leaves it with no handler at all. An entry that never had handlers is kept as is.
fn without_owned(entry: &Value) -> Option<Value> {
    let Some(handlers) = entry.get("hooks").and_then(Value::as_array) else {
        return Some(entry.clone());
    };
    let siblings: Vec<Value> = handlers
        .iter()
        .filter(|handler| !is_owned(handler))
        .cloned()
        .collect();
    if siblings.is_empty() && !handlers.is_empty() {
        return None;
    }
    let mut kept = entry.clone();
    if let Some(slot) = kept.get_mut("hooks") {
        *slot = Value::Array(siblings);
    }
    Some(kept)
}

/// A handler is ours when its words end the way one of the two registrations we wrote ends.
fn is_owned(handler: &Value) -> bool {
    let Some(command) = handler.get("command").and_then(Value::as_str) else {
        return false;
    };
    let words: Vec<String> = match handler.get("args") {
        Some(Value::Array(args)) => {
            let mut words = vec![command.to_owned()];
            for arg in args {
                match arg.as_str() {
                    Some(arg) => words.push(arg.to_owned()),
                    None => return false,
                }
            }
            words
        }
        _ => match shell_words(command) {
            Some(words) => words,
            None => return false,
        },
    };
    if words.len() < 6 {
        return false;
    }
    let tail: Vec<&str> = words
        .iter()
        .rev()
        .take(5)
        .rev()
        .map(String::as_str)
        .collect();
    let absolute = |word: &str| Path::new(word).is_absolute();
    match (words.first(), tail.as_slice()) {
        (Some(first), ["adapter", "claude-code", "hook", "--project-root", root]) => {
            absolute(first) && absolute(root)
        }
        (Some(first), ["hook", "--project-root", root, "--pdks", pdks]) => {
            Path::new(first).file_name() == Some(OsStr::new(SELF_NAME))
                && absolute(root)
                && absolute(pdks)
        }
        _ => false,
    }
}

/// The words of a command made only of single-quoted words separated by one space, the form a
/// registration written as a shell string takes. `None` for anything else.
fn shell_words(command: &str) -> Option<Vec<String>> {
    let mut words = Vec::new();
    let mut rest = command;
    while !rest.is_empty() {
        rest = rest.strip_prefix('\'')?;
        let mut word = String::new();
        loop {
            if let Some(after) = rest.strip_prefix("'\"'\"'") {
                word.push('\'');
                rest = after;
            } else if let Some(after) = rest.strip_prefix('\'') {
                rest = after;
                break;
            } else {
                let next = rest.chars().next()?;
                word.push(next);
                rest = rest.strip_prefix(next)?;
            }
        }
        words.push(word);
        if !rest.is_empty() {
            rest = rest.strip_prefix(' ')?;
        }
    }
    Some(words)
}

/// Have `pdks` create the config and the telemetry ignore line when they are missing; returns the
/// non-empty lines it reported.
fn run_pdks_init(pdks: &Path, root: &Path) -> Result<Vec<String>, String> {
    let output = Command::new(pdks)
        .arg("init")
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| failure(&format!("cannot run {} init: {error}", pdks.display())))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(str::to_owned)
            .collect());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(if stderr.trim().is_empty() {
        failure(&format!("{} init failed", pdks.display()))
    } else {
        stderr.trim_end().to_owned()
    })
}

/// Add the two Claude settings files to the config's `protectedPaths`, leaving every other byte
/// of the config alone. Only an empty `[]` list and a block list are edited. Returns the report
/// line when the config was rewritten.
fn protect_settings_files(root: &Path) -> Result<Option<String>, String> {
    let wanted = [SETTINGS, LOCAL_SETTINGS];
    let name = CONFIG_NAMES
        .into_iter()
        .find(|name| root.join(name).is_file())
        .unwrap_or(CONFIG_NAMES[0]);
    let by_hand = || {
        failure(&format!(
            "add {SETTINGS} and {LOCAL_SETTINGS} to protectedPaths in {name}, then run init again"
        ))
    };
    let path = root.join(name);
    let text = fs::read_to_string(&path)
        .map_err(|error| failure(&format!("cannot read {name}: {error}")))?;
    let present = protected_paths(&text).ok_or_else(by_hand)?;
    let missing: Vec<&str> = wanted
        .into_iter()
        .filter(|path| !present.iter().any(|item| item == path))
        .collect();
    if missing.is_empty() {
        return Ok(None);
    }
    let edited = append_items(&text, &missing).ok_or_else(by_hand)?;
    let confirmed = protected_paths(&edited).is_some_and(|items| {
        wanted
            .iter()
            .all(|path| items.iter().any(|item| item == path))
    });
    if !confirmed {
        return Err(by_hand());
    }
    fs::write(&path, edited).map_err(|error| failure(&format!("cannot write {name}: {error}")))?;
    Ok(Some(format!("updated {name}")))
}

fn protected_paths(text: &str) -> Option<Vec<String>> {
    let config: Value = serde_saphyr::from_str(text).ok()?;
    match config.get("protectedPaths") {
        None | Some(Value::Null) => Some(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| item.as_str().map(str::to_owned))
            .collect(),
        Some(_) => None,
    }
}

/// The text with `- '<path>'` lines added to a top-level `protectedPaths` list that is either
/// `[]` or a block list.
fn append_items(text: &str, paths: &[&str]) -> Option<String> {
    let mut lines: Vec<String> = text.split('\n').map(str::to_owned).collect();
    let key = lines
        .iter()
        .position(|line| line.starts_with("protectedPaths:"))?;
    let value = lines
        .get(key)?
        .strip_prefix("protectedPaths:")?
        .trim()
        .to_owned();
    let (last, indent) = if value == "[]" {
        "protectedPaths:".clone_into(lines.get_mut(key)?);
        (key, "  ".to_owned())
    } else if value.is_empty() {
        let indent = item_indent(lines.get(key + 1)?)?.to_owned();
        let items = lines
            .iter()
            .skip(key + 1)
            .take_while(|line| item_indent(line) == Some(indent.as_str()))
            .count();
        (key + items, indent)
    } else {
        return None;
    };
    for (offset, path) in paths.iter().enumerate() {
        lines.insert(last + 1 + offset, format!("{indent}- '{path}'"));
    }
    Some(lines.join("\n"))
}

/// The leading whitespace of a block-list item line, `None` for any other line.
fn item_indent(line: &str) -> Option<&str> {
    let rest = line.trim_start();
    rest.starts_with("- ")
        .then(|| line.get(..line.len() - rest.len()))
        .flatten()
}

fn write_settings(root: &Path, before: Option<&str>, text: &str) -> Result<String, String> {
    if before == Some(text) {
        return Ok(format!("unchanged {SETTINGS}"));
    }
    write_file(&root.join(SETTINGS), text)?;
    Ok(format!(
        "{} {SETTINGS}",
        if before.is_none() {
            "created"
        } else {
            "updated"
        }
    ))
}

fn write_if_absent(root: &Path, relative: &str, text: &str) -> Result<String, String> {
    let path = root.join(relative);
    if path.exists() {
        return Ok(format!("unchanged {relative}"));
    }
    write_file(&path, text)?;
    Ok(format!("created {relative}"))
}

fn write_file(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| failure(&format!("cannot create {}: {error}", parent.display())))?;
    }
    fs::write(path, text)
        .map_err(|error| failure(&format!("cannot write {}: {error}", path.display())))
}
