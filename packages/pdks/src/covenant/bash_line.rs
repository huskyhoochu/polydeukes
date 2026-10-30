//! Shell command-line tokenizer: a single-pass scanner that reads quote state, control and
//! redirect operators, heredocs, and marks a word opaque when its value cannot be known
//! statically (substitution, expansion, glob).
//!
//! It never fails and never discards what it read. A construct it cannot finish reading
//! becomes one `unread` span and the scan carries on, so the commands around it still reach
//! the judge. All delimiters are ASCII, so positions are byte offsets the scan itself made;
//! the character after a backslash is skipped as a whole character.

/// One word with its static-opacity flag (`opaque`: the value is not knowable).
pub struct Word {
    pub text: String,
    pub opaque: bool,
}

pub struct Redirect {
    pub operator: String,
    pub target: Word,
}

#[derive(Default)]
pub struct SimpleCommand {
    pub words: Vec<Word>,
    pub redirects: Vec<Redirect>,
}

/// The commands the scan read, and the raw text of every span it could not read.
pub struct Tokenized {
    pub commands: Vec<SimpleCommand>,
    pub unread: Vec<String>,
}

/// A command whose first word is one of these re-parses its string arguments in a nested
/// shell, so the tokenizer reports it instead of parsing into it.
pub fn is_nested_shell_command(name: &str) -> bool {
    matches!(name, "eval" | "bash" | "sh" | "zsh")
}

