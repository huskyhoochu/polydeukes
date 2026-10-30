//! Post-hoc state comparison. The session surface judges declared calls, so a write nobody
//! declared leaves no row; this module summarizes the protected entries' on-disk state and,
//! on the next call, names the entries whose state moved with no judgment row explaining it.
//! It records and never blocks.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use crate::core::telemetry::{self, Event};

const LABEL: &str = "baseline";

/// One hash per protected entry, keyed by the entry as configured, in configured order.
type Snapshot = Vec<(String, String)>;

struct Stored {
    entries: BTreeMap<String, String>,
    cut_at: Option<String>,
}

fn baseline_path(root: &Path) -> PathBuf {
    root.join(".polydeukes").join("baseline.json")
}

/// A configured entry may be absolute; it is appended under the root rather than replacing it.
fn join_under(root: &Path, relative: &str) -> PathBuf {
    root.join(relative.trim_start_matches('/'))
}

/// Fold one file's path and bytes into the hash. The path participates, so a rename with
/// identical content moves the hash. An unreadable file contributes a fixed marker: absence
/// is a state, and a file that vanished mid-walk is what the comparison exists to see.
fn fold_file(hasher: &mut Sha256, absolute: &Path, key: &str) {
    hasher.update(key.as_bytes());
    match fs::read(absolute) {
        Ok(bytes) => hasher.update(bytes),
        Err(_) => hasher.update(b"\0absent"),
    }
}

/// Fold everything under `relative` in byte order of the entry names, so an unchanged tree
/// hashes identically twice. A file, or a path that does not exist, is not a traversal
/// failure: a vanished entry hashes to the absence marker.
fn fold_entry(hasher: &mut Sha256, root: &Path, relative: &str) {
    let Ok(children) = fs::read_dir(join_under(root, relative)) else {
        fold_file(hasher, &join_under(root, relative), relative);
        return;
    };
    let mut names: Vec<OsString> = children
        .filter_map(Result::ok)
        .map(|child| child.file_name())
        .collect();
    names.sort();
    for name in names {
        fold_entry(
            hasher,
            root,
            &format!("{relative}/{}", name.to_string_lossy()),
        );
    }
}

fn hex(digest: &[u8]) -> String {
    digest
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .filter_map(|nibble| char::from_digit(u32::from(nibble), 16))
        .collect()
}

fn snapshot(root: &Path, entries: &[String]) -> Snapshot {
    entries
        .iter()
        .map(|entry| {
            let mut hasher = Sha256::new();
            fold_entry(&mut hasher, root, entry);
            (entry.clone(), hex(&hasher.finalize()))
        })
        .collect()
}

/// The stored baseline, or `None` for a missing, corrupt or wrongly shaped file. Absence and
/// corruption are one signal: re-establish and record.
fn read_baseline(path: &Path) -> Option<Stored> {
    let parsed: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let entries = parsed
        .get("entries")?
        .as_object()?
        .iter()
        .map(|(entry, hash)| Some((entry.clone(), hash.as_str()?.to_string())))
        .collect::<Option<BTreeMap<_, _>>>()?;
    let cut_at = parsed
        .get("cutAt")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(Stored { entries, cut_at })
}

/// Compare the protected entries against the stored baseline and record each entry that
/// moved with no judgment explaining it.
///
/// Only a `witnessed` or `advised` row explains a change: those mean a mutation of a
/// protected entry was judged and let through. `passed` on a protected entry is a mention,
/// not a mutation, and admitting it would let a read-only call absolve a tamper; `blocked`
/// stopped the call, so admitting it would make provoking a block a licence for every later
/// write. The window is the rows at or after the stored cut, an absent cut admitting all.
/// An entry the previous baseline did not watch is not compared, so editing one's own policy
/// does not read as a tamper.
pub fn compare(root: &Path, telemetry_path: &Path, entries: &[String]) {
    let records = telemetry::read_records(telemetry_path);
    let path = baseline_path(root);
    let Some(stored) = read_baseline(&path) else {
        telemetry::append(
            telemetry_path,
            Event::Unattributed,
            LABEL,
            &path.to_string_lossy(),
        );
        return;
    };
    let attributed: Vec<&str> = records
        .iter()
        .filter(|record| {
            stored
                .cut_at
                .as_ref()
                .is_none_or(|cut| record.timestamp >= *cut)
        })
        .filter(|record| matches!(record.event, Event::Witnessed | Event::Advised))
        .map(|record| record.subject.as_str())
        .collect();
    for (entry, hash) in snapshot(root, entries) {
        if stored
            .entries
            .get(&entry)
            .is_some_and(|previous| *previous != hash)
            && !attributed.contains(&entry.as_str())
        {
            telemetry::append(telemetry_path, Event::Unattributed, LABEL, &entry);
        }
    }
}

/// Re-establish the baseline at call end, so the writes this call itself judged are folded
/// into the hashes. The cut is stamped here, beside the snapshot: both describe the same
/// instant, and an earlier cut would re-admit this call's own rows into the next window.
pub fn update(root: &Path, entries: &[String]) -> io::Result<()> {
    let hashes: Map<String, Value> = snapshot(root, entries)
        .into_iter()
        .map(|(entry, hash)| (entry, Value::String(hash)))
        .collect();
    let path = baseline_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let stored = json!({ "entries": hashes, "cutAt": telemetry::iso_utc(telemetry::now_ms()) });
    fs::write(path, stored.to_string())
}
