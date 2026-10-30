// Process-level tests of `pdks explain`, `pdks init` and `pdks --version`.
// The expected `explain` texts in `tests/explain/<case>/expected.txt` are the output of the
// TypeScript judge for the same config, with two edits applied by hand: the substring
// `common; ` is removed from the `self-mod` lines, and ` · enforce: advise` is removed
// wherever it appeared (` · enforce: block` stays).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU32, Ordering};

const CONFIG: &str = "polydeukes.config.yaml";
const CONFIG_YML: &str = "polydeukes.config.yml";
const CONFIG_JSON: &str = "polydeukes.config.json";
const GITIGNORE: &str = ".gitignore";
const USAGE: &str = "usage: pdks covenant check";

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Sandbox {
    dir: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "pdks-cli-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).expect("the sandbox directory is creatable");
        Self { dir }
    }

    fn pdks(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_pdks"))
            .args(args)
            .current_dir(&self.dir)
            .output()
            .expect("the pdks executable starts")
    }

    fn write(&self, name: &str, content: &str) {
        fs::write(self.dir.join(name), content).expect("the sandbox file is writable");
    }

    fn read(&self, name: &str) -> String {
        fs::read_to_string(self.dir.join(name)).expect("the sandbox file is readable")
    }

    fn exists(&self, name: &str) -> bool {
        self.dir.join(name).exists()
    }

    fn entries(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.dir)
            .expect("the sandbox directory is listable")
            .map(|entry| {
                entry
                    .expect("a directory entry reads")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        // Cleanup failure leaves a temp directory behind and nothing else.
        #[expect(
            clippy::let_underscore_must_use,
            reason = "temp-dir removal is best effort"
        )]
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn out(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn err(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn code(output: &Output) -> Option<i32> {
    output.status.code()
}

fn explain_case(case: &str) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/explain")
        .join(case);
    let sandbox = Sandbox::new();
    sandbox.write(
        CONFIG_YML,
        &fs::read_to_string(dir.join(CONFIG_YML)).expect("the case config exists"),
    );
    let expected = fs::read_to_string(dir.join("expected.txt")).expect("the case text exists");

    let output = sandbox.pdks(&["explain"]);

    assert_eq!(code(&output), Some(0), "stderr: {}", err(&output));
    assert_eq!(out(&output), expected);
    assert!(!sandbox.exists(".polydeukes"), "explain wrote no telemetry");
}

#[test]
fn explain_matches_ts_for_the_repository_config() {
    // Catches: any divergence in row order, column width or tally on a real 27-declaration config.
    explain_case("repo");
}

#[test]
fn explain_matches_ts_for_the_branching_config() {
    // Catches: a sidecar count, valve mark, missing why, level suffix, change-set-only entry or
    // draft row rendered differently from the TS text (and `enforce: advise` still printed).
    explain_case("branches");
}

#[test]
fn explain_matches_ts_for_the_minimal_config() {
    // Catches: the empty-discipline edge (width from labels only, no discipline rows).
    explain_case("minimal");
}

#[test]
fn explain_without_config_fails_closed_with_empty_stdout() {
    // Catches: a missing config rendering an empty report at exit 0, or the error on stdout.
    let sandbox = Sandbox::new();

    let output = sandbox.pdks(&["explain"]);

    assert_eq!(code(&output), Some(2));
    assert_eq!(out(&output), "");
    assert!(
        err(&output).starts_with("pdks explain:"),
        "{}",
        err(&output)
    );
}

#[test]
fn explain_refuses_an_extra_argument_with_usage() {
    // Catches: a trailing argument ignored instead of refused.
    let sandbox = Sandbox::new();
    sandbox.write(CONFIG_YML, "protectedPaths: []\n");

    let output = sandbox.pdks(&["explain", "x"]);

    assert_eq!(code(&output), Some(2));
    assert!(err(&output).contains(USAGE), "{}", err(&output));
}

#[test]
fn init_creates_both_files_then_skips_both_unchanged() {
    // Catches: wrong line order, a config rewrite or a repeated ignore line on rerun.
    let sandbox = Sandbox::new();

    let first = sandbox.pdks(&["init"]);

    assert_eq!(code(&first), Some(0), "stderr: {}", err(&first));
    assert_eq!(
        out(&first),
        "created polydeukes.config.yaml\ncreated .gitignore\n"
    );
    assert!(sandbox.read(CONFIG).contains("generated by `pdks init`"));
    let config = sandbox.read(CONFIG);
    let gitignore = sandbox.read(GITIGNORE);

    let second = sandbox.pdks(&["init"]);

    assert_eq!(code(&second), Some(0));
    assert_eq!(
        out(&second),
        "skipped polydeukes.config.yaml (already present)\nskipped .gitignore (already present)\n"
    );
    assert_eq!(sandbox.read(CONFIG), config);
    assert_eq!(sandbox.read(GITIGNORE), gitignore);
}

#[test]
fn init_with_an_existing_ignore_line_creates_only_the_config() {
    // Catches: skip decided per run instead of per file, or the ignore file touched.
    let sandbox = Sandbox::new();
    sandbox.write(GITIGNORE, ".polydeukes/\n");

    let output = sandbox.pdks(&["init"]);

    assert_eq!(code(&output), Some(0), "stderr: {}", err(&output));
    assert_eq!(
        out(&output),
        "created polydeukes.config.yaml\nskipped .gitignore (already present)\n"
    );
    assert_eq!(sandbox.read(GITIGNORE), ".polydeukes/\n");
}

#[test]
fn init_refuses_a_host_argument_and_writes_nothing() {
    // Catches: the old `init claude-code` spelling falling through to a bare scaffold.
    let sandbox = Sandbox::new();

    let output = sandbox.pdks(&["init", "claude-code"]);

    assert_eq!(code(&output), Some(2));
    assert!(err(&output).contains(USAGE), "{}", err(&output));
    assert_eq!(sandbox.entries(), Vec::<String>::new());
}

#[test]
fn init_refuses_two_config_candidates_before_writing() {
    // Catches: ambiguity detected after the ignore file or a third config was written.
    let sandbox = Sandbox::new();
    sandbox.write(CONFIG, "a: 1\n");
    sandbox.write(CONFIG_JSON, "{}\n");

    let output = sandbox.pdks(&["init"]);

    assert_eq!(code(&output), Some(2));
    assert!(
        err(&output).starts_with("pdks init: ambiguous"),
        "{}",
        err(&output)
    );
    assert_eq!(
        sandbox.entries(),
        vec![CONFIG_JSON.to_string(), CONFIG.to_string()]
    );
}

#[test]
fn init_respects_a_yml_config_and_does_not_add_a_yaml_one() {
    // Catches: only the `.yaml` spelling being recognised as an existing config.
    let sandbox = Sandbox::new();
    sandbox.write(CONFIG_YML, "protectedPaths: []\n");

    let output = sandbox.pdks(&["init"]);

    assert_eq!(code(&output), Some(0), "stderr: {}", err(&output));
    assert_eq!(
        out(&output).lines().next(),
        Some("skipped polydeukes.config.yml (already present)")
    );
    assert!(!sandbox.exists(CONFIG));
}

#[test]
fn init_appends_the_ignore_line_after_an_unterminated_last_line() {
    // Catches: the line glued onto `node_modules` (no separating newline) or the old line lost.
    let sandbox = Sandbox::new();
    sandbox.write(GITIGNORE, "node_modules");

    let output = sandbox.pdks(&["init"]);

    assert_eq!(code(&output), Some(0), "stderr: {}", err(&output));
    let text = sandbox.read(GITIGNORE);
    assert!(text.starts_with("node_modules\n"), "{text:?}");
    assert!(text.lines().any(|line| line == ".polydeukes/"), "{text:?}");
}

#[test]
fn init_does_not_treat_a_similar_line_as_the_ignore_entry() {
    // Catches: a substring match deciding `skipped` for `.polydeukes/cache` or a comment.
    let sandbox = Sandbox::new();
    sandbox.write(GITIGNORE, "# .polydeukes/\n.polydeukes/cache\n");

    let output = sandbox.pdks(&["init"]);

    assert_eq!(
        out(&output),
        "created polydeukes.config.yaml\ncreated .gitignore\n"
    );
    assert!(
        sandbox
            .read(GITIGNORE)
            .lines()
            .any(|line| line == ".polydeukes/")
    );
}

#[test]
fn generated_config_explains_and_carries_no_host_text() {
    // Catches: a template the loader rejects, host names or read-only wording left in it.
    let sandbox = Sandbox::new();
    sandbox.pdks(&["init"]);
    let text = sandbox.read(CONFIG);

    let output = sandbox.pdks(&["explain"]);

    assert_eq!(code(&output), Some(0), "stderr: {}", err(&output));
    let rendered = out(&output);
    assert!(rendered.contains("registrations 3 · declare 0 · skip 1 · meta 2 · draft 0"));
    assert!(rendered.contains("registrations 2 · declare 0 · skip 1 · meta 1 · draft 0"));
    assert!(text.contains("witness:"));
    assert!(text.contains("protectedPaths: []"));
    assert!(!text.contains("yaml-language-server"));
    assert!(!text.contains("read-only"));
    let lower = text.to_lowercase();
    for host in ["claude", "codex", "grok"] {
        assert!(!lower.contains(host), "template names {host}");
    }
}

#[test]
fn generated_ladder_uncomments_into_one_declaration_and_one_draft() {
    // Catches: a ladder whose comment stripping yields invalid YAML, or a rung count that drifts
    // (the promotion note must stay a comment after stripping).
    let sandbox = Sandbox::new();
    sandbox.pdks(&["init"]);
    let text = sandbox.read(CONFIG);
    let start = text
        .find("# disciplines:")
        .expect("the template has a ladder");
    let ladder: Vec<String> = text
        .get(start..)
        .expect("the ladder offset is a char boundary")
        .lines()
        .filter(|line| line.starts_with('#'))
        .map(|line| {
            let rest = line.strip_prefix('#').unwrap_or(line);
            rest.strip_prefix(' ').unwrap_or(rest).to_string()
        })
        .collect();
    sandbox.write(
        CONFIG,
        &format!(
            "{}{}\n",
            text.get(..start).unwrap_or_default(),
            ladder.join("\n")
        ),
    );

    let output = sandbox.pdks(&["explain"]);

    assert_eq!(code(&output), Some(0), "stderr: {}", err(&output));
    let rendered = out(&output);
    let session = rendered
        .lines()
        .find(|line| line.trim_start().starts_with("registrations"))
        .expect("a tally line exists");
    assert!(session.contains("declare 1"), "{session}");
    assert!(session.contains("draft 1"), "{session}");
}

#[test]
fn version_prints_the_crate_version() {
    // The expected version comes from the manifest, so a release bump does not break this test.
    let sandbox = Sandbox::new();

    let output = sandbox.pdks(&["--version"]);

    assert_eq!(code(&output), Some(0), "stderr: {}", err(&output));
    assert_eq!(
        out(&output),
        format!("pdks {}\n", env!("CARGO_PKG_VERSION"))
    );
}

fn collect_sources(dir: &Path, found: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("the source directory is listable") {
        let path = entry.expect("a directory entry reads").path();
        if path.is_dir() {
            collect_sources(&path, found);
        } else {
            found.push(path);
        }
    }
}

#[test]
fn source_names_no_host() {
    // Catches: a host name leaking into the host-neutral executable's source.
    let mut files = Vec::new();
    collect_sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    assert!(files.len() > 1, "the source tree was walked");
    for file in files {
        let lower = fs::read_to_string(&file)
            .expect("a source file is UTF-8")
            .to_lowercase();
        for host in ["claude", "codex", "grok"] {
            assert!(!lower.contains(host), "{} names {host}", file.display());
        }
    }
}
