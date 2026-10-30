//! Detection rules over one simple command: the paths it writes without being asked by a
//! mention alone. Each rule stays silent on an opaque token, so an unknowable value is never
//! reported as a confident path; the judges treat the opaque token separately.

use super::bash_line::{SimpleCommand, Word};

/// A path a rule found, with the name of the rule that found it.
pub struct Detected<'a> {
    pub rule: &'static str,
    pub path: &'a str,
}

/// The final path segment of a command word (`/usr/bin/tee` is `tee`).
pub fn command_basename(word: &Word) -> &str {
    word.text.rsplit('/').next().unwrap_or_default()
}

/// A `>&`-family target that names a file descriptor: digits, `-`, or digits and `-`.
pub fn is_fd_reference(text: &str) -> bool {
    let digits = text.strip_suffix('-').unwrap_or(text);
    text == "-" || (!digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()))
}

/// A write-direction redirect that is not an fd duplication.
pub fn is_write_redirect(operator: &str, target: &Word) -> bool {
    operator.contains('>') && !(operator.ends_with(">&") && is_fd_reference(&target.text))
}

fn redirect_write<'a>(command: &'a SimpleCommand, found: &mut Vec<Detected<'a>>) {
    for redirect in &command.redirects {
        if is_write_redirect(&redirect.operator, &redirect.target) && !redirect.target.opaque {
            found.push(Detected {
                rule: "redirect-write",
                path: &redirect.target.text,
            });
        }
    }
}

/// Every non-flag argument of a `tee` command; flags end at `--`.
fn tee<'a>(command: &'a SimpleCommand, found: &mut Vec<Detected<'a>>) {
    let Some((first, args)) = command.words.split_first() else {
        return;
    };
    if first.opaque || command_basename(first) != "tee" {
        return;
    }
    let mut options_ended = false;
    for word in args {
        if !options_ended {
            if word.text == "--" {
                options_ended = true;
                continue;
            }
            if word.text.starts_with('-') && word.text != "-" {
                continue;
            }
        }
        if !word.opaque {
            found.push(Detected {
                rule: "tee",
                path: &word.text,
            });
        }
    }
}

fn is_in_place_flag(text: &str) -> bool {
    text.starts_with("-i") || text == "--in-place" || text.starts_with("--in-place=")
}

/// Script flags whose value arrives in the next word.
const SEPARATED_SCRIPT_FLAGS: [&str; 4] = ["-e", "-f", "--expression", "--file"];

fn is_script_flag(text: &str) -> bool {
    SEPARATED_SCRIPT_FLAGS.contains(&text)
        || text.starts_with("-e")
        || text.starts_with("-f")
        || text.starts_with("--expression=")
        || text.starts_with("--file=")
}

/// The file operands of an in-place `sed`. Without a script flag the first operand is the
/// script itself.
fn sed_in_place<'a>(command: &'a SimpleCommand, found: &mut Vec<Detected<'a>>) {
    let Some((first, args)) = command.words.split_first() else {
        return;
    };
    if first.opaque || command_basename(first) != "sed" {
        return;
    }
    if !args.iter().any(|word| is_in_place_flag(&word.text)) {
        return;
    }
    let mut options_ended = false;
    let mut skip_next = false;
    let mut script_skipped = args.iter().any(|word| is_script_flag(&word.text));
    for word in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if !options_ended {
            if word.text == "--" {
                options_ended = true;
                continue;
            }
            if word.text.starts_with('-') && word.text != "-" {
                skip_next = SEPARATED_SCRIPT_FLAGS.contains(&word.text.as_str());
                continue;
            }
        }
        if !script_skipped {
            script_skipped = true;
            continue;
        }
        if !word.opaque {
            found.push(Detected {
                rule: "sed-in-place",
                path: &word.text,
            });
        }
    }
}

/// Every path the three rules detect, in the order redirect-write, tee, sed-in-place. The
/// judges report the first, so this order is the order of their stderr reasons.
pub fn detect(command: &SimpleCommand) -> Vec<Detected<'_>> {
    let mut found = Vec::new();
    redirect_write(command, &mut found);
    tee(command, &mut found);
    sed_in_place(command, &mut found);
    found
}

/// The paths of `tee` and in-place `sed` only: writes with no redirect.
pub fn detect_without_redirects(command: &SimpleCommand) -> Vec<Detected<'_>> {
    let mut found = Vec::new();
    tee(command, &mut found);
    sed_in_place(command, &mut found);
    found
}
