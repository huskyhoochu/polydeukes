//! The shell judgment shared by the shell-mod and transcript-mod covenants: a shell command
//! that mentions the compared target breaks. The ladder below only picks which sentence
//! explains the break.

use super::bash_line::{SimpleCommand, Tokenized};
use super::dispatch::{Judge, Registration, ShellCall};
use super::mention::untokenizable_line_candidates;
use super::mutation_rules::detect;
use super::run_covenant::Judgment;
use super::shell_path::{mentions_shell_path, shell_word_cwd};
use super::transcript_mod::Transcript;

/// What a shell line is compared with.
pub enum Target<'a> {
    /// The protected paths: ancestor, descendant or equal, as written and joined onto `cwd`.
    Protected(&'a [String]),
    /// The session transcript: whole-path equality in every spelling of its location.
    Transcript(&'a Transcript),
}

enum Clause<'a> {
    Unread,
    Detected(&'a str),
    OpaqueRedirect,
    Backstop(&'a str),
}

impl Target<'_> {
    /// The target a text mentions: the first protected path in configuration order that any
    /// of the texts mentions, or the transcript's path.
    fn mention(&self, texts: &[&str], cwd: Option<&str>) -> Option<&str> {
        match self {
            Target::Protected(paths) => paths
                .iter()
                .find(|path| {
                    texts
                        .iter()
                        .any(|text| mentions_shell_path(text, path, cwd))
                })
                .map(String::as_str),
            Target::Transcript(transcript) => texts
                .iter()
                .any(|text| transcript.names_token(text, cwd))
                .then_some(transcript.path.as_str()),
        }
    }

    fn word_cwd<'c>(
        &self,
        command: &SimpleCommand,
        index: usize,
        cwd: Option<&'c str>,
    ) -> Option<&'c str> {
        match self {
            Target::Protected(_) => shell_word_cwd(command, index, cwd),
            Target::Transcript(_) => cwd,
        }
    }

    fn reason(&self, clause: &Clause, hit: &str) -> String {
        let (verb, noun) = match self {
            Target::Protected(_) => ("mentions", format!("protected path {hit}")),
            Target::Transcript(_) => ("names", format!("the session transcript {hit}")),
        };
        match clause {
            Clause::Unread => format!("untokenizable command line {verb} {noun}"),
            Clause::Detected(rule) => format!("{rule} targets {noun}"),
            Clause::OpaqueRedirect => format!("opaque redirect target alongside {noun}"),
            Clause::Backstop(first) => format!("{first} {verb} {noun} without read-only proof"),
        }
    }
}

fn judge_command(command: &SimpleCommand, target: &Target, cwd: Option<&str>) -> Option<String> {
    // (a) A detected write whose target is the compared target.
    for found in detect(command) {
        if let Some(hit) = target.mention(&[found.path], cwd) {
            return Some(target.reason(&Clause::Detected(found.rule), hit));
        }
    }

    // (b) The first word or redirect target that mentions it; heredoc bodies are data. Every
    // token is read, because an opaque mention anywhere decides clause (c).
    let tokens = command
        .words
        .iter()
        .enumerate()
        .map(|(index, word)| (word, target.word_cwd(command, index, cwd)))
        .chain(
            command
                .redirects
                .iter()
                .map(|redirect| (&redirect.target, cwd)),
        );
    let mut mentioned = None;
    let mut mention_is_opaque = false;
    for (token, token_cwd) in tokens {
        let Some(hit) = target.mention(&[&token.text], token_cwd) else {
            continue;
        };
        mentioned.get_or_insert(hit);
        mention_is_opaque |= token.opaque;
    }
    let mentioned = mentioned?;

    // (c) A protected path inside an opaque token (substitution, expansion, glob) is
    // undecidable. The transcript has no such clause: it falls through to (e).
    if mention_is_opaque && matches!(target, Target::Protected(_)) {
        return Some(format!("protected path {mentioned} inside an opaque token"));
    }

    // (d) An opaque write target could resolve to the compared target.
    if command
        .redirects
        .iter()
        .any(|redirect| redirect.operator.contains('>') && redirect.target.opaque)
    {
        return Some(target.reason(&Clause::OpaqueRedirect, mentioned));
    }

    // (e) Backstop: a mention breaks.
    let first = command.words.first().map_or("", |word| word.text.as_str());
    Some(target.reason(&Clause::Backstop(first), mentioned))
}

/// The reason the command lines break against the target, or `None` when none mentions it.
/// For each line, an unread span is answered before the commands, so a mention only the span
/// can see is named as one.
pub fn judge_shell(lines: &[Tokenized], target: &Target, cwd: Option<&str>) -> Option<String> {
    for line in lines {
        // The shell would remove quotes and backslashes, so a target split by them
        // (`sr"c"`) would otherwise defeat the scan that replaces the one they stopped.
        for span in &line.unread {
            let stripped = span.replace(['\'', '"', '\\'], "");
            let candidates = untokenizable_line_candidates(&stripped);
            if let Some(hit) = target.mention(&candidates, cwd) {
                return Some(target.reason(&Clause::Unread, hit));
            }
        }
        for command in &line.commands {
            if let Some(reason) = judge_command(command, target, cwd) {
                return Some(reason);
            }
        }
    }
    None
}

/// Every text the ladder reads, with the directory it is relative to: the candidates of each
/// unread span, the detected write targets, the words and the redirect targets.
fn read_texts<'a>(lines: &[Tokenized], cwd: Option<&'a str>) -> Vec<(String, Option<&'a str>)> {
    let mut texts = Vec::new();
    for line in lines {
        for span in &line.unread {
            let stripped = span.replace(['\'', '"', '\\'], "");
            for candidate in untokenizable_line_candidates(&stripped) {
                texts.push((candidate.to_string(), cwd));
            }
        }
        for command in &line.commands {
            for found in detect(command) {
                texts.push((found.path.to_string(), cwd));
            }
            for (index, word) in command.words.iter().enumerate() {
                texts.push((word.text.clone(), shell_word_cwd(command, index, cwd)));
            }
            for redirect in &command.redirects {
                texts.push((redirect.target.text.clone(), cwd));
            }
        }
    }
    texts
}

/// The row subject of a shell call, or `None` when it is not routed here: the first protected
/// path, in configuration order, that any text of the call mentions. A shell call with no
/// command string cannot be read, so it routes with the placeholder subject and its judgment
/// blocks.
pub fn route<'a>(
    shell: &ShellCall,
    protected_paths: &'a [String],
    cwd: Option<&str>,
) -> Option<&'a str> {
    if !shell.is_shell {
        return None;
    }
    if shell.lines.is_empty() {
        return Some("-");
    }
    let texts = read_texts(&shell.lines, cwd);
    protected_paths
        .iter()
        .find(|path| {
            texts
                .iter()
                .any(|(text, text_cwd)| mentions_shell_path(text, path, *text_cwd))
        })
        .map(String::as_str)
}

pub fn judge(
    call_name: &str,
    shell: &ShellCall,
    protected_paths: &[String],
    cwd: Option<&str>,
) -> Judgment {
    if shell.lines.is_empty() {
        return Judgment::Broken(format!(
            "unjudgeable shell call {call_name}: no command string under any command-arg name"
        ));
    }
    match judge_shell(&shell.lines, &Target::Protected(protected_paths), cwd) {
        Some(reason) => Judgment::Broken(reason),
        None => Judgment::Upheld,
    }
}

pub fn registration(protected_paths: Vec<String>) -> Registration {
    Registration {
        label: "shell-mod",
        judge: Judge::ShellMod { protected_paths },
    }
}