fn is_assignment_word(text: &str) -> bool {
    let Some((name, _)) = text.split_once('=') else {
        return false;
    };
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

/// The word that names the command, skipping leading `NAME=VALUE` assignments.
pub fn command_name_word(command: &SimpleCommand) -> Option<&Word> {
    command
        .words
        .iter()
        .find(|word| !is_assignment_word(&word.text))
}

fn char_at(line: &str, i: usize) -> Option<char> {
    line.get(i..)?.chars().next()
}

fn bytes_at(line: &str, i: usize) -> &[u8] {
    line.as_bytes().get(i..).unwrap_or_default()
}

fn slice(line: &str, start: usize, end: usize) -> &str {
    line.get(start..end).unwrap_or_default()
}

fn find_from(line: &str, needle: char, from: usize) -> Option<usize> {
    line.get(from..)?.find(needle).map(|offset| from + offset)
}

/// A double-quoted span: the content bash would pass, where it ended, whether it closed,
/// and whether it holds an unpaired backtick (a command substitution that never ends).
struct Quoted {
    text: String,
    next: usize,
    closed: bool,
    open_backtick: bool,
}

/// Inside double quotes bash removes a backslash only before `$` `` ` `` `"` `\` and a
/// newline; before anything else the backslash is content.
fn scan_double_quoted(line: &str, open: usize) -> Quoted {
    let mut text = String::new();
    let mut backticks = 0;
    let mut i = open + 1;
    while let Some(ch) = char_at(line, i) {
        match ch {
            '\\' => match char_at(line, i + 1) {
                Some('\n') => i += 2,
                Some(next @ ('$' | '`' | '"' | '\\')) => {
                    text.push(next);
                    i += 2;
                }
                _ => {
                    text.push('\\');
                    i += 1;
                }
            },
            '"' => {
                return Quoted {
                    text,
                    next: i + 1,
                    closed: true,
                    open_backtick: backticks % 2 == 1,
                };
            }
            _ => {
                backticks += usize::from(ch == '`');
                text.push(ch);
                i += ch.len_utf8();
            }
        }
    }
    Quoted {
        text,
        next: line.len(),
        closed: false,
        open_backtick: backticks % 2 == 1,
    }
}

/// An ANSI-C span (`$'…'`). An escape outside the small decoded table keeps its source
/// spelling and clears `decoded`, because the text is then not the bytes bash passes.
struct AnsiC {
    text: String,
    next: usize,
    closed: bool,
    decoded: bool,
}

fn scan_ansi_c_quoted(line: &str, open: usize) -> AnsiC {
    let mut text = String::new();
    let mut decoded = true;
    let mut i = open + 1;
    while let Some(ch) = char_at(line, i) {
        match ch {
            '\\' => {
                let Some(next) = char_at(line, i + 1) else {
                    break;
                };
                match next {
                    'n' => text.push('\n'),
                    't' => text.push('\t'),
                    '\'' | '\\' => text.push(next),
                    _ => {
                        decoded = false;
                        text.push('\\');
                        text.push(next);
                    }
                }
                i += 1 + next.len_utf8();
            }
            '\'' => {
                return AnsiC {
                    text,
                    next: i + 1,
                    closed: true,
                    decoded,
                };
            }
            _ => {
                text.push(ch);
                i += ch.len_utf8();
            }
        }
    }
    AnsiC {
        text,
        next: line.len(),
        closed: false,
        decoded,
    }
}

struct Scanned {
    word: Word,
    next: usize,
    unread: Option<String>,
}

/// Close a word on a construct that never ends: the rest of the input is consumed, the word
/// is opaque, and the raw span is reported.
fn unread_from(line: &str, open: usize, text: String) -> Scanned {
    Scanned {
        word: Word { text, opaque: true },
        next: line.len(),
        unread: Some(slice(line, open, line.len()).to_string()),
    }
}

fn scan_word(line: &str, start: usize) -> Scanned {
    let mut text = String::new();
    let mut opaque = false;
    let mut i = start;
    while let Some(ch) = char_at(line, i) {
        match ch {
            ' ' | '\t' | '\n' | ';' | '|' | '&' | '<' | '>' => break,
            '\\' => match char_at(line, i + 1) {
                Some('\n') => i += 2,
                Some(next) => {
                    text.push(next);
                    i += 1 + next.len_utf8();
                }
                None => {
                    text.push(ch);
                    i += 1;
                }
            },
            '\'' => {
                let Some(close) = find_from(line, '\'', i + 1) else {
                    let rest = slice(line, i + 1, line.len());
                    return unread_from(line, i, text + rest);
                };
                text.push_str(slice(line, i + 1, close));
                i = close + 1;
            }
            '"' => {
                let quoted = scan_double_quoted(line, i);
                if !quoted.closed || quoted.open_backtick {
                    return unread_from(line, i, text + &quoted.text);
                }
                opaque |= quoted.text.contains(['$', '`']);
                text.push_str(&quoted.text);
                i = quoted.next;
            }
            '$' if char_at(line, i + 1) == Some('\'') => {
                let quoted = scan_ansi_c_quoted(line, i + 1);
                if !quoted.closed {
                    return unread_from(line, i, text + &quoted.text);
                }
                opaque |= !quoted.decoded;
                text.push_str(&quoted.text);
                i = quoted.next;
            }
            '$' if char_at(line, i + 1) == Some('(') => {
                let (end, closed) = match_paren(line, i + 1);
                let chunk = slice(line, i, end);
                if !closed {
                    return unread_from(line, i, text + chunk);
                }
                text.push_str(chunk);
                opaque = true;
                i = end;
            }
            '`' => {
                let Some(close) = find_from(line, '`', i + 1) else {
                    return unread_from(line, i, text + slice(line, i, line.len()));
                };
                text.push_str(slice(line, i, close + 1));
                opaque = true;
                i = close + 1;
            }
            _ => {
                opaque |= matches!(ch, '$' | '*' | '?');
                text.push(ch);
                i += ch.len_utf8();
            }
        }
    }
    Scanned {
        word: Word { text, opaque },
        next: i,
        unread: None,
    }
}

/// Where the substitution whose `(` sits at `open` ends, and whether the scan reached that
/// end. Quoting suspends the parenthesis count.
fn match_paren(line: &str, open: usize) -> (usize, bool) {
    let mut depth = 0_usize;
    let mut i = open;
    while let Some(ch) = char_at(line, i) {
        match ch {
            '\\' => {
                i += 1 + char_at(line, i + 1).map_or(0, char::len_utf8);
                continue;
            }
            '\'' => {
                let Some(close) = find_from(line, '\'', i + 1) else {
                    return (line.len(), false);
                };
                i = close;
            }
            '"' => {
                let quoted = scan_double_quoted(line, i);
                if !quoted.closed {
                    return (line.len(), false);
                }
                i = quoted.next - 1;
            }
            '(' => depth += 1,
            ')' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return (i + 1, true);
                }
            }
            _ => {}
        }
        i += ch.len_utf8();
    }
    (line.len(), false)
}

/// The redirect operator at `i` and its length. Longest forms first; an all-digit fd prefix
/// is part of the operator (`2>`, `12>>`, `2>&`).
fn scan_redirect(line: &str, i: usize) -> Option<(&str, usize)> {
    let rest = bytes_at(line, i);
    let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
    if digits > 0 && rest.get(digits) == Some(&b'>') {
        let tail = rest.get(digits + 1);
        let length = if matches!(tail, Some(b'>' | b'&' | b'|')) {
            digits + 2
        } else {
            digits + 1
        };
        return Some((slice(line, i, i + length), length));
    }
    for operator in [
        "&>>", "<<<", "<<-", ">>", ">|", "&>", ">&", "<&", "<<", ">", "<",
    ] {
        if rest.starts_with(operator.as_bytes()) {
            return Some((operator, operator.len()));
        }
    }
    None
}

