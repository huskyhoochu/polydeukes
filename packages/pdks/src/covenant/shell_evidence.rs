//! The shell signals that name no path: a command that may write somewhere the text does not
//! reveal. A command with no write signal at all produces none, so a read leaves no row.

use super::bash_line::{SimpleCommand, Tokenized, command_name_word, is_nested_shell_command};
use super::mutation_rules::{command_basename, detect_without_redirects, is_write_redirect};

/// Whether a write target text names a path: not opaque, not home-relative, and not a
/// relative path on a line that changes directory (which base applies depends on execution).
fn target_is_known(text: &str, opaque: bool, moves_directory: bool) -> bool {
    let relative_after_cd = moves_directory && !text.starts_with('/');
    !(opaque || text.starts_with('~') || relative_after_cd)
}

/// Subshell groups are invisible to the tokenizer: `(` and `)` are ordinary word characters.
fn has_subshell_marker(command: &SimpleCommand) -> bool {
    command
        .words
        .iter()
        .any(|word| word.text.starts_with('(') || word.text.ends_with(')'))
}

fn command_has_pathless_signal(command: &SimpleCommand, moves_directory: bool) -> bool {
    if command_name_word(command)
        .is_some_and(|name| is_nested_shell_command(command_basename(name)))
    {
        return true;
    }
    let mut writes = command
        .redirects
        .iter()
        .filter(|redirect| is_write_redirect(&redirect.operator, &redirect.target))
        .peekable();
    let unknown_write = writes.clone().any(|redirect| {
        !target_is_known(
            &redirect.target.text,
            redirect.target.opaque,
            moves_directory,
        )
    });
    if has_subshell_marker(command) {
        return writes.peek().is_none() || unknown_write;
    }
    let detected = detect_without_redirects(command);
    if writes.peek().is_some() || !detected.is_empty() {
        return unknown_write
            || detected
                .iter()
                .any(|found| !target_is_known(found.path, false, moves_directory));
    }
    command.words.iter().any(|word| word.opaque)
}

/// True when the line has a span the scan could not read or a command with a write signal
/// whose target is unknowable.
pub fn has_pathless_signal(line: &Tokenized) -> bool {
    if !line.unread.is_empty() {
        return true;
    }
    // A directory change is line-scoped and order-blind: a write before it is as ambiguous
    // as one after.
    let moves_directory = line.commands.iter().any(|command| {
        command_name_word(command).is_some_and(|name| {
            !name.opaque && matches!(command_basename(name), "cd" | "pushd" | "popd")
        })
    });
    line.commands
        .iter()
        .any(|command| command_has_pathless_signal(command, moves_directory))
}
