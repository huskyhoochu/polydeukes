use std::collections::HashMap;
use std::path::Path;

use serde_json::{Map, Value};

use super::declare::{self, Break, Verdict, scope_matches};
use super::dispatch::{Context, Judge, Registration, ShellCall};
use super::extract::World;
use super::mention::{join_under, rooted_segments};
use super::relations::{Side, Witness};
use super::run_covenant::Judgment;
use super::shell_evidence::{has_pathless_signal, known_write_paths};
use super::shell_path::shell_path;
use crate::core::config::Entry;
use crate::core::declaration::{Binding, Declaration, Scope};
use crate::core::protocol::ToolCall;
use crate::core::validation::{js_trim, normalize_relative};

/// `path.relative(root, path)` for two absolute paths.
fn relative_to(root: &str, path: &str) -> String {
    let from = rooted_segments(root.split('/'));
    let to = rooted_segments(path.split('/'));
    let shared = from
        .iter()
        .zip(&to)
        .take_while(|(left, right)| left == right)
        .count();
    let ups = std::iter::repeat_n("..", from.len() - shared);
    ups.chain(to.iter().skip(shared).copied())
        .collect::<Vec<_>>()
        .join("/")
}

/// The repo-relative spelling of a path, or `None` when it names the root itself or resolves
/// outside it (its first segment is exactly `..`).
pub fn relativize_for_scope(file_path: &str, root: &Path) -> Option<String> {
    let relative = if file_path.starts_with('/') {
        relative_to(&root.to_string_lossy(), file_path)
    } else {
        normalize_relative(file_path)
    };
    let outside = relative.split('/').next() == Some("..");
    let root_itself = matches!(relative.trim_end_matches('/'), "" | ".");
    (!root_itself && !outside).then_some(relative)
}

/// What the surface supplies beyond the call itself.
pub struct Supply<'a> {
    pub root: &'a Path,
    pub actor: Option<&'a Value>,
    /// The working-tree text of each `file` source, by normalized path; an unreadable path is absent.
    pub files: &'a HashMap<String, String>,
    pub sidecar: Option<&'a str>,
    pub snapshot: Option<&'a Value>,
}

fn string_of(change: &Map<String, Value>, key: &str) -> Option<Value> {
    change.get(key).filter(|value| value.is_string()).cloned()
}

/// The world of the call's file change under its repo-relative path. A side the change lacks
/// is an absent key, and `state` exists only where both sides do.
fn file_world(call: &ToolCall, root: &Path) -> Option<(String, World)> {
    let change = call.file_change.as_ref()?.as_object()?;
    let path = relativize_for_scope(change.get("path")?.as_str()?, root)?;
    let mut world = World::new();
    world.insert("target.path".to_string(), Value::String(path.clone()));
    let (pre, post) = (string_of(change, "pre"), string_of(change, "post"));
    let mut put = |key: &str, value: Option<&Value>| {
        if let Some(value) = value {
            world.insert(key.to_string(), value.clone());
        }
    };
    match change.get("kind")?.as_str()? {
        "create" => put("post", post.as_ref()),
        "modify" => {
            put("pre", pre.as_ref());
            put("post", post.as_ref());
            if let (Some(pre), Some(post)) = (pre, post) {
                let state = Map::from_iter([("pre".to_string(), pre), ("post".to_string(), post)]);
                world.insert("state".to_string(), Value::Object(state));
            }
        }
        "delete" => put("pre", pre.as_ref()),
        _ => return None,
    }
    Some((path, world))
}

/// The call's world and its subject: the file change when it has one, else a shell call is one
/// world of its own under `-`. A declaration that reads only the change has nothing to read
/// there; one that also reads the command meets the missing change through its supply policy.
fn world_of(
    declaration: &Declaration,
    call: &ToolCall,
    shell: &ShellCall,
    supply: &Supply,
) -> Option<(String, World)> {
    let (path, mut world) = match file_world(call, supply.root) {
        Some(found) => found,
        None if shell.command.is_some()
            && (!declaration.reads_change() || declaration.reads_call()) =>
        {
            ("-".to_string(), World::new())
        }
        None => return None,
    };
    if let Some(command) = &shell.command {
        world.insert("command".to_string(), Value::String(command.clone()));
    }
    if let Some(actor) = supply.actor {
        world.insert("actor".to_string(), actor.clone());
    }
    for (name, binding) in &declaration.sources {
        let value = match binding {
            // A file this call changes reads the change's own `post` (absent on a deletion),
            // since the tree still holds the state from before the call.
            Binding::File(file) if *file == path => world.get("post").cloned(),
            Binding::File(file) => supply
                .files
                .get(file)
                .map(|text| Value::String(text.clone())),
            Binding::Sidecar => supply.sidecar.map(|text| Value::String(text.to_string())),
            Binding::Transcript => supply.snapshot.cloned(),
        };
        if let Some(value) = value {
            world.insert(name.clone(), value);
        }
    }
    Some((path, world))
}

