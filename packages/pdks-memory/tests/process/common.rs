//! A temporary project directory and a runner for the built `pdks-memory` executable.

use std::fs;
use std::process::Command;

use serde_json::{Value, json};
use tempfile::TempDir;

const EXECUTABLE: &str = env!("CARGO_BIN_EXE_pdks-memory");

/// The include glob every fixture project uses; documents live under `notes/`.
pub const NOTES_INCLUDE: &str = "notes/**/*.md";

pub struct Out {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl Out {
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.stdout).expect("stdout is one JSON value")
    }
}

pub struct Project {
    dir: TempDir,
}

impl Project {
    /// A directory with no config file.
    pub fn bare() -> Self {
        Self {
            dir: TempDir::new().expect("a temporary directory is creatable"),
        }
    }

    /// A directory whose JSON config holds only the given `memory` section.
    pub fn new(memory: &Value) -> Self {
        let project = Self::bare();
        project.set_memory(memory);
        project
    }

    /// A directory whose config includes `notes/**/*.md` and nothing else.
    pub fn notes() -> Self {
        Self::new(&json!({ "include": [NOTES_INCLUDE] }))
    }

    pub fn set_memory(&self, memory: &Value) {
        self.write(
            "polydeukes.config.json",
            &json!({ "memory": memory }).to_string(),
        );
    }

    pub fn write(&self, rel: &str, text: &str) {
        let path = self.dir.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("the parent directory is creatable");
        }
        fs::write(path, text).expect("the fixture file is writable");
    }

    pub fn write_bytes(&self, rel: &str, bytes: &[u8]) {
        let path = self.dir.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("the parent directory is creatable");
        }
        fs::write(path, bytes).expect("the fixture file is writable");
    }

    pub fn exists(&self, rel: &str) -> bool {
        self.dir.path().join(rel).exists()
    }

    pub fn read(&self, rel: &str) -> String {
        fs::read_to_string(self.dir.path().join(rel)).expect("the file is readable")
    }

    pub fn run(&self, args: &[&str]) -> Out {
        self.run_in("", args)
    }

    /// Runs the executable with a subdirectory of the project as its working directory.
    pub fn run_in(&self, rel_dir: &str, args: &[&str]) -> Out {
        let output = Command::new(EXECUTABLE)
            .args(args)
            .current_dir(self.dir.path().join(rel_dir))
            .output()
            .expect("the executable starts");
        Out {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8(output.stdout).expect("stdout is UTF-8"),
            stderr: String::from_utf8(output.stderr).expect("stderr is UTF-8"),
        }
    }

    /// Runs the executable with arguments that need not be UTF-8.
    #[cfg(unix)]
    pub fn run_os(&self, args: &[&std::ffi::OsStr]) -> Out {
        let output = Command::new(EXECUTABLE)
            .args(args)
            .current_dir(self.dir.path())
            .output()
            .expect("the executable starts");
        Out {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8(output.stdout).expect("stdout is UTF-8"),
            stderr: String::from_utf8(output.stderr).expect("stderr is UTF-8"),
        }
    }

    /// Runs a command that must answer: exit 0, nothing on stderr. Returns stdout.
    pub fn ok(&self, args: &[&str]) -> String {
        let out = self.run(args);
        assert_eq!(out.code, 0, "{args:?} exited {}: {}", out.code, out.stderr);
        assert_eq!(out.stderr, "", "{args:?} wrote to stderr");
        out.stdout
    }

    /// Runs a command with `--json` appended and parses its stdout.
    pub fn json(&self, args: &[&str]) -> Value {
        let mut with_flag = args.to_vec();
        with_flag.push("--json");
        let out = self.run(&with_flag);
        assert_eq!(
            out.code, 0,
            "{with_flag:?} exited {}: {}",
            out.code, out.stderr
        );
        assert_eq!(out.stderr, "", "{with_flag:?} wrote to stderr");
        out.json()
    }

    /// The `show --json` object of a document or section.
    pub fn show(&self, id: &str) -> Value {
        self.json(&["show", id])
    }

    /// Every document id the corpus holds, in the order `usage` lists the documents no log
    /// entry returned (`dead`). One log entry with no result is written so that none is hot.
    pub fn document_ids(&self) -> Vec<String> {
        self.write(
            ".polydeukes/memory-log.jsonl",
            "{\"at\":\"2026-01-01T00:00:00.000Z\",\"command\":\"show\",\"query\":\"x\",\"results\":[]}\n",
        );
        self.ok(&["usage"])
            .lines()
            .filter_map(|line| line.strip_prefix("dead\t"))
            .map(str::to_string)
            .collect()
    }
}

