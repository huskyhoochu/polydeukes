//! The transcript-mod covenant: nothing may write the session's evidence file.
//!
//! The file is compared by whole-path equality, never as an ancestor, so the home-directory
//! spellings (`~`, `$HOME`, `${HOME}`, `~<user>`) are closed with the home value instead of
//! by protecting home itself. A shell call is judged by the shared shell judgment; a call to
//! a mutating tool is judged on its proven change, else on every string in its `args`.

use super::dispatch::{Judge, Registration, ShellCall};
use super::mention::{
    join_under, path_candidates, path_segments, proven_change_path, resolve_dot_segments,
    rooted_segments, string_values,
};
use super::run_covenant::Judgment;
use super::shell_mod::{Target, judge_shell};
use super::shell_path::shell_path;
use crate::core::protocol::ToolCall;

pub struct Transcript {
    /// The evidence path as configured: the row subject and the path every reason names.
    pub path: String,
    target: Vec<String>,
    /// Leading segments that stand for the home directory.
    home_prefixes: Vec<String>,
    home_segments: Vec<String>,
}

pub struct TranscriptMod {
    transcript: Transcript,
    root: String,
    mutating_tool_names: Vec<String>,
}

/// A candidate plus the rooted suffix behind a glued prefix (`curl -o/abs`, `host:/abs`,
/// `>>/abs`), which whole-path equality would otherwise miss.
fn path_forms(candidate: &str) -> impl Iterator<Item = &str> {
    let rooted = if candidate.starts_with(['/', '~', '$']) {
        None
    } else {
        candidate
            .find(['/', '~', '$'])
            .and_then(|at| candidate.get(at..))
    };
    std::iter::once(candidate).chain(rooted)
}

impl Transcript {
    /// `None` for a path with no segment that names a file: the covenant has nothing to compare.
    fn new(path: &str, home: Option<&str>) -> Option<Self> {
        let segments = path_segments(path);
        if segments.iter().all(|segment| *segment == ".") {
            return None;
        }
        let home = home
            .filter(|home| home.starts_with('/'))
            .map(|home| home.trim_end_matches('/'))
            .and_then(|home| Some((home, path_segments(home).last().copied()?)));
        let under_home = home.is_some_and(|(home, _)| path.starts_with(&format!("{home}/")));
        let home_prefixes = match home {
            Some((_, user)) if under_home => ["~", "$HOME", "${HOME}"]
                .iter()
                .map(|prefix| (*prefix).to_string())
                .chain([format!("~{user}")])
                .collect(),
            _ => Vec::new(),
        };
        Some(Self {
            path: path.to_string(),
            target: resolve_dot_segments(&segments)
                .into_iter()
                .map(str::to_string)
                .collect(),
            home_prefixes,
            home_segments: home
                .map(|(home, _)| path_segments(home))
                .unwrap_or_default()
                .into_iter()
                .map(str::to_string)
                .collect(),
        })
    }

    /// True when the candidate names the transcript by whole-path equality. A home prefix is
    /// substituted before dots are resolved, as the shell expands it.
    fn names(&self, candidate: &str, cwd: Option<&str>) -> bool {
        let segments = path_segments(candidate);
        let home_expanded = segments
            .first()
            .is_some_and(|head| self.home_prefixes.iter().any(|prefix| prefix == head));
        let joined = shell_path(candidate, cwd);
        let resolved = if home_expanded {
            let home = self.home_segments.iter().map(String::as_str);
            let expanded: Vec<&str> = home.chain(segments.iter().skip(1).copied()).collect();
            rooted_segments(expanded)
        } else if joined.starts_with('/') {
            rooted_segments(path_segments(&joined))
        } else {
            resolve_dot_segments(&path_segments(&joined))
        };
        resolved.len() == self.target.len()
            && resolved
                .iter()
                .zip(&self.target)
                .all(|(left, right)| left == right)
    }

    /// True when the token, any path candidate inside it, or the token as a whole names the
    /// transcript. A quoted word is one word to the shell, so it can hold a space.
    pub fn names_token(&self, token: &str, cwd: Option<&str>) -> bool {
        path_candidates(token)
            .chain(std::iter::once(token))
            .flat_map(path_forms)
            .any(|candidate| self.names(candidate, cwd))
    }
}

pub fn registration(
    path: &str,
    root: &str,
    home: Option<&str>,
    mutating_tool_names: &[String],
) -> Option<Registration> {
    let transcript = Transcript::new(path, home)?;
    Some(Registration {
        label: "transcript-mod".to_string(),
        judge: Judge::TranscriptMod(TranscriptMod {
            transcript,
            root: root.to_string(),
            mutating_tool_names: mutating_tool_names.to_vec(),
        }),
    })
}

fn judge_mutating(call: &ToolCall, transcript: &Transcript) -> Option<String> {
    if let Some(change_path) = proven_change_path(call) {
        return transcript.names(change_path, None).then(|| {
            format!(
                "{} would modify the session transcript {change_path}",
                call.name
            )
        });
    }
    // No target is proven here, so the reason reports the observation, not a write.
    let mut strings: Vec<&str> = Vec::new();
    if let Some(args) = &call.args {
        string_values(args, &mut strings);
    }
    strings
        .into_iter()
        .any(|text| transcript.names_token(text, None))
        .then(|| {
            format!(
                "{} names the session transcript {} with no proven target",
                call.name, transcript.path
            )
        })
}

/// The judgment of one call, or `None` when it is upheld and so not routed here. A call whose
/// name is on both the shell and the mutating list is judged on both axes.
pub fn judge(spec: &TranscriptMod, call: &ToolCall, shell: &ShellCall) -> Option<Judgment> {
    let transcript = &spec.transcript;
    if shell.is_shell {
        let cwd = join_under(&spec.root, call.cwd.as_deref().unwrap_or("."));
        if let Some(reason) = judge_shell(&shell.lines, &Target::Transcript(transcript), Some(&cwd))
        {
            return Some(Judgment::Broken(reason));
        }
    }
    if spec
        .mutating_tool_names
        .iter()
        .any(|name| !name.is_empty() && *name == call.name)
    {
        return judge_mutating(call, transcript).map(Judgment::Broken);
    }
    None
}

impl TranscriptMod {
    pub fn subject(&self) -> &str {
        &self.transcript.path
    }
}
