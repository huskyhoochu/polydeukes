//! Unified diff to the input IR: one pure translation, no judgment and no disk.
//!
//! The accepted grammar is finite: `diff --git` blocks and header-less `---`/`+++` blocks,
//! covering creation, deletion, modification, mode-only changes, renames and binary blobs.
//! Anything else is an error, so an unrecognised shape fails the run closed instead of
//! translating to a partial observation.
//!
//! A modification's `pre` and `post` are the hunk's `-` and `+` lines, never the whole file.
//! A creation and a deletion carry the whole text because every line of the file is in the
//! hunk.

use serde_json::{Value, json};

use crate::core::protocol::{Input, ToolCall};
use crate::core::validation::js_trim;

/// The tool name a staged write is dispatched under.
pub const STAGED_WRITE: &str = "staged-write";
/// The tool name a staged deletion is dispatched under.
pub const STAGED_DELETE: &str = "staged-delete";

/// What a `---` or `+++` line names.
#[derive(PartialEq)]
enum Side {
    DevNull,
    Path(String),
}

impl Side {
    fn path(&self) -> Option<String> {
        match self {
            Self::DevNull => None,
            Self::Path(path) => Some(path.clone()),
        }
    }
}

/// What one file block of the diff says, before it becomes tool calls.
#[derive(Default)]
struct Block {
    /// The `diff --git` header's two paths, when the block carries that header.
    header_paths: Option<(String, String)>,
    old_path: Option<Side>,
    new_path: Option<Side>,
    rename_from: Option<String>,
    rename_to: Option<String>,
    binary: bool,
    /// `deleted file mode` seen: the only sign of a deletion when the file was empty.
    deleted_file: bool,
    /// `new file mode` seen: the only sign of a creation when the file is empty.
    new_file: bool,
    removed: Vec<String>,
    added: Vec<String>,
}

fn strip_once(path: &str, prefix: &str) -> String {
    path.strip_prefix(prefix).unwrap_or(path).to_string()
}

/// A path as git prints it after `rename from` / `rename to`: quoted only when it has to be.
fn read_bare_path(raw: &str) -> String {
    if raw.starts_with('"') {
        unquote_path(raw)
    } else {
        raw.to_string()
    }
}

