//! The self-mod meta-covenant: a mutating tool call that targets a protected path breaks.
//!
//! Only the call's own axis is judged: a non-mutating call that merely mentions a protected
//! path is upheld, because run-all co-existence with the other meta-covenants depends on it.

use super::dispatch::{Judge, Registration};
use super::mention::{mentions_path, path_matches_protected, proven_change_path};
use super::run_covenant::Judgment;
use crate::core::protocol::ToolCall;

/// A call whose name is a mutating tool is judged on its proven `fileChange` target, every
/// kind included, and otherwise on an `args` mention at any depth.
pub fn judge(
    call: &ToolCall,
    protected_paths: &[String],
    mutating_tool_names: &[String],
) -> Judgment {
    if mutating_tool_names.iter().all(String::is_empty) {
        return Judgment::Unjudgeable;
    }
    if !mutating_tool_names
        .iter()
        .any(|name| !name.is_empty() && *name == call.name)
    {
        return Judgment::Upheld;
    }
    if let Some(change_path) = proven_change_path(call) {
        return if protected_paths
            .iter()
            .any(|path| path_matches_protected(change_path, path))
        {
            Judgment::Broken(format!(
                "{} would modify protected path {change_path}",
                call.name
            ))
        } else {
            Judgment::Upheld
        };
    }
    let mentioned = call.args.as_ref().and_then(|args| {
        protected_paths
            .iter()
            .find(|path| mentions_path(args, path))
    });
    match mentioned {
        Some(path) => Judgment::Broken(format!("{} would modify protected path {path}", call.name)),
        None => Judgment::Upheld,
    }
}

pub fn registration(
    protected_paths: Vec<String>,
    mutating_tool_names: Vec<String>,
) -> Registration {
    Registration {
        label: "self-mod",
        protected_paths,
        judge: Judge::SelfMod {
            mutating_tool_names,
        },
    }
}
