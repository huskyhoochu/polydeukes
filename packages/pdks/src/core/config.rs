use regress::Regex;
use serde_json::{Map, Value};

use super::declaration::{Declaration, compile_declaration};
use super::protected_paths::normalize_protected_paths;
use super::validation::{is_non_empty_string, js_trim, reject_unknown_keys};

pub const DEFAULT_TELEMETRY_LOG_PATH: &str = ".polydeukes/roi.log";

pub const DISCIPLINE_LISTS: [&str; 3] =
    ["disciplines", "sessionDisciplines", "changeSetDisciplines"];

const LAYER_LISTS: &str =
    "a config layer carries only disciplines, sessionDisciplines, changeSetDisciplines";

const TOP_LEVEL_KEYS: [&str; 9] = [
    "$schema",
    "protectedPaths",
    "adapters",
    "memory",
    "telemetry",
    "disciplines",
    "sessionDisciplines",
    "changeSetDisciplines",
    "witness",
];

pub struct Witness {
    pub token: String,
    pub ttl_minutes: f64,
}

/// An entry's own rung: `Advise` records a break without stopping it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Advise,
    Block,
}

/// One judged discipline entry with its declaration compiled.
#[derive(Clone)]
pub struct Entry {
    pub id: String,
    pub why: Option<String>,
    pub level: Level,
    pub declaration: Declaration,
}

/// Which observation a judgment is: one call of a live session, or a finished change set.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Session,
    ChangeSet,
}

/// A validated config. `memory` and `adapters` are checked and not kept: this judge reads
/// neither. Each surface's entries are the shared `disciplines` first, then its own list.
pub struct Config {
    pub protected_paths: Vec<String>,
    pub log_path: String,
    pub witness: Option<Witness>,
    session_entries: Vec<Entry>,
    change_set_entries: Vec<Entry>,
}

impl Config {
    /// The entries a surface judges, in config order.
    pub fn entries(&self, surface: Surface) -> &[Entry] {
        match surface {
            Surface::Session => &self.session_entries,
            Surface::ChangeSet => &self.change_set_entries,
        }
    }
}

/// The labels the judging chain's own registrations write rows under.
const RESERVED_LABELS: [&str; 6] = [
    "self-mod",
    "shell-mod",
    "transcript-mod",
    "covenant-check",
    "shell-unjudgeable",
    "baseline",
];

/// One problem as its own text; several as a count and one indented line each.
fn list_problems(problems: &[String]) -> String {
    match problems {
        [only] => only.clone(),
        _ => format!(
            "{} problems\n{}",
            problems.len(),
            problems
                .iter()
                .map(|problem| format!("  - {problem}"))
                .collect::<Vec<_>>()
                .join("\n")
        ),
    }
}

pub fn define_config(config: &Value) -> Result<Config, String> {
    let Some(config) = config.as_object() else {
        return Err("config must be a plain object".to_string());
    };
    reject_unknown_keys(config, &TOP_LEVEL_KEYS, "config")?;
    if config
        .get("$schema")
        .is_some_and(|schema| !schema.is_string())
    {
        return Err("$schema must be a string".to_string());
    }

    let protected_paths = match config.get("protectedPaths") {
        Some(value) => validate_protected_paths(value)?,
        None => Vec::new(),
    };
    if let Some(adapters) = config.get("adapters") {
        validate_adapters(adapters)?;
    }
    if let Some(memory) = config.get("memory") {
        validate_memory(memory)?;
    }
    let mut seen_ids: Vec<String> = Vec::new();
    let mut problems: Vec<String> = Vec::new();
    let mut session_entries: Vec<Entry> = Vec::new();
    let mut change_set_entries: Vec<Entry> = Vec::new();
    for list in DISCIPLINE_LISTS {
        if let Some(value) = config.get(list) {
            let judged = validate_entries(value, list, &mut seen_ids, &mut problems)?;
            match list {
                "disciplines" => {
                    session_entries.extend(judged.clone());
                    change_set_entries.extend(judged);
                }
                "sessionDisciplines" => session_entries.extend(judged),
                _ => change_set_entries.extend(judged),
            }
        }
    }
    let log_path = match config.get("telemetry") {
        Some(value) => validate_telemetry(value)?,
        None => None,
    };
    let witness = match config.get("witness") {
        Some(value) => Some(validate_witness(value)?),
        None => None,
    };

    if !problems.is_empty() {
        return Err(list_problems(&problems));
    }
    Ok(Config {
        protected_paths,
        log_path: log_path.unwrap_or_else(|| DEFAULT_TELEMETRY_LOG_PATH.to_string()),
        witness,
        session_entries,
        change_set_entries,
    })
}

