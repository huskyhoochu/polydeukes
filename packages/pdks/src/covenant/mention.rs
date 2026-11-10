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
pub fn resolve_dot_segments<'a>(segments: &[&'a str]) -> Vec<&'a str> {
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

/// The segments of the `/`-separated parts read in order: empty parts and `.` are dropped and
/// `..` removes the segment before it, so `..` above the root is the root.
pub fn rooted_segments<'a>(parts: impl IntoIterator<Item = &'a str>) -> Vec<&'a str> {
    let mut resolved = Vec::new();
    for part in parts {
        match part {
            "" | "." => {}
            ".." => {
                resolved.pop();
            }
            _ => resolved.push(part),
        }
    }
    resolved
}

/// `path.posix.join(root, relative)`: the two joined by `/` and normalized under the root.
/// `Path::join` would discard the root for an absolute `relative`.
pub fn join_under(root: &str, relative: &str) -> String {
    let parts = rooted_segments(root.split('/').chain(relative.split('/')));
    format!("/{}", parts.join("/"))
}

/// Where a path lies relative to the repository root, decided on text alone.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Location {
    Inside,
    Outside,
    /// A `..` cancels a name the path wrote itself; the name may be a link, so the text
    /// cannot place the path.
    Unknown,
}

/// Whether `path` lies at or below `root`. A relative path is read against the root, so a
/// leading `..` removes only the root's own segments.
pub fn locate(path: &str, root: &str) -> Location {
    let mut named = false;
    for part in path.split('/') {
        match part {
            ".." if named => return Location::Unknown,
            "" | "." | ".." => {}
            _ => named = true,
        }
    }
    let root_segments = rooted_segments(root.split('/'));
    let segments = if path.starts_with('/') {
        rooted_segments(path.split('/'))
    } else {
        rooted_segments(root.split('/').chain(path.split('/')))
    };
    let inside = segments.len() >= root_segments.len()
        && segments
            .iter()
            .zip(&root_segments)
            .all(|(segment, root_segment)| segment == root_segment);
    if inside {
        Location::Inside
    } else {
        Location::Outside
    }
}

/// True when the protected entry starts with `/` or `..`: it points outside the root itself,
/// so it is compared as written with no location test.
pub fn entry_points_outside(entry: &str) -> bool {
    entry.starts_with('/') || path_segments(entry).first() == Some(&"..")
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

/// A command line the tokenizer could not read, as path candidates: the line itself plus its
/// fragments split on the shell operators the tokenizer would have consumed. Adding a form can
/// only add a match.
pub fn untokenizable_line_candidates(line: &str) -> Vec<&str> {
    let fragments = line
        .split([';', '&', '|', '<', '>'])
        .filter(|fragment| !fragment.is_empty() && *fragment != line);
    std::iter::once(line).chain(fragments).collect()
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
