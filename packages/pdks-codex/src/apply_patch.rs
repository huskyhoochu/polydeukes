//! The V4A patch parser: the raw text of an `apply_patch` call in, one change per file out.
//!
//! Every path leaves exactly as the patch text spelled it. Patch paths are relative to the call's
//! working directory while the judge reads them relative to the project root, so resolving between
//! the two bases belongs to the caller.

use serde_json::{Map, Value};

const BEGIN_PATCH: &str = "*** Begin Patch";
const END_PATCH: &str = "*** End Patch";
const ENVIRONMENT_ID: &str = "*** Environment ID:";
const ADD_FILE: &str = "*** Add File:";
const DELETE_FILE: &str = "*** Delete File:";
const UPDATE_FILE: &str = "*** Update File:";
const MOVE_TO: &str = "*** Move to:";
const END_OF_FILE: &str = "*** End of File";

/// One file the patch changes: `pre` is the text before, `post` the text after.
pub struct FileChange {
    pub kind: &'static str,
    pub path: String,
    pub pre: Option<String>,
    pub post: Option<String>,
}

impl FileChange {
    fn create(path: &str, post: String) -> Self {
        Self {
            kind: "create",
            path: path.to_owned(),
            pre: None,
            post: Some(post),
        }
    }

    fn delete(path: &str, pre: String) -> Self {
        Self {
            kind: "delete",
            path: path.to_owned(),
            pre: Some(pre),
            post: None,
        }
    }

    /// The IR element, naming the change after `path` (which may differ from the patch's own).
    pub fn to_value(&self, path: &str) -> Value {
        let mut change = Map::new();
        change.insert("kind".to_owned(), Value::from(self.kind));
        change.insert("path".to_owned(), Value::from(path));
        if let Some(pre) = &self.pre {
            change.insert("pre".to_owned(), Value::from(pre.as_str()));
        }
        if let Some(post) = &self.post {
            change.insert("post".to_owned(), Value::from(post.as_str()));
        }
        Value::Object(change)
    }
}

/// One file's section of the patch: the header's marker and path, and the lines that follow.
/// A header is recognised at the head of the raw line only, because a change line spells its
/// operator as its first character.
struct Hunk<'a> {
    marker: &'static str,
    path: &'a str,
    body: Vec<&'a str>,
}

/// `String.prototype.trim` in JavaScript: it trims U+FEFF and keeps U+0085.
fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}

/// Parse one `apply_patch` command text into the changes it proves. `read` answers the text at a
/// path, `None` when no file is there.
pub fn parse<F>(command: &str, read: F) -> Result<Vec<FileChange>, String>
where
    F: Fn(&str) -> Result<Option<String>, String>,
{
    let mut changes = Vec::new();
    for hunk in split_hunks(command)? {
        changes.extend(changes_of_hunk(&hunk, &read)?);
    }
    Ok(changes)
}

fn split_hunks(patch: &str) -> Result<Vec<Hunk<'_>>, String> {
    // The whole text is trimmed once, never line by line: a context line may begin with a space.
    let lines: Vec<&str> = js_trim(patch)
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    if lines.first() != Some(&BEGIN_PATCH) {
        return Err(format!("the patch does not start with '{BEGIN_PATCH}'"));
    }
    if lines.last() != Some(&END_PATCH) {
        return Err(format!("the patch does not end with '{END_PATCH}'"));
    }

    let mut hunks: Vec<Hunk> = Vec::new();
    let skipped = 1 + usize::from(
        lines
            .get(1)
            .is_some_and(|line| line.starts_with(ENVIRONMENT_ID)),
    );
    for line in lines.iter().take(lines.len() - 1).skip(skipped).copied() {
        let header = [ADD_FILE, DELETE_FILE, UPDATE_FILE]
            .into_iter()
            .find_map(|marker| line.strip_prefix(marker).map(|rest| (marker, rest)));
        let Some((marker, rest)) = header else {
            match hunks.last_mut() {
                Some(hunk) => hunk.body.push(line),
                None => {
                    return Err(format!(
                        "'{}' appears before any hunk header",
                        js_trim(line)
                    ));
                }
            }
            continue;
        };
        let named = js_trim(rest);
        if named.is_empty() {
            return Err(format!("'{marker}' names no path"));
        }
        hunks.push(Hunk {
            marker,
            path: named,
            body: Vec::new(),
        });
    }
    if hunks.is_empty() {
        return Err("the patch names no file to change".to_owned());
    }
    Ok(hunks)
}

fn require_pre<F>(path: &str, read: &F) -> Result<String, String>
where
    F: Fn(&str) -> Result<Option<String>, String>,
{
    read(path)?.ok_or_else(|| format!("the patch targets '{path}', which does not exist"))
}