/// A second discipline file: its three lists only, as given and only those present.
pub fn define_config_layer(layer: &Value) -> Result<Map<String, Value>, String> {
    let Some(layer) = layer.as_object() else {
        return Err(format!(
            "config layer must be a plain object: {LAYER_LISTS}"
        ));
    };
    for key in layer.keys() {
        if key != "$schema" && !DISCIPLINE_LISTS.contains(&key.as_str()) {
            return Err(format!(
                "unknown key '{key}' in config layer: {LAYER_LISTS}"
            ));
        }
    }
    if layer
        .get("$schema")
        .is_some_and(|schema| !schema.is_string())
    {
        return Err("$schema must be a string".to_string());
    }
    // The layer's own entries are checked here so a fault in one is reported against the layer
    // file, not against the merged config.
    let mut lists = Map::new();
    let (mut seen_ids, mut problems) = (Vec::new(), Vec::new());
    for list in DISCIPLINE_LISTS {
        if let Some(entries) = layer.get(list) {
            validate_entries(entries, list, &mut seen_ids, &mut problems)?;
            lists.insert(list.to_string(), entries.clone());
        }
    }
    if !problems.is_empty() {
        return Err(list_problems(&problems));
    }
    Ok(lists)
}

fn validate_array<'a>(entries: &'a Value, list: &str) -> Result<&'a Vec<Value>, String> {
    entries
        .as_array()
        .ok_or_else(|| format!("{list} must be an array"))
}

/// Validate one discipline list and compile its judged entries. A declaration that does not
/// compile is a problem collected for the one invalid-config message; a malformed entry head
/// stops the load. `seen_ids` spans the three lists.
fn validate_entries(
    value: &Value,
    list: &str,
    seen_ids: &mut Vec<String>,
    problems: &mut Vec<String>,
) -> Result<Vec<Entry>, String> {
    let mut judged = Vec::new();
    for (index, entry) in validate_array(value, list)?.iter().enumerate() {
        let Some(entry) = entry.as_object() else {
            return Err(format!("{list}[{index}] must be an object"));
        };
        let Some(id) = entry
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            return Err(format!("{list}[{index}].id must be a non-empty string"));
        };
        let location = format!("{list}[{index}] ('{id}')");
        if seen_ids.iter().any(|seen| seen == id) {
            return Err(format!("{location} duplicates the id of an earlier entry"));
        }
        if RESERVED_LABELS.contains(&id) {
            return Err(format!("{location} id collides with a meta-covenant label"));
        }
        seen_ids.push(id.to_string());
        if entry.contains_key("draft") {
            validate_draft(entry, list, &location)?;
            continue;
        }
        reject_unknown_keys(entry, &["id", "why", "enforce", "declare"], &location)?;
        if entry.get("why").is_some_and(|why| !why.is_string()) {
            return Err(format!("{location} why must be a string"));
        }
        let level = match entry.get("enforce").map(Value::as_str) {
            None | Some(Some("advise")) => Level::Advise,
            Some(Some("block")) => Level::Block,
            Some(_) => return Err(format!("{location} enforce must be 'block' or 'advise'")),
        };
        let Some(block) = entry.get("declare").and_then(Value::as_object) else {
            return Err(format!("{location} declare must be an object"));
        };
        let declaration = match compile_declaration(id, block) {
            Ok(declaration) => declaration,
            Err(fault) => {
                problems.push(fault.to_string());
                continue;
            }
        };
        if let Err(problem) = check_placement(&declaration, list, &location) {
            problems.push(problem);
            continue;
        }
        judged.push(Entry {
            id: id.to_string(),
            why: entry.get("why").and_then(Value::as_str).map(str::to_string),
            level,
            declaration,
        });
    }
    Ok(judged)
}

fn validate_draft(entry: &Map<String, Value>, list: &str, location: &str) -> Result<(), String> {
    if list != "disciplines" {
        return Err(format!("{location} a draft belongs in disciplines"));
    }
    if let Some(key) = entry
        .keys()
        .find(|key| !["id", "why", "draft"].contains(&key.as_str()))
    {
        return Err(format!(
            "{location} allows only id, why, draft on a draft entry (found '{key}')"
        ));
    }
    if entry.get("draft") != Some(&Value::Bool(true)) {
        return Err(format!("{location} draft must be the literal true"));
    }
    if !entry.get("why").is_some_and(is_non_empty_string) {
        return Err(format!(
            "{location} why must be a non-empty string on a draft entry"
        ));
    }
    Ok(())
}

