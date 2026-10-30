//! Config discovery and loading: the one place that parses the config file's text.

use std::path::Path;

use serde_json::{Map, Value};
use serde_saphyr::options::MergeKeyPolicy;

use crate::core::config::{Config, define_config, define_config_layer};

const CONFIG_FILENAMES: [&str; 3] = [
    "polydeukes.config.yaml",
    "polydeukes.config.yml",
    "polydeukes.config.json",
];

/// A config layer's text and the path it was read from.
pub struct LayerSource {
    pub source: String,
    pub path: String,
}

/// The one candidate present directly under `root`; there is no upward walk.
pub fn discover_config_path(root: &Path) -> Result<String, String> {
    let found: Vec<&str> = CONFIG_FILENAMES
        .into_iter()
        .filter(|name| root.join(name).exists())
        .collect();
    match found.as_slice() {
        [only] => Ok((*only).to_string()),
        [] => Err(format!(
            "no Polydeukes config found in {} — expected one of: {}",
            root.display(),
            CONFIG_FILENAMES.join(", ")
        )),
        _ => Err(format!(
            "ambiguous Polydeukes config in {} — found {}; keep exactly one",
            root.display(),
            found.join(" and ")
        )),
    }
}

/// Parse and validate a config text, with its layer merged in when one is given. The
/// config file itself joins the protected paths.
pub fn parse_config_source(
    source: &str,
    config_path: &str,
    layer: Option<&LayerSource>,
) -> Result<Config, String> {
    let mut input = parse_text(source, config_path)?;
    if let Value::Object(fields) = &mut input {
        fields.remove("$schema");
    }

    let mut context = config_path.to_string();
    if let Some(layer) = layer {
        let lists = parse_layer_source(layer)?;
        if let Value::Object(fields) = &mut input {
            append_layer(fields, lists);
        }
        context = format!("{config_path} with layer {}", layer.path);
    }

    let mut config = define_config(&input)
        .map_err(|message| format!("invalid config in {context}: {message}"))?;
    if !config
        .protected_paths
        .iter()
        .any(|path| path == config_path)
    {
        config.protected_paths.push(config_path.to_string());
    }
    Ok(config)
}

/// A layer's text parsed and validated on its own, the layer's path on any error.
pub fn parse_layer_source(layer: &LayerSource) -> Result<Map<String, Value>, String> {
    let parsed = parse_text(&layer.source, &layer.path)?;
    define_config_layer(&parsed)
        .map_err(|message| format!("invalid config layer in {}: {message}", layer.path))
}

/// YAML 1.2 core schema semantics, as config data: `on` and `yes` stay strings, a duplicate
/// key and an unrecognized tag are errors, and `<<` is an ordinary key.
fn parse_text(source: &str, path: &str) -> Result<Value, String> {
    let options = serde_saphyr::options! {
        strict_booleans: true,
        reject_unsupported_tags: true,
        merge_keys: MergeKeyPolicy::AsOrdinary,
    };
    serde_saphyr::from_str_with_options(source, options)
        .map_err(|error| format!("failed to parse {path}: {error}"))
}

/// The layer's lists appended after the source's, list by list. A source list that is not an
/// array is left for validation to refuse.
fn append_layer(fields: &mut Map<String, Value>, lists: Map<String, Value>) {
    for (list, entries) in lists {
        match fields.get_mut(&list) {
            None => {
                fields.insert(list, entries);
            }
            Some(Value::Array(own)) => {
                if let Value::Array(added) = entries {
                    own.extend(added);
                }
            }
            Some(_) => {}
        }
    }
}
