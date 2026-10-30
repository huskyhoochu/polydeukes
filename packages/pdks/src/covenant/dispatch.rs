//! Path-routing dispatcher: route one tool call to the registrations whose protected paths
//! it mentions, and run each routed judge.

use std::path::Path;

use super::mention::{path_candidates, path_matches_protected, proven_change_path, string_values};
use super::run_covenant::{Enforce, Verdict, run_covenant};
use super::self_mod;
use super::ttl_witness::Valve;
use crate::core::protocol::ToolCall;

pub enum Judge {
    SelfMod { mutating_tool_names: Vec<String> },
}

/// One registered covenant. `protected_paths` are literal normalized paths, not globs.
pub struct Registration {
    pub label: &'static str,
    pub protected_paths: Vec<String>,
    pub judge: Judge,
}

pub struct Context<'a> {
    pub enforce: Enforce,
    pub valve: Option<&'a Valve<'a>>,
    pub telemetry_path: &'a Path,
}

/// Run every registration the call mentions, in registration order and without
/// short-circuiting.
///
/// Candidates are the path-shaped fragments of every string inside the call's `args` at any
/// depth, plus the proven `fileChange` path whole: an adapter already resolved it, and
/// splitting it would break a path that contains a space into words that name nothing.
pub fn dispatch(
    call: &ToolCall,
    registrations: &[Registration],
    context: &Context,
) -> Vec<Verdict> {
    let mut strings = Vec::new();
    if let Some(args) = &call.args {
        string_values(args, &mut strings);
    }
    let mut candidates: Vec<&str> = strings.into_iter().flat_map(path_candidates).collect();
    candidates.extend(proven_change_path(call));

    let mut verdicts = Vec::new();
    for registration in registrations {
        let mentioned = registration.protected_paths.iter().find(|path| {
            candidates
                .iter()
                .any(|candidate| path_matches_protected(candidate, path))
        });
        let Some(subject) = mentioned else {
            continue;
        };
        let judgment = match &registration.judge {
            Judge::SelfMod {
                mutating_tool_names,
            } => self_mod::judge(call, &registration.protected_paths, mutating_tool_names),
        };
        verdicts.push(run_covenant(
            &judgment,
            registration.label,
            subject,
            context.enforce,
            context.valve,
            context.telemetry_path,
        ));
    }
    verdicts
}