/// The list a declaration belongs in follows from the channels it binds.
fn check_placement(declaration: &Declaration, list: &str, location: &str) -> Result<(), String> {
    let channels = declaration.channels();
    let reads_changes = channels.contains(&"changes");
    let reads_session = channels.iter().any(|channel| *channel != "changes");
    if reads_changes && reads_session {
        return Err(format!(
            "{location} reads {}: no surface observes both changes and a session channel",
            channels.join(", ")
        ));
    }
    let destination = if reads_session {
        "sessionDisciplines"
    } else if reads_changes {
        "changeSetDisciplines"
    } else {
        "disciplines"
    };
    if destination == list {
        return Ok(());
    }
    let reads = if channels.is_empty() {
        "no evidence channel".to_string()
    } else {
        channels.join(", ")
    };
    Err(format!(
        "{location} reads {reads}: it belongs in {destination}"
    ))
}

fn validate_protected_paths(value: &Value) -> Result<Vec<String>, String> {
    let entries: Option<Vec<&str>> = value
        .as_array()
        .and_then(|entries| entries.iter().map(Value::as_str).collect());
    let Some(entries) = entries else {
        return Err("protectedPaths must be an array of strings".to_string());
    };
    normalize_protected_paths(&entries)
        .ok_or_else(|| "protectedPaths must not contain an empty string".to_string())
}

fn validate_adapters(value: &Value) -> Result<(), String> {
    let Some(adapters) = value.as_object() else {
        return Err(
            "adapters must be an object map of adapter namespaces — the directory-list \
            form was removed; move directories to protectedPaths"
                .to_string(),
        );
    };
    for (name, namespace) in adapters {
        if !namespace.is_object() {
            return Err(format!("adapters.{name} must be an object"));
        }
    }
    Ok(())
}

fn validate_telemetry(value: &Value) -> Result<Option<String>, String> {
    let Some(telemetry) = value.as_object() else {
        return Err("telemetry must be an object".to_string());
    };
    reject_unknown_keys(telemetry, &["logPath"], "telemetry")?;
    let Some(log_path) = telemetry.get("logPath") else {
        return Ok(None);
    };
    let Some(log_path) = log_path.as_str() else {
        return Err("telemetry.logPath must be a string".to_string());
    };
    if js_trim(log_path).is_empty() {
        return Err("telemetry.logPath must be a non-empty string after trimming".to_string());
    }
    Ok(Some(log_path.to_string()))
}

fn validate_witness(value: &Value) -> Result<Witness, String> {
    let Some(witness) = value.as_object() else {
        return Err("witness must be an object".to_string());
    };
    reject_unknown_keys(witness, &["token", "ttlMinutes"], "witness")?;
    let Some(token) = witness
        .get("token")
        .and_then(Value::as_str)
        .filter(|token| !js_trim(token).is_empty())
    else {
        return Err("witness.token must be a non-empty string after trimming".to_string());
    };
    let Some(ttl_minutes) = witness
        .get("ttlMinutes")
        .and_then(Value::as_f64)
        .filter(|minutes| minutes.is_finite() && *minutes > 0.0)
    else {
        return Err("witness.ttlMinutes must be a finite number greater than 0".to_string());
    };
    Ok(Witness {
        token: token.to_string(),
        ttl_minutes,
    })
}

