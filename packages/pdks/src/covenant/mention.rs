//! The single path-mention semantic shared by routing and the judges.
//!
//! Interior `.`/`..` resolution is a second comparison, never a replacement: raw segments
//! match first, dot-resolved segments only if that fails, so a newly closed notation can
//! only add matches. Globs, variable expansions and tildes are not read: none can be
//! resolved without running a shell or touching the filesystem.

use serde_json::Value;

use crate::core::protocol::ToolCall;
use crate::core::validation::is_js_space;

/// Strip leading `./` and trailing `/`, split on `/`, drop empties. A lone `.` survives as
/// a segment; dot resolution is a separate pass in [`path_matches_protected`].
pub fn path_segments(path: &str) -> Vec<&str> {
    let mut rest = path;
    while let Some(stripped) = rest.strip_prefix("./") {
        rest = stripped;
    }
    rest.trim_end_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect()
}

/// The mutation target a call's `fileChange` evidence proves, or `None` when it proves none:
/// a recognized kind and a path with at least one segment other than `.`.
pub fn proven_change_path(call: &ToolCall) -> Option<&str> {
    let evidence = call.file_change.as_ref()?.as_object()?;
    let path = evidence.get("path")?.as_str()?;
    if path_segments(path).iter().all(|segment| *segment == ".") {
        return None;
    }
    matches!(
        evidence.get("kind")?.as_str()?,
        "create" | "modify" | "delete"
    )
    .then_some(path)
}

fn contains_segment_run(haystack: &[&str], needle: &[&str]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

/// Descendant or equal: the protected segments appear as a contiguous run at any offset, so
/// an absolute path matches a relative protected path. Ancestor: the whole candidate is a
/// root-anchored prefix of the protected path. The asymmetry is deliberate: letting any
/// candidate suffix head the protected path would block unrelated directories such as
/// `x/packages/core`.
fn segments_match(candidate: &[&str], protected: &[&str]) -> bool {
    if candidate.is_empty() {
        return false;
    }
    if contains_segment_run(candidate, protected) {
        return true;
    }
    candidate.len() < protected.len()
        && candidate
            .iter()
            .zip(protected)
            .all(|(left, right)| left == right)
}

/// Resolve `.` and `..` against the preceding segment. A `..` with nothing to cancel is
/// kept, so `../packages` does not collapse into `packages` and borrow a sibling checkout's
/// protection.
fn resolve_dot_segments<'a>(segments: &[&'a str]) -> Vec<&'a str> {
    let mut resolved: Vec<&str> = Vec::new();
    for &segment in segments {
        if segment == "." {
            continue;
        }
        if segment == ".." && resolved.last().is_some_and(|last| *last != "..") {
            resolved.pop();
            continue;
        }
        resolved.push(segment);
    }
    resolved
}

/// True when `candidate` names the protected path, a descendant of it, or a relative
/// ancestor of it, compared on segments rather than substrings.
pub fn path_matches_protected(candidate: &str, protected: &str) -> bool {
    let candidate = path_segments(candidate);
    let protected = path_segments(protected);
    if protected.is_empty() {
        return false;
    }
    segments_match(&candidate, &protected)
        || segments_match(&resolve_dot_segments(&candidate), &protected)
}

/// Split a string on the characters that join a path to other lexemes (whitespace, `=`, `,`,
/// parentheses, backtick), so `--flag=path` surfaces the path as its own candidate. `/` is
/// the path's own boundary and `:` stays out because splitting it shatters URLs.
pub fn path_candidates(token: &str) -> impl Iterator<Item = &str> {
    token
        .split(|c: char| is_js_space(c) || matches!(c, '=' | ',' | '(' | ')' | '`'))
        .filter(|fragment| !fragment.is_empty())
}

/// Every string value inside `value`, at any depth; keys and non-strings are not scanned.
pub fn string_values<'a>(value: &'a Value, out: &mut Vec<&'a str>) {
    match value {
        Value::String(text) => out.push(text),
        Value::Array(items) => items.iter().for_each(|item| string_values(item, out)),
        Value::Object(fields) => fields.values().for_each(|item| string_values(item, out)),
        _ => {}
    }
}

pub fn mentions_path(value: &Value, path: &str) -> bool {
    let mut strings = Vec::new();
    string_values(value, &mut strings);
    strings
        .into_iter()
        .any(|text| path_candidates(text).any(|candidate| path_matches_protected(candidate, path)))
}
