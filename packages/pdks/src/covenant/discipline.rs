use std::path::Path;

use super::dispatch::{Judge, Registration, ShellCall};
use super::mention::rooted_segments;
use super::shell_evidence::has_pathless_signal;

/// `path.posix.normalize` for a relative path: resolve `.` and `..`, keep a trailing `/`.
fn normalize_relative(path: &str) -> String {
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

/// `path.relative(root, path)` for two absolute paths.
fn relative_to(root: &str, path: &str) -> String {
    let from = rooted_segments(root.split('/'));
    let to = rooted_segments(path.split('/'));
    let shared = from
        .iter()
        .zip(&to)
        .take_while(|(left, right)| left == right)
        .count();
    let ups = std::iter::repeat_n("..", from.len() - shared);
    ups.chain(to.iter().skip(shared).copied())
        .collect::<Vec<_>>()
        .join("/")
}

/// The repo-relative spelling of a path, or `None` when it resolves outside the root.
pub fn relativize_for_scope(file_path: &str, root: &Path) -> Option<String> {
    if !file_path.starts_with('/') {
        let normalized = normalize_relative(file_path);
        return (normalized != "." && !normalized.starts_with("..")).then_some(normalized);
    }
    let relativized = relative_to(&root.to_string_lossy(), file_path);
    (!relativized.starts_with("..")).then_some(relativized)
}

/// The one common shell-axis skip registration. A write whose target is unknowable belongs to
/// no covenant's scope, so it leaves one row under one label with the subject `-`.
pub fn shell_unjudgeable_registration() -> Registration {
    Registration {
        label: "shell-unjudgeable",
        judge: Judge::ShellUnjudgeable,
    }
}

/// True when a command line of the call writes somewhere its text does not reveal.
pub fn shell_unjudgeable(shell: &ShellCall) -> bool {
    shell.lines.iter().any(has_pathless_signal)
}
