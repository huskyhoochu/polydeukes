//! Dispatcher: route one tool call to the registrations that claim it, and run each routed
//! judge. A registration claims a call by a protected-path mention (self-mod) or decides for
//! itself (the shell and transcript covenants); one registration only records a skip.

use std::path::Path;

use super::bash_line::{Tokenized, tokenize_command_line};
use super::run_covenant::{Attendance, Enforce, Judgment, Verdict, record_skip, run_covenant};
use super::transcript_mod::TranscriptMod;
use super::ttl_witness::Valve;
use super::{discipline, self_mod, shell_mod, transcript_mod};
use crate::core::config::{Entry, Level};
use crate::core::declaration::Scope;
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
    /// A discipline entry: routed and judged by its own declaration.
    Discipline(Box<Entry>),
    /// The entry's shell writes in scope, which no judgment observes.
    DisciplineSkip(Option<Scope>),
    ShellUnjudgeable,
}

/// One registered covenant. A judge's `protected_paths` are literal normalized paths, not globs.
pub struct Registration {
    pub label: String,
    pub judge: Judge,
}

pub struct Context<'a> {
    pub enforce: Enforce,
    pub attendance: Attendance,
    pub valve: Option<&'a Valve<'a>>,
    pub telemetry_path: &'a Path,
    pub shell_tools: &'a [String],
    pub command_args: &'a [String],
    pub supply: &'a discipline::Supply<'a>,
}

/// A call's command lines, tokenized once for every registration that reads them. `lines`
/// holds one entry per string under a command-arg name, in that order.
pub struct ShellCall {
    pub is_shell: bool,
    pub lines: Vec<Tokenized>,
    /// The command-arg strings as written, joined by line feeds.
    pub command: Option<String>,
}

impl ShellCall {
    fn new(call: &ToolCall, context: &Context) -> Self {
        let is_shell = context
            .shell_tools
            .iter()
            .any(|name| !name.is_empty() && *name == call.name);
        let commands: Vec<&str> = if is_shell {
            context
                .command_args
                .iter()
                .filter(|name| !name.is_empty())
                .filter_map(|name| call.args.as_ref()?.get(name)?.as_str())
                .collect()
        } else {
            Vec::new()
        };
        Self {
            is_shell,
            lines: commands
                .iter()
                .copied()
                .map(tokenize_command_line)
                .collect(),
            command: (!commands.is_empty()).then(|| commands.join("\n")),
        }
    }
}

/// Run every registration the call mentions, in registration order and without
/// short-circuiting.
pub fn dispatch(
    call: &ToolCall,
    registrations: &[Registration],
    context: &Context,
) -> Vec<Verdict> {
    let shell = ShellCall::new(call, context);
    let mut verdicts = Vec::new();
    for registration in registrations {
        // `None` as the judgment records a skip instead of judging.
        let mut enforce = context.enforce;
        let (subject, judgment): (String, Option<Judgment>) = match &registration.judge {
            Judge::SelfMod {
                protected_paths,
                mutating_tool_names,
            } => {
                if !mutating_tool_names
                    .iter()
                    .any(|name| !name.is_empty() && *name == call.name)
                {
                    continue;
                }
                let Some((subject, judgment)) = self_mod::judge(call, protected_paths) else {
                    continue;
                };
                (subject, Some(judgment))
            }
            Judge::ShellMod { protected_paths } => {
                let Some((subject, judgment)) =
                    shell_mod::judge(&call.name, &shell, protected_paths, call.cwd.as_deref())
                else {
                    continue;
                };
                (subject, Some(judgment))
            }
            Judge::TranscriptMod(spec) => {
                let Some(judgment) = transcript_mod::judge(spec, call, &shell) else {
                    continue;
                };
                (spec.subject().to_string(), Some(judgment))
            }
            Judge::Discipline(entry) => {
                let Some((subject, judgment)) = discipline::judge(entry, call, &shell, context)
                else {
                    continue;
                };
                if entry.level == Level::Advise {
                    enforce = Enforce::Advise;
                }
                (subject, Some(judgment))
            }
            Judge::DisciplineSkip(scope) => {
                let Some(path) = discipline::first_written_path(
                    scope.as_ref(),
                    call,
                    &shell,
                    context.supply.root,
                ) else {
                    continue;
                };
                (path, None)
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
                &registration.label,
                &subject,
                enforce,
                context.valve,
                context.telemetry_path,
            ),
            None => record_skip(&registration.label, &subject, context.telemetry_path),
        });
    }
    verdicts
}