fn scan_control(line: &str, i: usize) -> Option<usize> {
    let rest = bytes_at(line, i);
    if rest.starts_with(b"&&") || rest.starts_with(b"||") {
        Some(2)
    } else if matches!(rest.first(), Some(b';' | b'|' | b'&')) {
        Some(1)
    } else {
        None
    }
}

struct PendingHeredoc {
    delimiter: String,
    strip_tabs: bool,
}

/// Skip the bodies of the queued heredocs, which start at `start` just past a newline. Body
/// lines are data, never commands, until a line equals the delimiter or the input ends.
fn skip_heredoc_bodies(line: &str, start: usize, pending: &[PendingHeredoc]) -> usize {
    let mut i = start;
    for heredoc in pending {
        while i < line.len() {
            let end = find_from(line, '\n', i).unwrap_or(line.len());
            let body_line = slice(line, i, end);
            i = end + 1;
            let stripped = if heredoc.strip_tabs {
                body_line.trim_start_matches('\t')
            } else {
                body_line
            };
            if stripped == heredoc.delimiter {
                break;
            }
        }
    }
    i
}

fn skip_spaces(line: &str, mut i: usize) -> usize {
    while matches!(char_at(line, i), Some(' ' | '\t')) {
        i += 1;
    }
    i
}

/// Whether a word can begin at `i`: at the line start, after whitespace, or after a control or
/// redirect operator. A `#` anywhere else (`<(true)#`) is word text, not a comment.
fn starts_word(line: &str, i: usize) -> bool {
    line.get(..i)
        .and_then(|before| before.chars().next_back())
        .is_none_or(|prev| prev.is_whitespace() || matches!(prev, ';' | '|' | '&' | '<' | '>'))
}

/// Tokenize one shell line into simple commands.
pub fn tokenize_command_line(line: &str) -> Tokenized {
    let mut commands = Vec::new();
    let mut unread = Vec::new();
    let mut current = SimpleCommand::default();
    let mut pending: Vec<PendingHeredoc> = Vec::new();
    let mut i = 0;

    while let Some(ch) = char_at(line, i) {
        if ch == ' ' || ch == '\t' {
            i += 1;
        } else if ch == '\n' {
            commands.push(std::mem::take(&mut current));
            i = skip_heredoc_bodies(line, i + 1, &pending);
            pending.clear();
        } else if ch == '#' && starts_word(line, i) {
            i = find_from(line, '\n', i).unwrap_or(line.len());
        } else if matches!(ch, '<' | '>') && char_at(line, i + 1) == Some('(') {
            // Process substitution is a word bash executes, not a redirect.
            let (end, closed) = match_paren(line, i + 1);
            current.words.push(Word {
                text: slice(line, i, end).to_string(),
                opaque: true,
            });
            if !closed {
                unread.push(slice(line, i, line.len()).to_string());
            }
            i = end;
        } else if let Some((operator, length)) = scan_redirect(line, i) {
            let j = skip_spaces(line, i + length);
            if matches!(char_at(line, j), Some('<' | '>')) && char_at(line, j + 1) == Some('(') {
                let (end, closed) = match_paren(line, j + 1);
                current.redirects.push(Redirect {
                    operator: operator.to_string(),
                    target: Word {
                        text: slice(line, j, end).to_string(),
                        opaque: true,
                    },
                });
                if !closed {
                    unread.push(slice(line, j, line.len()).to_string());
                }
                i = end;
                continue;
            }
            let scanned = scan_word(line, j);
            if let Some(span) = scanned.unread {
                unread.push(span);
                i = scanned.next;
            } else if scanned.word.text.is_empty() {
                unread.push(slice(line, i, j).to_string());
                i = j;
            } else if operator == "<<" || operator == "<<-" {
                pending.push(PendingHeredoc {
                    delimiter: scanned.word.text,
                    strip_tabs: operator == "<<-",
                });
                i = scanned.next;
            } else {
                let mut target = scanned.word;
                target.opaque |= target.text.starts_with('(');
                current.redirects.push(Redirect {
                    operator: operator.to_string(),
                    target,
                });
                i = scanned.next;
            }
        } else if let Some(length) = scan_control(line, i) {
            commands.push(std::mem::take(&mut current));
            i += length;
        } else {
            let scanned = scan_word(line, i);
            unread.extend(scanned.unread);
            current.words.push(scanned.word);
            i = scanned.next;
        }
    }
    commands.push(current);
    commands.retain(|command| !command.words.is_empty() || !command.redirects.is_empty());
    Tokenized { commands, unread }
}