/// The entry's reason with its rationale appended on one line.
fn with_why(reason: String, why: Option<&str>) -> String {
    let folded = why
        .map(|why| {
            why.split(['\r', '\n'])
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    let folded = js_trim(&folded);
    if folded.is_empty() {
        reason
    } else {
        format!("{reason} — why: {folded}")
    }
}

const WITNESSES_PER_BREAK: usize = 8;
const WITNESS_VALUE_UNITS: usize = 200;

/// A witness whose serialized value fits the row; a longer one is cut and says so.
fn bounded(witness: &Witness) -> Value {
    let mut row = Map::new();
    row.insert("key".to_string(), Value::String(witness.key.clone()));
    let mut truncated = None;
    if let Some(value) = &witness.value {
        let serialized = serde_json::to_string(value).unwrap_or_default();
        let units = serialized.encode_utf16().count();
        if units <= WITNESS_VALUE_UNITS {
            row.insert("value".to_string(), value.clone());
        } else {
            let mut taken = 0;
            let cut: String = serialized
                .chars()
                .take_while(|character| {
                    taken += character.len_utf16();
                    taken <= WITNESS_VALUE_UNITS
                })
                .collect();
            row.insert("value".to_string(), Value::String(cut));
            truncated = Some(units);
        }
    }
    match witness.side {
        Some(Side::Left) => row.insert("side".to_string(), Value::from("left")),
        Some(Side::Right) => row.insert("side".to_string(), Value::from("right")),
        None => None,
    };
    if let Some(units) = truncated {
        row.insert("truncated".to_string(), Value::from(units));
    }
    Value::Object(row)
}

/// The row's fifth field: each break's id, its first witnesses, and the true total.
fn serialize_breaks(breaks: &[Break]) -> String {
    let rows: Vec<Value> = breaks
        .iter()
        .map(|entry| {
            let witnesses: Vec<Value> = entry
                .witnesses
                .iter()
                .take(WITNESSES_PER_BREAK)
                .map(bounded)
                .collect();
            let mut row = Map::new();
            row.insert("id".to_string(), Value::String(entry.id.clone()));
            row.insert("witnesses".to_string(), Value::Array(witnesses));
            row.insert("total".to_string(), Value::from(entry.witnesses.len()));
            Value::Object(row)
        })
        .collect();
    serde_json::to_string(&rows).unwrap_or_default()
}

/// Route and judge one entry over the call. `None` when the call is outside the entry's
/// scope; otherwise the subject of the row and the judgment.
pub fn judge(
    entry: &Entry,
    call: &ToolCall,
    shell: &ShellCall,
    context: &Context,
) -> Option<(String, Judgment)> {
    let declaration = &entry.declaration;
    let (path, world) = world_of(declaration, call, shell, context.supply)?;
    let judgment = match declare::judge(declaration, &world) {
        Verdict::OutOfScope => return None,
        Verdict::Pass => Judgment::Upheld,
        Verdict::SupplyPass => Judgment::SupplyPass,
        Verdict::Unjudgeable { source, reason } => Judgment::Unjudgeable(format!(
            "discipline '{}' cannot judge {path}: {source} — {reason}",
            entry.id
        )),
        Verdict::Broken(breaks) => {
            let message = breaks.first().map_or("", |first| first.message.as_str());
            Judgment::Declared {
                reason: with_why(
                    format!("discipline '{}' broken on {path}: {message}", entry.id),
                    entry.why.as_deref(),
                ),
                witnesses: serialize_breaks(&breaks),
                opens: declare::witness_opens(declaration, &world),
            }
        }
    };
    Some((path, judgment))
}

/// The first path a shell call writes that the scope admits. A scope over any source but the
/// path admits every written path, since the write may be in scope and the text cannot say.
pub fn first_written_path(
    scope: Option<&Scope>,
    call: &ToolCall,
    shell: &ShellCall,
    root: &Path,
) -> Option<String> {
    let root_text = root.to_string_lossy();
    shell
        .lines
        .iter()
        .flat_map(known_write_paths)
        .filter_map(|path| {
            let joined = shell_path(path, call.cwd.as_deref());
            let absolute = if joined.starts_with('/') {
                joined
            } else {
                join_under(&root_text, &joined)
            };
            relativize_for_scope(&absolute, root)
        })
        .find(|path| {
            scope.is_none_or(|scope| scope.source != "target.path" || scope_matches(scope, path))
        })
}

/// The registrations of the discipline entries, in config order: every entry judged, then
/// one skip registration per entry that does not scope on the command line, which records the
/// shell writes no judgment observes.
pub fn registrations(entries: &[Entry]) -> Vec<Registration> {
    let judged = entries.iter().map(|entry| Registration {
        label: entry.id.clone(),
        judge: Judge::Discipline(Box::new(entry.clone())),
    });
    let skipped = entries
        .iter()
        .filter(|entry| {
            let scope = entry.declaration.scope.as_ref();
            scope.is_none_or(|scope| scope.source != "command")
        })
        .map(|entry| Registration {
            label: entry.id.clone(),
            judge: Judge::DisciplineSkip(entry.declaration.scope.clone()),
        });
    judged.chain(skipped).collect()
}

/// The one common shell-axis skip registration. A write whose target is unknowable belongs to
/// no covenant's scope, so it leaves one row under one label with the subject `-`.
pub fn shell_unjudgeable_registration() -> Registration {
    Registration {
        label: "shell-unjudgeable".to_string(),
        judge: Judge::ShellUnjudgeable,
    }
}

/// True when a command line of the call writes somewhere its text does not reveal.
pub fn shell_unjudgeable(shell: &ShellCall) -> bool {
    shell.lines.iter().any(has_pathless_signal)
}
