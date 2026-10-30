//! Path notation inside a shell line, resolved against a working directory without reading
//! disk.

use super::bash_line::SimpleCommand;
use super::mention::{path_candidates, path_matches_protected};
use super::mutation_rules::command_basename;

/// A relative path joined onto the working directory; absolute paths and an unknown or `.`
/// directory leave it as written.
pub fn shell_path(path: &str, cwd: Option<&str>) -> String {
    match cwd {
        Some(dir) if dir != "." && !path.starts_with('/') => format!("{dir}/{path}"),
        _ => path.to_string(),
    }
}

/// The directory a word of the command is relative to. The command name and the literal
/// arguments of `echo` and `printf` name no files.
pub fn shell_word_cwd<'a>(
    command: &SimpleCommand,
    index: usize,
    cwd: Option<&'a str>,
) -> Option<&'a str> {
    let prints = command
        .words
        .first()
        .is_some_and(|head| matches!(command_basename(head), "echo" | "printf"));
    if index == 0 || prints { None } else { cwd }
}

/// True when a shell token names the protected path as written or once joined onto `cwd`.
pub fn mentions_shell_path(value: &str, path: &str, cwd: Option<&str>) -> bool {
    path_candidates(value).any(|candidate| {
        path_matches_protected(candidate, path)
            || path_matches_protected(&shell_path(candidate, cwd), path)
    })
}