/// A markdown text: frontmatter pairs (values written as YAML), then one `## heading` block per
/// section. Headings are written verbatim, so a heading may carry its own `{#anchor}`.
pub fn doc(front: &[(&str, &str)], sections: &[(&str, &str)]) -> String {
    let frontmatter = if front.is_empty() {
        String::new()
    } else {
        let pairs: Vec<String> = front
            .iter()
            .map(|(key, value)| format!("{key}: {value}\n"))
            .collect();
        format!("---\n{}---\n", pairs.concat())
    };
    let blocks: Vec<String> = sections
        .iter()
        .map(|(heading, body)| format!("## {heading}\n{body}\n"))
        .collect();
    format!("{frontmatter}{}", blocks.concat())
}

/// A document without a `type`.
pub fn page(title: &str, sections: &[(&str, &str)]) -> String {
    doc(&[("title", title)], sections)
}

/// A document typed `note`.
pub fn typed(title: &str, sections: &[(&str, &str)]) -> String {
    doc(&[("title", title), ("type", "note")], sections)
}

/// A document without a `type` whose sections are `(anchor, body)` pairs; each heading carries
/// its anchor explicitly as `## anchor {#anchor}`.
pub fn anchored_page(title: &str, sections: &[(&str, &str)]) -> String {
    let headings: Vec<String> = sections
        .iter()
        .map(|(anchor, _)| format!("{anchor} {{#{anchor}}}"))
        .collect();
    let pairs: Vec<(&str, &str)> = headings
        .iter()
        .zip(sections)
        .map(|(heading, (_, body))| (heading.as_str(), *body))
        .collect();
    page(title, &pairs)
}

/// The compact JSON line a `--json` command prints.
pub fn line(value: &Value) -> String {
    format!("{value}\n")
}

pub fn link(from: &str, target: &str, to: Option<&str>) -> Value {
    json!({ "from": from, "target": target, "to": to })
}

pub fn links(out: Vec<Value>, into: Vec<Value>) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("out".to_string(), Value::Array(out));
    object.insert("in".to_string(), Value::Array(into));
    Value::Object(object)
}

/// The `links` object of a `show --json` answer.
pub fn links_of(shown: &Value) -> Value {
    shown
        .get("links")
        .cloned()
        .expect("a shown document or section has links")
}

/// The one stderr line every refused command writes, with empty stdout and exit 2.
pub fn assert_refused(out: &Out, message: &str) {
    assert_eq!(out.code, 2, "stderr: {}", out.stderr);
    assert_eq!(out.stdout, "", "a refused command writes nothing to stdout");
    assert_eq!(out.stderr, format!("pdks memory: {message}\n"));
}

/// `Date#toISOString` shape: `2026-09-28T00:00:00.000Z`.
pub fn is_iso_utc_millis(text: &str) -> bool {
    text.len() == 24
        && text.bytes().enumerate().all(|(i, byte)| match i {
            4 | 7 => byte == b'-',
            10 => byte == b'T',
            13 | 16 => byte == b':',
            19 => byte == b'.',
            23 => byte == b'Z',
            _ => byte.is_ascii_digit(),
        })
}