fn validate_memory(value: &Value) -> Result<(), String> {
    let Some(memory) = value.as_object() else {
        return Err("memory must be an object".to_string());
    };
    reject_unknown_keys(
        memory,
        &[
            "include",
            "exclude",
            "typeMap",
            "ticket",
            "weights",
            "obligations",
            "supersedes",
        ],
        "memory",
    )?;
    let include_ok = memory
        .get("include")
        .and_then(Value::as_array)
        .is_some_and(|globs| !globs.is_empty() && globs.iter().all(is_non_empty_string));
    if !include_ok {
        return Err("memory.include must be a non-empty array of non-empty strings".to_string());
    }
    if let Some(exclude) = memory.get("exclude")
        && !exclude
            .as_array()
            .is_some_and(|globs| globs.iter().all(is_non_empty_string))
    {
        return Err("memory.exclude must be an array of non-empty strings".to_string());
    }
    for name in ["typeMap", "weights"] {
        if let Some(mapping) = memory.get(name) {
            validate_mapping(mapping, name)?;
        }
    }
    if let Some(tickets) = memory.get("ticket") {
        let Some(rules) = tickets.as_array() else {
            return Err("memory.ticket must be an array".to_string());
        };
        for (index, rule) in rules.iter().enumerate() {
            validate_ticket(rule, index)?;
        }
    }
    if let Some(obligations) = memory.get("obligations") {
        let Some(rules) = obligations.as_array() else {
            return Err("memory.obligations must be an array".to_string());
        };
        for (index, rule) in rules.iter().enumerate() {
            validate_obligation(rule, index)?;
        }
    }
    if let Some(supersedes) = memory.get("supersedes") {
        let Some(rules) = supersedes.as_array() else {
            return Err("memory.supersedes must be an array".to_string());
        };
        for (index, rule) in rules.iter().enumerate() {
            validate_supersedes(rule, index)?;
        }
    }
    Ok(())
}

fn validate_mapping(mapping: &Value, name: &str) -> Result<(), String> {
    let Some(mapping) = mapping.as_object() else {
        return Err(format!("memory.{name} must be an object"));
    };
    for (key, item) in mapping {
        let valid = if name == "typeMap" {
            is_non_empty_string(item)
        } else {
            item.as_f64()
                .is_some_and(|weight| weight.is_finite() && weight >= 0.0)
        };
        if !valid {
            return Err(format!("memory.{name}.{key} has an invalid value"));
        }
    }
    Ok(())
}

fn validate_ticket(rule: &Value, index: usize) -> Result<(), String> {
    let location = format!("memory.ticket[{index}]");
    let Some(rule) = rule.as_object() else {
        return Err(format!("{location} must be an object"));
    };
    reject_unknown_keys(rule, &["type", "from", "key", "pattern"], &location)?;
    let from = rule
        .get("from")
        .and_then(Value::as_str)
        .filter(|from| ["title", "frontmatter", "path"].contains(from));
    let Some(from) = from else {
        return Err(format!("{location}.from is invalid"));
    };
    if rule
        .get("type")
        .is_some_and(|kind| !is_non_empty_string(kind))
    {
        return Err(format!("{location}.type is invalid"));
    }
    let key = rule.get("key");
    let key_invalid = if from == "frontmatter" {
        !key.is_some_and(is_non_empty_string)
    } else {
        key.is_some()
    };
    if key_invalid {
        return Err(format!("{location}.key is invalid"));
    }
    if rule.contains_key("pattern") {
        check_pattern(rule, "pattern", &location)?;
    }
    Ok(())
}

fn validate_obligation(rule: &Value, index: usize) -> Result<(), String> {
    let location = format!("memory.obligations[{index}]");
    let Some(rule) = rule.as_object() else {
        return Err(format!("{location} must be an object"));
    };
    let fields: &[&str] = if rule.contains_key("section") {
        &["section"]
    } else {
        &["line", "key"]
    };
    reject_unknown_keys(rule, fields, &location)?;
    for field in fields {
        check_pattern(rule, field, &location)?;
    }
    Ok(())
}

fn validate_supersedes(rule: &Value, index: usize) -> Result<(), String> {
    let location = format!("memory.supersedes[{index}]");
    let Some(rule) = rule.as_object() else {
        return Err(format!("{location} must be an object"));
    };
    reject_unknown_keys(rule, &["line", "key", "direction"], &location)?;
    for field in ["line", "key"] {
        check_pattern(rule, field, &location)?;
    }
    if !["supersedes", "superseded-by"]
        .iter()
        .any(|direction| rule.get("direction").and_then(Value::as_str) == Some(direction))
    {
        return Err(format!("{location}.direction is invalid"));
    }
    Ok(())
}

/// The pattern is JavaScript `RegExp` source, so it compiles with an ECMAScript engine.
fn check_pattern(rule: &Map<String, Value>, field: &str, location: &str) -> Result<(), String> {
    let Some(pattern) = rule.get(field).and_then(Value::as_str) else {
        return Err(format!("{location}.{field} must be a string"));
    };
    match Regex::new(pattern) {
        Ok(_) => Ok(()),
        Err(_) => Err(format!("{location}.{field} is invalid")),
    }
}
