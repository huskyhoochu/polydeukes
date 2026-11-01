//! Path arithmetic that mirrors Node's `resolve`, `relative` and `realpath` semantics.

use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

/// An absolute path with `.` and `..` folded away lexically; a relative input starts at the
/// working directory.
pub fn resolve(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("cannot read the working directory: {error}"))?
            .join(path)
    };
    let mut folded = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::ParentDir => {
                folded.pop();
            }
            Component::CurDir => {}
            other => folded.push(other.as_os_str()),
        }
    }
    Ok(folded)
}

/// The real path when the path exists, otherwise its lexical resolution.
pub fn canonical(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).or_else(|_| resolve(path))
}

/// The path from `from` to `to` joined with `/`, empty when they are the same.
pub fn relative(from: &Path, to: &Path) -> String {
    let from: Vec<Component> = from.components().collect();
    let to: Vec<Component> = to.components().collect();
    let shared = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts = vec![String::from(".."); from.len() - shared];
    parts.extend(
        to.iter()
            .skip(shared)
            .map(|part| part.as_os_str().to_string_lossy().into_owned()),
    );
    parts.join("/")
}

/// The path relative to the root when it lies strictly inside it, otherwise the path itself.
pub fn name_below(path: &Path, root: &Path) -> String {
    match path.strip_prefix(root) {
        Ok(inside) if !inside.as_os_str().is_empty() => inside.to_string_lossy().into_owned(),
        _ => path.to_string_lossy().into_owned(),
    }
}

/// The real path of a write target that may not exist yet: the deepest existing ancestor is
/// resolved and the missing names are appended. `None` when an ancestor is a file. A link that
/// points nowhere is refused, because the write would land at a place the spelling hides.
pub fn canonical_target(path: &Path) -> Result<Option<PathBuf>, String> {
    let mut missing: Vec<OsString> = Vec::new();
    let mut current = resolve(path)?;
    loop {
        match fs::canonicalize(&current) {
            Ok(real) => {
                return Ok(Some(
                    missing
                        .iter()
                        .rev()
                        .fold(real, |resolved, name| resolved.join(name)),
                ));
            }
            Err(error) if error.kind() == ErrorKind::NotADirectory => return Ok(None),
            Err(error) if error.kind() != ErrorKind::NotFound => {
                return Err(format!(
                    "cannot resolve the real path of {}: {error}",
                    path.display()
                ));
            }
            Err(_) => {}
        }
        if fs::symlink_metadata(&current).is_ok_and(|meta| meta.is_symlink()) {
            return Err(format!(
                "target path crosses a dangling symbolic link: {}",
                path.display()
            ));
        }
        let parent = match (current.parent(), current.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name.to_owned());
                parent.to_path_buf()
            }
            _ => return resolve(path).map(Some),
        };
        current = parent;
    }
}