fn added_text(body: &[&str], path: &str) -> Result<String, String> {
    let mut text = String::new();
    for line in body {
        let added = line
            .strip_prefix('+')
            .ok_or_else(|| format!("'{path}' has a body line without the '+' prefix"))?;
        text.push_str(added);
        text.push('\n');
    }
    Ok(text)
}

/// The changes one hunk proves; a `Move to` naming two paths proves two of them.
fn changes_of_hunk<F>(hunk: &Hunk, read: &F) -> Result<Vec<FileChange>, String>
where
    F: Fn(&str) -> Result<Option<String>, String>,
{
    if hunk.marker == ADD_FILE {
        return Ok(vec![FileChange::create(
            hunk.path,
            added_text(&hunk.body, hunk.path)?,
        )]);
    }
    if hunk.marker == DELETE_FILE {
        if !hunk.body.is_empty() {
            return Err(format!("'{}' is deleted but carries body lines", hunk.path));
        }
        return Ok(vec![FileChange::delete(
            hunk.path,
            require_pre(hunk.path, read)?,
        )]);
    }

    // The rename directive stands on the line right after the header and nowhere else.
    let moved = hunk
        .body
        .first()
        .and_then(|line| line.strip_prefix(MOVE_TO));
    let body = if moved.is_some() {
        hunk.body.get(1..).unwrap_or_default()
    } else {
        hunk.body.as_slice()
    };
    let pre = require_pre(hunk.path, read)?;
    let post = apply_update(&pre, body, hunk.path)?;

    let Some(destination) = moved else {
        return Ok(vec![FileChange {
            kind: "modify",
            path: hunk.path.to_owned(),
            pre: Some(pre),
            post: Some(post),
        }]);
    };
    let destination = js_trim(destination);
    if destination.is_empty() {
        return Err(format!("'{MOVE_TO}' names no path"));
    }
    // Two elements, because a rename touches two paths.
    Ok(vec![
        FileChange::delete(hunk.path, pre),
        FileChange::create(destination, post),
    ])
}

/// Apply one `Update File` body to its pre-state. Each `@@` opens a block whose ` ` and `-` lines
/// are the text as it stands and whose ` ` and `+` lines are the text after; the first `@@` may be
/// left out. Blocks are matched in order from where the previous one landed.
fn apply_update(pre: &str, body: &[&str], path: &str) -> Result<String, String> {
    let mut lines: Vec<String> = pre.split('\n').map(str::to_owned).collect();
    let trailing_newline = lines.last().is_some_and(String::is_empty);
    if trailing_newline {
        lines.pop();
    }

    let mut cursor = 0;
    let mut index = 0;
    while let Some(line) = body.get(index) {
        // A body that opens with `*** End of File` has no block to read; without the second check
        // the loop would stand on that line forever.
        if line.starts_with("@@") {
            index += 1;
        } else if index > 0 || line.starts_with(END_OF_FILE) {
            return Err(format!(
                "a hunk of '{path}' carries '{}' outside any block",
                js_trim(line)
            ));
        }

        let mut old_lines = Vec::new();
        let mut new_lines = Vec::new();
        while let Some(change) = body.get(index) {
            // Both markers are read at the line head only.
            if change.starts_with("@@") || change.starts_with(END_OF_FILE) {
                break;
            }
            index += 1;
            let mut chars = change.chars();
            let operator = chars.next();
            let text = chars.as_str().to_owned();
            match operator {
                Some('-') => old_lines.push(text),
                Some('+') => new_lines.push(text),
                _ => {
                    old_lines.push(text.clone());
                    new_lines.push(text);
                }
            }
        }
        // The marker ends the block it follows; any line after it must open a new block.
        if body
            .get(index)
            .is_some_and(|line| line.starts_with(END_OF_FILE))
        {
            index += 1;
        }

        let at = index_of_block(&lines, &old_lines, cursor)
            .ok_or_else(|| format!("a hunk of '{path}' does not match the file it updates"))?;
        cursor = at + new_lines.len();
        lines.splice(at..at + old_lines.len(), new_lines);
    }

    let mut text = lines.join("\n");
    if trailing_newline {
        text.push('\n');
    }
    Ok(text)
}

/// Where `block` occurs in `lines` at or after `from`. An empty block sits at `from`.
fn index_of_block(lines: &[String], block: &[String], from: usize) -> Option<usize> {
    let last = lines.len().checked_sub(block.len())?;
    (from..=last).find(|start| lines.get(*start..start + block.len()) == Some(block))
}
