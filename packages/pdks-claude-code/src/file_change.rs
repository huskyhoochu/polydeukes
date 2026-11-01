//! The file-change evidence of one `Edit`, `Write`, `MultiEdit` or `NotebookEdit` call: the file as it
//! is on disk and the content the call would leave there.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde_json::{Map, Value};

use crate::paths::resolve;

pub struct FileChange {
    pub kind: &'static str,
    pub path: String,
    pub pre: Option<String>,
    pub post: String,
}

impl FileChange {
    /// The IR element, naming the change after `path` (which may differ from the call's own).
    pub fn to_value(&self, path: &str) -> Value {
        let mut change = Map::new();
        change.insert("kind".to_owned(), Value::from(self.kind));
        change.insert("path".to_owned(), Value::from(path));
        if let Some(pre) = &self.pre {
            change.insert("pre".to_owned(), Value::from(pre.as_str()));
        }
        change.insert("post".to_owned(), Value::from(self.post.as_str()));
        Value::Object(change)
    }
}

/// The evidence for one call, `None` when the call proves no change. `base` is the directory a
/// relative target path starts from.
pub fn collect(
    tool: &str,
    input: &Map<String, Value>,
    base: &Path,
) -> Result<Option<FileChange>, String> {
    if tool == "NotebookEdit" {
        return notebook_change(input, base);
    }
    if !matches!(tool, "Write" | "Edit" | "MultiEdit") {
        return Ok(None);
    }
    let Some(path) = input.get("file_path").and_then(Value::as_str) else {
        return Ok(None);
    };
    let pre = read_pre(base, path)?;
    let Some(post) = post_state(tool, input, pre.as_deref()) else {
        return Ok(None);
    };
    Ok(Some(FileChange {
        kind: if pre.is_some() { "modify" } else { "create" },
        path: path.to_owned(),
        pre,
        post,
    }))
}

/// The file's text, `None` when it does not exist. Any other read failure fails the call.
fn read_pre(base: &Path, path: &str) -> Result<Option<String>, String> {
    let full = resolve(&base.join(path))?;
    match fs::read(&full) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(error) if matches!(error.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory) => {
            Ok(None)
        }
        Err(error) => Err(format!("cannot read {}: {error}", full.display())),
    }
}

/// The content the call leaves behind, `None` when the real tool would reject the call. A
/// failure is never replaced by the pre-state: that would present the change as no change.
fn post_state(tool: &str, input: &Map<String, Value>, pre: Option<&str>) -> Option<String> {
    match tool {
        "Write" => input.get("content")?.as_str().map(str::to_owned),
        "Edit" => apply_edit(pre?, input),
        _ => {
            let edits = input
                .get("edits")?
                .as_array()
                .filter(|edits| !edits.is_empty())?;
            // With no file, a first edit with an empty old_string creates it.
            let (mut content, skip) = if let Some(pre) = pre {
                (pre.to_owned(), 0)
            } else {
                let first = edits.first()?.as_object()?;
                if !first.get("old_string")?.as_str()?.is_empty() {
                    return None;
                }
                (first.get("new_string")?.as_str()?.to_owned(), 1)
            };
            for edit in edits.iter().skip(skip) {
                content = apply_edit(&content, edit.as_object()?)?;
            }
            Some(content)
        }
    }
}

/// One `old_string` to `new_string` substitution under the Edit tool's own acceptance rules.
fn apply_edit(content: &str, edit: &Map<String, Value>) -> Option<String> {
    let old = edit.get("old_string")?.as_str()?;
    let new = edit.get("new_string")?.as_str()?;
    if old.is_empty() || old == new {
        return None;
    }
    let replace_all = match edit.get("replace_all") {
        None => false,
        Some(Value::Bool(flag)) => *flag,
        Some(_) => return None,
    };
    match content.matches(old).count() {
        0 => None,
        1 => Some(content.replacen(old, new, 1)),
        _ if replace_all => Some(content.replace(old, new)),
        _ => None,
    }
}

/// The change to one notebook cell: `path` names the notebook while `pre` and `post` carry the
/// cell's source.
fn notebook_change(input: &Map<String, Value>, base: &Path) -> Result<Option<FileChange>, String> {
    let (Some(path), Some(new_source)) = (
        input.get("notebook_path").and_then(Value::as_str),
        input.get("new_source").and_then(Value::as_str),
    ) else {
        return Ok(None);
    };
    let Some(notebook) = read_pre(base, path)? else {
        return Ok(None);
    };
    Ok(cell_change(input, path, new_source, &notebook))
}

fn cell_change(
    input: &Map<String, Value>,
    path: &str,
    new_source: &str,
    notebook: &str,
) -> Option<FileChange> {
    let Value::Object(mut notebook) = serde_json::from_str(notebook).ok()? else {
        return None;
    };
    let Value::Array(cells) = notebook.remove("cells")? else {
        return None;
    };
    let mode = match input.get("edit_mode") {
        None | Some(Value::Null) => "replace",
        Some(Value::String(mode)) => mode.as_str(),
        Some(_) => return None,
    };
    let (pre, post) = match mode {
        "insert" => {
            input.get("cell_type")?.as_str()?;
            (String::new(), new_source.to_owned())
        }
        "replace" | "delete" => {
            let id = input.get("cell_id")?.as_str()?;
            let post = if mode == "delete" {
                String::new()
            } else {
                new_source.to_owned()
            };
            (cell_source(&cells, id)?, post)
        }
        _ => return None,
    };
    Some(FileChange {
        kind: "modify",
        path: path.to_owned(),
        pre: Some(pre),
        post,
    })
}

/// The source of the first cell with this id, whether stored as text or as a list of lines.
fn cell_source(cells: &[Value], id: &str) -> Option<String> {
    let cell = cells
        .iter()
        .find(|cell| cell.get("id").and_then(Value::as_str) == Some(id))?;
    match cell.get("source")? {
        Value::String(source) => Some(source.clone()),
        Value::Array(lines) => lines
            .iter()
            .map(|line| line.as_str())
            .collect::<Option<String>>(),
        _ => None,
    }
}
