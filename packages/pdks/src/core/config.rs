use regress::Regex;
use serde_json::{Map, Value};

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

/// A validated config. `memory` and `adapters` are checked and not kept: this judge reads
/// neither.
pub struct Config {
    pub protected_paths: Vec<String>,
    pub log_path: String,
    pub witness: Option<Witness>,
    pub has_discipline_entries: bool,
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
    let mut has_discipline_entries = false;
    for list in DISCIPLINE_LISTS {
        if let Some(entries) = config.get(list) {
            has_discipline_entries |= validate_list(entries, list)?;
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

    Ok(Config {
        protected_paths,
        log_path: log_path.unwrap_or_else(|| DEFAULT_TELEMETRY_LOG_PATH.to_string()),
        witness,
        has_discipline_entries,
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
    let mut lists = Map::new();
    for list in DISCIPLINE_LISTS {
        if let Some(entries) = layer.get(list) {
            validate_list(entries, list)?;
            lists.insert(list.to_string(), entries.clone());
        }
    }
    Ok(lists)
}

/// Whether the list holds entries. The entries themselves are judged by the declaration
/// engine, which this build does not carry.
fn validate_list(entries: &Value, list: &str) -> Result<bool, String> {
    match entries.as_array() {
        Some(entries) => Ok(!entries.is_empty()),
        None => Err(format!("{list} must be an array")),
    }
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
