//! The `memory` section of the one config file in the working directory.

use std::fs;
use std::path::Path;

use regress::Regex;
use serde_json::{Map, Value};
use serde_saphyr::options::MergeKeyPolicy;

const CONFIG_FILENAMES: [&str; 3] = [
    "polydeukes.config.yaml",
    "polydeukes.config.yml",
    "polydeukes.config.json",
];
const EXAMPLE: &str = "\nmemory:\n  include:\n    - 'docs/**/*.md'";

pub enum TicketSource {
    Title,
    Path,
    Frontmatter(String),
}

pub struct TicketRule {
    pub kind: Option<String>,
    pub from: TicketSource,
    pub pattern: Option<Regex>,
}

pub enum ObligationRule {
    Line { line: Regex, key: Regex },
    Section(Regex),
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Direction {
    Supersedes,
    SupersededBy,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Supersedes => "supersedes",
            Self::SupersededBy => "superseded-by",
        }
    }
}

pub struct SupersedeRule {
    pub line: Regex,
    pub key: Regex,
    pub direction: Direction,
}

pub struct Settings {
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub ticket: Vec<TicketRule>,
    pub obligations: Vec<ObligationRule>,
    pub supersedes: Vec<SupersedeRule>,
}

/// Reads and validates the `memory` key of the one config file directly under `root`.
pub fn load(root: &Path) -> Result<Settings, String> {
    let found: Vec<&str> = CONFIG_FILENAMES
        .into_iter()
        .filter(|name| root.join(name).exists())
        .collect();
    let name = match found.as_slice() {
        [only] => *only,
        [] => {
            return Err(format!(
                "no config in {} ({}) — run pdks memory from the directory that holds it, or create one that declares memory.include, for example:\n{EXAMPLE}",
                root.display(),
                CONFIG_FILENAMES.join(", ")
            ));
        }
        _ => {
            return Err(format!(
                "ambiguous Polydeukes config in {} — found {}; keep exactly one",
                root.display(),
                found.join(" and ")
            ));
        }
    };
    let source = fs::read_to_string(root.join(name))
        .map_err(|error| format!("failed to read {name}: {error}"))?;
    let options = serde_saphyr::options! {
        strict_booleans: true,
        reject_unsupported_tags: true,
        merge_keys: MergeKeyPolicy::AsOrdinary,
    };
    let config: Value = serde_saphyr::from_str_with_options(&source, options)
        .map_err(|error| format!("failed to parse {name}: {error}"))?;
    let Some(memory) = config.get("memory") else {
        return Err(format!(
            "memory.include is not declared — add the globs of the markdown files to index to the project config, for example:\n{EXAMPLE}"
        ));
    };
    validate(memory).map_err(|message| format!("invalid config in {name}: {message}"))
}

fn is_non_empty_string(value: &Value) -> bool {
    value.as_str().is_some_and(|text| !text.is_empty())
}

fn reject_unknown_keys(
    record: &Map<String, Value>,
    allowed: &[&str],
    location: &str,
) -> Result<(), String> {
    match record.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => Err(format!("unknown key '{key}' in {location}")),
        None => Ok(()),
    }
}

fn validate(value: &Value) -> Result<Settings, String> {
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
    let include = strings(memory.get("include"))
        .filter(|globs| !globs.is_empty())
        .ok_or("memory.include must be a non-empty array of non-empty strings")?;
    let exclude = match memory.get("exclude") {
        Some(globs) => {
            strings(Some(globs)).ok_or("memory.exclude must be an array of non-empty strings")?
        }
        None => Vec::new(),
    };
    for name in ["typeMap", "weights"] {
        if let Some(mapping) = memory.get(name) {
            validate_mapping(mapping, name)?;
        }
    }
    Ok(Settings {
        include,
        exclude,
        ticket: rules(memory, "ticket", ticket_rule)?,
        obligations: rules(memory, "obligations", obligation_rule)?,
        supersedes: rules(memory, "supersedes", supersede_rule)?,
    })
}

