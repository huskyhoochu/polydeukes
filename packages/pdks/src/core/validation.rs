use serde_json::{Map, Value};

/// JavaScript's whitespace class: it contains U+FEFF and lacks U+0085, unlike `char::is_whitespace`.
pub fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

pub fn reject_unknown_keys(
    record: &Map<String, Value>,
    allowed: &[&str],
    location: &str,
) -> Result<(), String> {
    match record.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => Err(format!("unknown key '{key}' in {location}")),
        None => Ok(()),
    }
}

pub fn is_non_empty_string(value: &Value) -> bool {
    value.as_str().is_some_and(|text| !text.is_empty())
}

/// `path.posix.normalize` for a relative path: resolve `.` and `..`, keep a trailing `/`.
pub fn normalize_relative(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." if parts.last().is_some_and(|last| *last != "..") => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    let mut joined = parts.join("/");
    if joined.is_empty() {
        joined.push('.');
    }
    if path.ends_with('/') {
        joined.push('/');
    }
    joined
}
