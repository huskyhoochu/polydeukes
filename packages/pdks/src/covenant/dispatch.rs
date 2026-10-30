//! Dispatcher: route one tool call to the registrations that claim it, and run each routed
//! judge. A registration claims a call by a protected-path mention (self-mod) or decides for
//! itself (the shell and transcript covenants); one registration only records a skip.

use std::path::Path;

use super::bash_line::{Tokenized, tokenize_command_line};
use super::mention::{path_candidates, path_matches_protected, proven_change_path, string_values};
use super::run_covenant::{Enforce, Judgment, Verdict, record_skip, run_covenant};
use super::transcript_mod::TranscriptMod;
use super::ttl_witness::Valve;
use super::{discipline, self_mod, shell_mod, transcript_mod};
use crate::core::protocol::ToolCall;

pub enum Judge {
    SelfMod {
        protected_paths: Vec<String>,
        mutating_tool_names: Vec<String>,
    },
    ShellMod {
        protected_paths: Vec<String>,
    },
    TranscriptMod(TranscriptMod),
    ShellUnjudgeable,
}

/// One registered covenant. A judge's `protected_paths` are literal normalized paths, not globs.
pub struct Registration {
    pub label: &'static str,
    pub judge: Judge,
}

pub struct Context<'a> {
    pub enforce: Enforce,
    pub valve: Option<&'a Valve<'a>>,
    pub telemetry_path: &'a Path,
    pub shell_tools: &'a [String],
    pub command_args: &'a [String],
}

/// A call's command lines, tokenized once for every registration that reads them. `lines`
/// holds one entry per string under a command-arg name, in that order.
pub struct ShellCall {
    pub is_shell: bool,
    pub lines: Vec<Tokenized>,
}

impl ShellCall {
    fn new(call: &ToolCall, context: &Context) -> Self {
        let is_shell = context
            .shell_tools
            .iter()
            .any(|name| !name.is_empty() && *name == call.name);
        let lines = if is_shell {
            context
                .command_args
                .iter()
                .filter(|name| !name.is_empty())
                .filter_map(|name| call.args.as_ref()?.get(name)?.as_str())
                .map(tokenize_command_line)
                .collect()
        } else {
            Vec::new()
        };
        Self { is_shell, lines }
    }
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

    let shell = ShellCall::new(call, context);
    let mut verdicts = Vec::new();
    for registration in registrations {
        // `None` as the judgment records a skip instead of judging.
        let (subject, judgment): (String, Option<Judgment>) = match &registration.judge {
            Judge::SelfMod {
                protected_paths,
                mutating_tool_names,
            } => {
                let mentioned = protected_paths.iter().find(|path| {
                    candidates
                        .iter()
                        .any(|candidate| path_matches_protected(candidate, path))
                });
                let Some(subject) = mentioned else {
                    continue;
                };
                let judgment = self_mod::judge(call, protected_paths, mutating_tool_names);
                (subject.clone(), Some(judgment))
            }
            Judge::ShellMod { protected_paths } => {
                let paths = protected_paths;
                let cwd = call.cwd.as_deref();
                let Some(subject) = shell_mod::route(&shell, paths, cwd) else {
                    continue;
                };
                let judgment = shell_mod::judge(&call.name, &shell, paths, cwd);
                (subject.to_string(), Some(judgment))
            }
            Judge::TranscriptMod(spec) => {
                let Some(judgment) = transcript_mod::judge(spec, call, &shell) else {
                    continue;
                };
                (spec.subject().to_string(), Some(judgment))
            }
            Judge::ShellUnjudgeable => {
                if !discipline::shell_unjudgeable(&shell) {
                    continue;
                }
                ("-".to_string(), None)
            }
        };
        verdicts.push(match judgment {
            Some(judgment) => run_covenant(
                &judgment,
                registration.label,
                &subject,
                context.enforce,
                context.valve,
                context.telemetry_path,
            ),
            None => record_skip(registration.label, &subject, context.telemetry_path),
        });
    }
    verdicts
}
