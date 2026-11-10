//! The self-mod meta-covenant: a mutating tool call that targets a protected path breaks.
//!
//! Only the call's own axis is judged: a non-mutating call that merely mentions a protected
//! path is upheld, because run-all co-existence with the other meta-covenants depends on it.

use super::dispatch::{Judge, Registration};
use super::mention::{
    Location, entry_points_outside, locate, mentions_path, path_matches_protected,
    proven_change_path,
};
use super::run_covenant::Judgment;
use crate::core::protocol::ToolCall;

/// The protected path a mutating call targets, with the broken judgment, or `None` when it
/// targets none. The call is judged on its proven `fileChange` target, every kind included,
/// and otherwise on an `args` mention at any depth. The dispatcher routes only calls to
/// mutating tools.
///
/// The proven path is compared whole: an adapter already resolved it, and splitting it would
/// break a path that contains a space into words that name nothing. A proven path that lies
/// outside `root` matches only an entry that itself points outside the root.
pub fn judge(
    call: &ToolCall,
    protected_paths: &[String],
    root: &str,
) -> Option<(String, Judgment)> {
    let (entry, target) = if let Some(change_path) = proven_change_path(call) {
        let outside = locate(change_path, root) == Location::Outside;
        let entry = protected_paths.iter().find(|path| {
            (!outside || entry_points_outside(path)) && path_matches_protected(change_path, path)
        })?;
        (entry, change_path)
    } else {
        let args = call.args.as_ref()?;
        let entry = protected_paths
            .iter()
            .find(|path| mentions_path(args, path))?;
        (entry, entry.as_str())
    };
    Some((
        entry.clone(),
        Judgment::Broken(format!(
            "{} would modify protected path {target}",
            call.name
        )),
    ))
}

pub fn registration(
    protected_paths: Vec<String>,
    mutating_tool_names: Vec<String>,
) -> Registration {
    Registration {
        label: "self-mod".to_string(),
        judge: Judge::SelfMod {
            protected_paths,
            mutating_tool_names,
        },
    }
}