/// Decode git's C-quoted path form. The octal escapes are bytes of the path, so they are
/// collected and decoded as UTF-8 together.
fn unquote_path(quoted: &str) -> String {
    let mut chars = quoted.chars();
    chars.next();
    chars.next_back();
    let mut bytes: Vec<u8> = Vec::new();
    let mut buffer = [0; 4];
    while let Some(character) = chars.next() {
        if character != '\\' {
            bytes.extend(character.encode_utf8(&mut buffer).bytes());
            continue;
        }
        let octal: String = chars.as_str().chars().take(3).collect();
        if octal.len() == 3 && octal.chars().all(|digit| ('0'..='7').contains(&digit)) {
            let value = u32::from_str_radix(&octal, 8).unwrap_or_default();
            bytes.push(u8::try_from(value & 0xff).unwrap_or_default());
            chars.nth(2);
            continue;
        }
        match chars.next() {
            Some('t') => bytes.push(0x09),
            Some('n') => bytes.push(0x0a),
            Some('r') => bytes.push(0x0d),
            Some(other) => bytes.extend(other.encode_utf8(&mut buffer).bytes().take(1)),
            None => {}
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// The side a `---`/`+++` line names. A quoted path is unquoted
/// before anything is cut, because a quoted path may itself contain a tab; an unquoted one is
/// cut at the tab `diff -u` puts its timestamp behind. Exactly one `a/` or `b/` level is
/// stripped, so a repository directory literally named `a/` survives.
fn read_path(rest: &str, prefix: &str) -> Side {
    let path = if rest.starts_with('"') {
        let end = rest.rfind('"').map_or(rest.len(), |at| at + 1);
        unquote_path(rest.get(..end).unwrap_or(rest))
    } else {
        rest.split_once('\t')
            .map_or(rest, |(path, _)| path)
            .to_string()
    };
    if path == "/dev/null" {
        Side::DevNull
    } else {
        Side::Path(strip_once(&path, prefix))
    }
}

/// The two paths of a `diff --git a/X b/Y` header, or `None` when they cannot be read.
fn read_header_paths(rest: &str) -> Option<(String, String)> {
    if rest.starts_with('"') {
        let end = rest.find("\" \"")?;
        let old = unquote_path(rest.get(..=end)?);
        let new = unquote_path(rest.get(end + 2..)?);
        return Some((strip_once(&old, "a/"), strip_once(&new, "b/")));
    }
    // Unquoted paths may contain spaces, and git writes no separator between the two. The
    // halves are equal in length whenever the prefixes are, which is git's own output; the
    // midpoint split is what recovers them. Lengths count UTF-16 units, as the original does.
    let units = rest.encode_utf16().count();
    let middle = (units % 2 == 1).then_some(units / 2);
    let mut offset = 0;
    let split = middle.and_then(|middle| {
        rest.char_indices().find_map(|(index, character)| {
            let at = offset;
            offset += character.len_utf16();
            (middle > 0 && at == middle && character == ' ').then_some(index)
        })
    });
    let (old, new) = match split.and_then(|index| rest.split_at_checked(index)) {
        Some((old, tail)) => (old, tail.strip_prefix(' ')?),
        None => rest.split_once(' ')?,
    };
    Some((strip_once(old, "a/"), strip_once(new, "b/")))
}

/// A run of ASCII digits at the start of `text` and what follows it.
fn number(text: &str) -> Option<(usize, &str)> {
    let end = text
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(text.len());
    let (digits, rest) = text.split_at_checked(end)?;
    if digits.is_empty() {
        return None;
    }
    Some((digits.parse().unwrap_or(usize::MAX), rest))
}

/// A line count that is `,N` or, when omitted, 1.
fn count(text: &str) -> Option<(usize, &str)> {
    match text.strip_prefix(',') {
        Some(rest) => number(rest),
        None => Some((1, text)),
    }
}

/// The old and new line counts a hunk header declares, or `None` when the line is not one.
fn read_hunk_counts(line: &str) -> Option<(usize, usize)> {
    let (_, rest) = number(line.strip_prefix("@@ -")?)?;
    let (old, rest) = count(rest)?;
    let (_, rest) = number(rest.strip_prefix(" +")?)?;
    let (new, rest) = count(rest)?;
    rest.starts_with(" @@").then_some((old, new))
}

/// Split the text into file blocks, reading hunk bodies by the line counts their headers
/// declare. The counts keep a removed `-- note` line (which reads as `--- note`) from being
/// taken for a new file header: header lines are only recognised outside a hunk.
fn parse_blocks(text: &str) -> Result<Vec<Block>, String> {
    let mut lines = text.split('\n').peekable();
    let mut blocks: Vec<Block> = Vec::new();
    let mut current: Option<Block> = None;

    while let Some(line) = lines.next() {
        // The empty element after the final newline is not a line.
        if line.is_empty() && lines.peek().is_none() {
            continue;
        }

        if line.starts_with("diff --cc ") || line.starts_with("diff --combined ") {
            return Err(format!(
                "unified diff: combined diffs are not translatable: {line}"
            ));
        }

        if let Some(rest) = line.strip_prefix("diff --git ") {
            blocks.extend(current.take());
            current = Some(Block {
                header_paths: read_header_paths(rest),
                ..Block::default()
            });
            continue;
        }

        if let Some(rest) = line.strip_prefix("--- ") {
            // A second `---` outside a hunk starts a new header-less block.
            if current
                .as_ref()
                .is_some_and(|block| block.old_path.is_some())
            {
                blocks.extend(current.take());
            }
            current.get_or_insert_default().old_path = Some(read_path(rest, "a/"));
            continue;
        }

        if let Some(rest) = line.strip_prefix("+++ ") {
            let block = current.get_or_insert_default();
            if block.old_path.is_none() {
                return Err(format!(
                    "unified diff: '+++' line with no '---' partner: {line}"
                ));
            }
            block.new_path = Some(read_path(rest, "b/"));
            continue;
        }

        if let Some((mut old_left, mut new_left)) = read_hunk_counts(line) {
            let block = current.get_or_insert_default();
            if (block.old_path.is_none() || block.new_path.is_none())
                && block.header_paths.is_none()
            {
                return Err(format!("unified diff: hunk with no file header: {line}"));
            }
            while old_left > 0 || new_left > 0 {
                let body = match lines.next() {
                    Some(body) if !(body.is_empty() && lines.peek().is_none()) => body,
                    _ => {
                        return Err("unified diff: hunk ends before its declared lines".to_string());
                    }
                };
                if body.starts_with('\\') {
                    continue;
                }
                // A line the declared counts have no room for is a malformed hunk: judging the
                // lines that fit and dropping the rest would be an observation smaller than
                // the input, so the whole run fails closed instead.
                if let Some(added) = body.strip_prefix('+')
                    && new_left > 0
                {
                    block.added.push(added.to_string());
                    new_left -= 1;
                } else if let Some(removed) = body.strip_prefix('-')
                    && old_left > 0
                {
                    block.removed.push(removed.to_string());
                    old_left -= 1;
                } else if (body.starts_with(' ') || body.is_empty()) && old_left > 0 && new_left > 0
                {
                    old_left -= 1;
                    new_left -= 1;
                } else {
                    return Err(format!("unified diff: unknown hunk line: {body}"));
                }
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("rename from ") {
            current.get_or_insert_default().rename_from = Some(read_bare_path(rest));
        } else if let Some(rest) = line.strip_prefix("rename to ") {
            current.get_or_insert_default().rename_to = Some(read_bare_path(rest));
        } else if line.starts_with("deleted file mode ") {
            current.get_or_insert_default().deleted_file = true;
        } else if line.starts_with("new file mode ") {
            current.get_or_insert_default().new_file = true;
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            let block = current.get_or_insert_default();
            block.binary = true;
            if line.ends_with("and /dev/null differ") {
                block.deleted_file = true;
            }
        }
        // Everything else outside a hunk is an extended header line (`index`, `old mode`,
        // `similarity index`, a binary patch's base85 payload) that names nothing this
        // translation reads.
    }

    blocks.extend(current);
    Ok(blocks)
}

fn tool_call(name: &str, path: &str, file_change: Option<Value>) -> ToolCall {
    ToolCall {
        name: name.to_string(),
        args: Some(json!({ "file_path": path })),
        cwd: None,
        file_change,
    }
}

/// The tool calls one block translates to, in the order the judgment sees them.
fn block_tool_calls(block: &Block) -> Result<Vec<ToolCall>, String> {
    let removed = block.removed.join("\n");
    let added = block.added.join("\n");

    if let (Some(from), Some(to)) = (&block.rename_from, &block.rename_to) {
        return Ok(vec![
            tool_call(
                STAGED_DELETE,
                from,
                Some(json!({ "kind": "delete", "path": from })),
            ),
            tool_call(
                STAGED_WRITE,
                to,
                Some(json!({ "kind": "modify", "path": to, "pre": removed, "post": added })),
            ),
        ]);
    }

    // An empty file's deletion or creation carries no `---`/`+++` pair and no hunk, so the
    // mode line is the only evidence of which one it is.
    let deletion = block.new_path == Some(Side::DevNull) || block.deleted_file;
    let (named, from_header) = if deletion {
        (
            block.old_path.as_ref().and_then(Side::path),
            block.header_paths.as_ref().map(|(old, _)| old.clone()),
        )
    } else {
        (
            block.new_path.as_ref().and_then(Side::path),
            block.header_paths.as_ref().map(|(_, new)| new.clone()),
        )
    };
    let Some(path) = named.or(from_header) else {
        return Err("unified diff: a file block names no path".to_string());
    };

    if block.binary {
        let name = if deletion {
            STAGED_DELETE
        } else {
            STAGED_WRITE
        };
        return Ok(vec![tool_call(name, &path, None)]);
    }
    if deletion {
        let change = json!({ "kind": "delete", "path": path, "pre": removed });
        return Ok(vec![tool_call(STAGED_DELETE, &path, Some(change))]);
    }
    let change = if block.old_path == Some(Side::DevNull) || block.new_file {
        json!({ "kind": "create", "path": path, "post": added })
    } else {
        json!({ "kind": "modify", "path": path, "pre": removed, "post": added })
    };
    Ok(vec![tool_call(STAGED_WRITE, &path, Some(change))])
}

/// Translate a unified diff into the input IR: one tool call per file block in input order (a
/// rename is two, the deletion first), and no actor, because a diff proves no author.
pub fn translate(text: &str) -> Result<Input, String> {
    let blocks = parse_blocks(text)?;
    // Text that is not blank yet contains no recognised block (a colored diff, a pager
    // banner) must not translate to "nothing staged": an empty observation is a pass, and
    // this input may describe a whole commit.
    if blocks.is_empty() && !js_trim(text).is_empty() {
        return Err("unified diff: no file block recognized in the input".to_string());
    }
    let mut tool_calls = Vec::new();
    for block in &blocks {
        if let (Some(old), None) = (&block.old_path, &block.new_path) {
            return Err(format!(
                "unified diff: '---' line with no '+++' partner: {}",
                match old {
                    Side::DevNull => "null",
                    Side::Path(path) => path,
                }
            ));
        }
        tool_calls.extend(block_tool_calls(block)?);
    }
    Ok(Input {
        tool_calls,
        has_world: false,
        actor: None,
        tools: None,
        session: None,
    })
}
