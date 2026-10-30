use super::validation::js_trim;

/// Trim each entry, strip leading `./` and trailing `/` to a fixpoint, and drop duplicates.
/// An entry that is empty after that has no path meaning, so it yields `None`.
pub fn normalize_protected_paths(entries: &[&str]) -> Option<Vec<String>> {
    let mut result: Vec<String> = Vec::new();
    for entry in entries {
        let mut path = js_trim(entry);
        while let Some(rest) = path.strip_prefix("./") {
            path = rest;
        }
        while let Some(rest) = path.strip_suffix('/') {
            path = rest;
        }
        if path.is_empty() {
            return None;
        }
        if !result.iter().any(|seen| seen == path) {
            result.push(path.to_string());
        }
    }
    Some(result)
}