fn strings(value: Option<&Value>) -> Option<Vec<String>> {
    value?
        .as_array()?
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|text| !text.is_empty())
                .map(str::to_string)
        })
        .collect()
}

fn rules<T>(
    memory: &Map<String, Value>,
    name: &str,
    build: fn(&Value, &str) -> Result<T, String>,
) -> Result<Vec<T>, String> {
    let Some(list) = memory.get(name) else {
        return Ok(Vec::new());
    };
    let Some(items) = list.as_array() else {
        return Err(format!("memory.{name} must be an array"));
    };
    items
        .iter()
        .enumerate()
        .map(|(index, rule)| build(rule, &format!("memory.{name}[{index}]")))
        .collect()
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

fn ticket_rule(rule: &Value, location: &str) -> Result<TicketRule, String> {
    let Some(rule) = rule.as_object() else {
        return Err(format!("{location} must be an object"));
    };
    reject_unknown_keys(rule, &["type", "from", "key", "pattern"], location)?;
    let from = rule.get("from").and_then(Value::as_str);
    if !matches!(from, Some("title" | "frontmatter" | "path")) {
        return Err(format!("{location}.from is invalid"));
    }
    if rule
        .get("type")
        .is_some_and(|kind| !is_non_empty_string(kind))
    {
        return Err(format!("{location}.type is invalid"));
    }
    let key = rule.get("key");
    let source = match from {
        Some("frontmatter") => match key.and_then(Value::as_str).filter(|key| !key.is_empty()) {
            Some(key) => TicketSource::Frontmatter(key.to_string()),
            None => return Err(format!("{location}.key is invalid")),
        },
        _ if key.is_some() => return Err(format!("{location}.key is invalid")),
        Some("title") => TicketSource::Title,
        _ => TicketSource::Path,
    };
    let pattern = if rule.contains_key("pattern") {
        Some(pattern(rule, "pattern", location)?)
    } else {
        None
    };
    Ok(TicketRule {
        kind: rule.get("type").and_then(Value::as_str).map(str::to_string),
        from: source,
        pattern,
    })
}

fn obligation_rule(rule: &Value, location: &str) -> Result<ObligationRule, String> {
    let Some(rule) = rule.as_object() else {
        return Err(format!("{location} must be an object"));
    };
    if rule.contains_key("section") {
        reject_unknown_keys(rule, &["section"], location)?;
        return Ok(ObligationRule::Section(pattern(rule, "section", location)?));
    }
    reject_unknown_keys(rule, &["line", "key"], location)?;
    Ok(ObligationRule::Line {
        line: pattern(rule, "line", location)?,
        key: pattern(rule, "key", location)?,
    })
}

fn supersede_rule(rule: &Value, location: &str) -> Result<SupersedeRule, String> {
    let Some(rule) = rule.as_object() else {
        return Err(format!("{location} must be an object"));
    };
    reject_unknown_keys(rule, &["line", "key", "direction"], location)?;
    let line = pattern(rule, "line", location)?;
    let key = pattern(rule, "key", location)?;
    let direction = match rule.get("direction").and_then(Value::as_str) {
        Some("supersedes") => Direction::Supersedes,
        Some("superseded-by") => Direction::SupersededBy,
        _ => return Err(format!("{location}.direction is invalid")),
    };
    Ok(SupersedeRule {
        line,
        key,
        direction,
    })
}

/// The pattern is JavaScript `RegExp` source, so it compiles with an ECMAScript engine.
fn pattern(rule: &Map<String, Value>, field: &str, location: &str) -> Result<Regex, String> {
    let Some(source) = rule.get(field).and_then(Value::as_str) else {
        return Err(format!("{location}.{field} must be a string"));
    };
    Regex::new(source)
        .ok()
        .ok_or_else(|| format!("{location}.{field} is invalid"))
}
