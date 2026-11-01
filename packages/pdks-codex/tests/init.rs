#![cfg(unix)]
#![expect(
    clippy::indexing_slicing,
    reason = "serde_json::Value indexing yields Null for a missing key and the assertions fail loudly"
)]
// Process-level tests of `pdks-codex init`. The adapter runs with the project directory as its
// cwd and a temp `bin` directory as the only PATH entry; that directory holds a symlink to a real
// debug `pdks` (built once), so the adapter's call to `pdks init` is the real one.
//
// The project path is the one the process reports as its cwd, which on macOS is the physical
// path under `/private`; expectations use the canonicalized sandbox for that reason, and the
// `pdks` path is the PATH entry joined with `pdks`, not the symlink's target.

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{Value, json};

const ADAPTER: &str = env!("CARGO_BIN_EXE_pdks-codex");
const MATCHER: &str = "apply_patch|Bash";
const HOOKS: &str = ".codex/hooks.json";
const TOML: &str = ".codex/config.toml";
const CONFIG: &str = "polydeukes.config.yaml";
const TRUST: &str = "review and trust the new hook definitions with /hooks in Codex";
const WITNESS_TAIL: &str = "witness:\n  token: 'pdks witness'\n  ttlMinutes: 10\n";

static COUNTER: AtomicU32 = AtomicU32::new(0);
static JUDGE: OnceLock<PathBuf> = OnceLock::new();

fn judge() -> &'static Path {
    JUDGE.get_or_init(|| {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let status = Command::new(env!("CARGO"))
            .args(["build", "-p", "pdks"])
            .current_dir(&repo)
            .status()
            .expect("cargo starts");
        assert!(status.success(), "building pdks failed");
        let target = std::env::var_os("CARGO_TARGET_DIR")
            .map_or_else(|| repo.join("target"), |dir| repo.join(dir));
        target.join("debug/pdks")
    })
}

fn quote(word: &str) -> String {
    format!("'{}'", word.replace('\'', "'\"'\"'"))
}

fn command_for(adapter: &str, root: &str, pdks: &str) -> String {
    [adapter, "hook", "--project-root", root, "--pdks", pdks]
        .map(quote)
        .join(" ")
}

struct Sandbox {
    dir: PathBuf,
    bin: PathBuf,
    project: PathBuf,
}

impl Sandbox {
    fn new(with_pdks: bool) -> Self {
        Self::named(with_pdks, "project")
    }

    fn named(with_pdks: bool, project_name: &str) -> Self {
        let raw = std::env::temp_dir().join(format!(
            "pdks-codex-init-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(raw.join("bin")).expect("the bin directory is creatable");
        fs::create_dir_all(raw.join(project_name)).expect("the project directory is creatable");
        let dir = fs::canonicalize(&raw).expect("the sandbox is canonicalizable");
        let sandbox = Self {
            bin: dir.join("bin"),
            project: dir.join(project_name),
            dir,
        };
        if with_pdks {
            symlink(judge(), sandbox.pdks()).expect("the pdks link is creatable");
        }
        sandbox
    }

    fn pdks(&self) -> PathBuf {
        self.bin.join("pdks")
    }

    fn write(&self, rel: &str, contents: &str) {
        let path = self.project.join(rel);
        fs::create_dir_all(path.parent().expect("a relative path has a parent"))
            .expect("the parent is creatable");
        fs::write(path, contents).expect("the file is writable");
    }

    fn read(&self, rel: &str) -> String {
        fs::read_to_string(self.project.join(rel)).expect("the file exists")
    }

    fn hooks(&self) -> Value {
        serde_json::from_str(&self.read(HOOKS)).expect("hooks.json is JSON")
    }

    fn entries(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.project)
            .expect("the project is readable")
            .map(|entry| {
                entry
                    .expect("an entry is readable")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    fn init(&self) -> Output {
        Command::new(ADAPTER)
            .arg("init")
            .env_clear()
            .env("PATH", &self.bin)
            .current_dir(&self.project)
            .stdin(Stdio::null())
            .output()
            .expect("the adapter starts")
    }

    fn root(&self) -> String {
        self.project.to_string_lossy().into_owned()
    }

    fn command(&self, adapter: &str) -> String {
        command_for(adapter, &self.root(), &self.pdks().to_string_lossy())
    }

    fn handler(&self, timeout: u32) -> Value {
        json!({"type": "command", "command": self.command(ADAPTER), "timeout": timeout})
    }

    fn pre(&self) -> Value {
        json!({"matcher": MATCHER, "hooks": [self.handler(60)]})
    }

    fn post(&self) -> Value {
        json!({"matcher": MATCHER, "hooks": [self.handler(30)]})
    }

    fn end(&self) -> Value {
        json!({"hooks": [self.handler(3)]})
    }

    fn fresh(&self) -> Value {
        json!({"hooks": {
            "PreToolUse": [self.pre()],
            "PostToolUse": [self.post()],
            "SessionEnd": [self.end()],
        }})
    }

    // A 0.20.x command: the body executable run as `adapter codex hook`.
    fn old_command(&self) -> String {
        format!(
            "'/opt/old/pdks' 'adapter' 'codex' 'hook' '--project-root' '{}'",
            self.root()
        )
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

fn protected_paths(config: &str) -> Vec<String> {
    let value: Value = serde_saphyr::from_str(config).expect("the config is YAML");
    value["protectedPaths"]
        .as_array()
        .expect("protectedPaths is a list")
        .iter()
        .map(|item| item.as_str().expect("an item is a string").to_owned())
        .collect()
}

mod fresh_project {
    use super::*;

    #[test]
    fn writes_the_three_registrations_pinned_to_absolute_paths_without_a_failure_exit() {
        let sandbox = Sandbox::new(true);
        let output = sandbox.init();
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        // Catches: a `|| exit 2` suffix (a missing executable would then block every call), a
        // PATH-relative command or `--pdks`, a registered UserPromptSubmit, a wrong matcher or
        // timeout on any event, or a matcher on SessionEnd. Whole-file equality fails on any
        // extra key.
        assert_eq!(sandbox.hooks(), sandbox.fresh());
    }

    #[test]
    fn the_config_lists_both_codex_files_and_nothing_but_hooks_json_is_written_under_codex() {
        let sandbox = Sandbox::new(true);
        sandbox.init();
        // Catches: registering hooks without protecting the files that hold them, forgetting
        // `config.toml` (whose hook-trust hash and `hooks` flag switch the registration off), or
        // writing a Codex file the adapter does not own.
        assert_eq!(
            protected_paths(&sandbox.read(CONFIG)),
            vec![HOOKS.to_owned(), TOML.to_owned()]
        );
        assert_eq!(
            fs::read_dir(sandbox.project.join(".codex"))
                .expect(".codex exists")
                .count(),
            1
        );
    }

    #[test]
    fn reports_each_file_and_ends_with_the_trust_instruction() {
        let sandbox = Sandbox::new(true);
        let output = sandbox.init();
        // Catches: dropping the stdout of `pdks init`, a missing status word on the hooks file,
        // or a trust line that is not last (Codex skips changed hooks until approved).
        let lines: Vec<String> = out(&output).lines().map(str::to_owned).collect();
        assert!(
            lines.iter().any(|l| l == "created polydeukes.config.yaml"),
            "stdout: {}",
            out(&output)
        );
        assert!(
            lines.iter().any(|l| l == "created .codex/hooks.json"),
            "stdout: {}",
            out(&output)
        );
        assert_eq!(lines.last().map(String::as_str), Some(TRUST));
    }

    #[test]
    fn the_registered_command_runs_the_adapter_with_the_pinned_arguments_through_sh() {
        let sandbox = Sandbox::named(true, "it's a project");
        let link = sandbox.bin.join("pdks-codex");
        symlink(ADAPTER, &link).expect("the adapter link is creatable");
        let init = Command::new("pdks-codex")
            .arg("init")
            .env_clear()
            .env("PATH", &sandbox.bin)
            .current_dir(&sandbox.project)
            .stdin(Stdio::null())
            .output()
            .expect("the adapter starts through PATH");
        assert_eq!(init.status.code(), Some(0), "stderr: {}", err(&init));
        let command = sandbox.hooks()["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
            .as_str()
            .expect("the command is a string")
            .to_owned();
        // Catches: registering the bare name or the symlink-resolved target, and shell quoting
        // that splits a root containing a space or an apostrophe into extra words.
        assert_eq!(command, sandbox.command(&link.to_string_lossy()));
        // The recording script stands in for the adapter at the registered path, so the check
        // does not depend on what the adapter does when it runs.
        let record = sandbox.dir.join("argv");
        fs::remove_file(&link).expect("the link is removable");
        fs::write(
            &link,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\n",
                record.display()
            ),
        )
        .expect("the script is writable");
        fs::set_permissions(&link, fs::Permissions::from_mode(0o755))
            .expect("the script is chmod-able");
        let run = Command::new("/bin/sh")
            .args(["-c", &command])
            .output()
            .expect("sh starts");
        assert_eq!(run.status.code(), Some(0), "stderr: {}", err(&run));
        assert_eq!(
            fs::read_to_string(record).expect("the script recorded its argv"),
            format!(
                "hook\n--project-root\n{}\n--pdks\n{}\n",
                sandbox.root(),
                sandbox.pdks().display()
            )
        );
    }
}

mod earlier_registrations {
    use super::*;

    fn old_hooks(sandbox: &Sandbox) -> Value {
        let owned = |suffix: &str| json!({"type": "command", "command": format!("{}{suffix}", sandbox.old_command()), "timeout": 30});
        json!({
            "extra": {"keep": true},
            "hooks": {
                "PreToolUse": [{
                    "matcher": "*",
                    "hooks": [owned(" || exit 2"), {"type": "command", "command": "echo keep"}],
                }],
                "UserPromptSubmit": [{"hooks": [owned("")]}],
                "PostToolUse": [{"matcher": "*", "hooks": [owned("")]}],
                "SessionEnd": [{"hooks": [owned("")]}],
            },
        })
    }

    #[test]
    fn replaces_the_four_owned_handlers_and_keeps_the_sibling_and_other_keys() {
        let sandbox = Sandbox::new(true);
        sandbox.write(HOOKS, &old_hooks(&sandbox).to_string());
        let output = sandbox.init();
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        // Catches: leaving an old owned handler on any of the four events (two judges per call,
        // or a prompt event still registered), missing the `|| exit 2` spelling, dropping the
        // sibling handler or the unrelated key, and keeping an emptied entry or event array.
        assert_eq!(
            sandbox.hooks(),
            json!({
                "extra": {"keep": true},
                "hooks": {
                    "PreToolUse": [
                        {"matcher": "*", "hooks": [{"type": "command", "command": "echo keep"}]},
                        sandbox.pre(),
                    ],
                    "PostToolUse": [sandbox.post()],
                    "SessionEnd": [sandbox.end()],
                },
            })
        );
    }

    #[test]
    fn a_second_init_changes_nothing_and_reports_unchanged() {
        let sandbox = Sandbox::new(true);
        sandbox.write(HOOKS, &old_hooks(&sandbox).to_string());
        sandbox.init();
        let first = sandbox.read(HOOKS);
        let output = sandbox.init();
        // Catches: appending a second registration on every run, or rewriting the file (a
        // different key order or whitespace) when nothing changed, which invalidates the host's
        // trust of the definition.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(sandbox.read(HOOKS), first);
        assert!(
            out(&output)
                .lines()
                .any(|line| line == "unchanged .codex/hooks.json"),
            "stdout: {}",
            out(&output)
        );
    }

    #[test]
    fn a_handler_this_adapter_registered_from_another_path_is_replaced_not_duplicated() {
        let sandbox = Sandbox::new(true);
        let earlier = json!({
            "type": "command",
            "command": command_for("/elsewhere/pdks-codex", &sandbox.root(), "/elsewhere/pdks"),
            "timeout": 60,
        });
        sandbox.write(
            HOOKS,
            &json!({"hooks": {
                "PreToolUse": [{"matcher": MATCHER, "hooks": [earlier.clone()]}],
                "PostToolUse": [{"matcher": MATCHER, "hooks": [earlier.clone()]}],
                "SessionEnd": [{"hooks": [earlier]}],
            }})
            .to_string(),
        );
        sandbox.init();
        // Catches: recognizing only 0.20.x handlers, so a moved install accumulates one
        // registration per path.
        assert_eq!(sandbox.hooks(), sandbox.fresh());
    }

    #[test]
    fn handlers_that_only_resemble_an_owned_one_are_kept() {
        let sandbox = Sandbox::new(true);
        let root = sandbox.root();
        let lookalikes: Vec<Value> = [
            // First word is not an absolute path.
            format!("echo adapter codex hook --project-root {root}"),
            // No `--project-root`.
            "'/opt/old/pdks' 'adapter' 'codex' 'hook'".to_owned(),
            // A relative project root.
            "'/opt/old/pdks' 'adapter' 'codex' 'hook' '--project-root' 'relative'".to_owned(),
            // Another host's 0.20.x registration.
            format!("'/opt/old/pdks' 'adapter' 'claude-code' 'hook' '--project-root' '{root}'"),
            // This adapter without `--pdks`, with a relative `--pdks`, and under another name.
            format!("'/x/pdks-codex' 'hook' '--project-root' '{root}'"),
            format!("'/x/pdks-codex' 'hook' '--project-root' '{root}' '--pdks' 'relative/pdks'"),
            format!("'/x/pdks-codex-old' 'hook' '--project-root' '{root}' '--pdks' '/x/pdks'"),
        ]
        .into_iter()
        .map(|command| json!({"type": "command", "command": command}))
        .collect();
        sandbox.write(
            HOOKS,
            &json!({"hooks": {"PreToolUse": [{"hooks": lookalikes.clone()}]}}).to_string(),
        );
        sandbox.init();
        // Catches: a suffix or name match loose enough to delete a handler the owner wrote, or
        // another host's registration.
        assert_eq!(
            sandbox.hooks(),
            json!({"hooks": {
                "PreToolUse": [{"hooks": lookalikes}, sandbox.pre()],
                "PostToolUse": [sandbox.post()],
                "SessionEnd": [sandbox.end()],
            }})
        );
    }
}

mod protected_paths_edit {
    use super::*;

    fn item_lines(config: &str) -> Vec<&str> {
        config
            .lines()
            .skip_while(|l| *l != "protectedPaths:")
            .skip(1)
            .take_while(|l| l.trim_start().starts_with("- "))
            .collect()
    }

    #[test]
    fn an_empty_flow_list_becomes_a_block_list_and_every_other_line_is_kept() {
        let sandbox = Sandbox::new(true);
        let original =
            format!("# head comment\n# second\nprotectedPaths: []\n# tail comment\n{WITNESS_TAIL}");
        sandbox.write(CONFIG, &original);
        let output = sandbox.init();
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        let edited = sandbox.read(CONFIG);
        // Catches: re-serializing the file (comments lost), touching a neighbouring line, or
        // leaving the list empty after reporting success.
        let before: Vec<&str> = edited
            .lines()
            .take_while(|l| *l != "protectedPaths:")
            .collect();
        let after: Vec<&str> = edited
            .lines()
            .skip_while(|l| *l != "protectedPaths:")
            .skip(1)
            .skip_while(|l| l.trim_start().starts_with("- "))
            .collect();
        assert_eq!(before, vec!["# head comment", "# second"]);
        assert_eq!(
            after,
            vec![
                "# tail comment",
                "witness:",
                "  token: 'pdks witness'",
                "  ttlMinutes: 10"
            ]
        );
        assert!(edited.ends_with('\n'));
        assert_eq!(item_lines(&edited).len(), 2);
        assert_eq!(
            protected_paths(&edited),
            vec![HOOKS.to_owned(), TOML.to_owned()]
        );
    }

    #[test]
    fn rewriting_the_config_is_reported_and_leaving_it_alone_is_not() {
        let rewritten = Sandbox::new(true);
        rewritten.write(CONFIG, &format!("protectedPaths: []\n{WITNESS_TAIL}"));
        let output = rewritten.init();
        // Catches: editing the config silently, or claiming an edit when the list was complete.
        assert!(
            out(&output)
                .lines()
                .any(|l| l == "updated polydeukes.config.yaml"),
            "stdout: {}",
            out(&output)
        );
        let untouched = Sandbox::new(true);
        untouched.write(
            CONFIG,
            &format!("protectedPaths:\n  - '{HOOKS}'\n  - '{TOML}'\n{WITNESS_TAIL}"),
        );
        let output = untouched.init();
        assert!(
            !out(&output)
                .lines()
                .any(|l| l == "updated polydeukes.config.yaml"),
            "stdout: {}",
            out(&output)
        );
    }

    #[test]
    fn a_block_list_gets_two_items_at_its_own_indent_and_comments_survive() {
        for indent in ["  ", "    "] {
            let sandbox = Sandbox::new(true);
            sandbox.write(
                CONFIG,
                &format!("# head\nprotectedPaths:\n{indent}- \"a\" # why a\n{WITNESS_TAIL}"),
            );
            let output = sandbox.init();
            // Catches: a fixed indent that makes the new items a different YAML structure, an
            // insertion that lands inside or after the neighbouring key, or a rewrite that loses
            // the existing item's quoting and comment.
            assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
            assert_eq!(
                sandbox.read(CONFIG),
                format!(
                    "# head\nprotectedPaths:\n{indent}- \"a\" # why a\n{indent}- '{HOOKS}'\n{indent}- '{TOML}'\n{WITNESS_TAIL}"
                )
            );
        }
    }

    #[test]
    fn only_the_missing_path_is_appended() {
        for (present, missing) in [(HOOKS, TOML), (TOML, HOOKS)] {
            let sandbox = Sandbox::new(true);
            sandbox.write(
                CONFIG,
                &format!("protectedPaths:\n  - '{present}'\n{WITNESS_TAIL}"),
            );
            sandbox.init();
            // Catches: appending both paths regardless, which duplicates an entry, or skipping
            // the second path once the first is present.
            assert_eq!(
                sandbox.read(CONFIG),
                format!("protectedPaths:\n  - '{present}'\n  - '{missing}'\n{WITNESS_TAIL}")
            );
        }
    }

    #[test]
    fn a_list_that_already_holds_both_paths_is_left_untouched() {
        let sandbox = Sandbox::new(true);
        let original =
            format!("# keep\nprotectedPaths:\n  - \"{TOML}\"\n  - '{HOOKS}'\n{WITNESS_TAIL}");
        sandbox.write(CONFIG, &original);
        let output = sandbox.init();
        // Catches: rewriting a config that needs no change, or comparing quoted text instead of
        // parsed values.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(sandbox.read(CONFIG), original);
    }

    #[test]
    fn a_flow_list_with_an_item_stops_with_the_instruction_and_writes_nothing() {
        let sandbox = Sandbox::new(true);
        let original = format!("protectedPaths: [\"a\"]\n{WITNESS_TAIL}");
        sandbox.write(CONFIG, &original);
        let output = sandbox.init();
        // Catches: guessing an edit of a shape the adapter does not handle, exiting 0 with the
        // files unprotected, registering hooks before the protection is in place, or an
        // instruction that does not name the two paths and the key.
        assert_eq!(output.status.code(), Some(2), "stderr: {}", err(&output));
        for needle in [HOOKS, TOML, "protectedPaths"] {
            assert!(err(&output).contains(needle), "stderr: {}", err(&output));
        }
        assert_eq!(out(&output), "");
        assert_eq!(sandbox.read(CONFIG), original);
        assert!(!sandbox.project.join(HOOKS).exists());
    }
}

mod failures_write_nothing {
    use super::*;

    #[test]
    fn no_pdks_on_path_is_exit_2_with_the_install_hint_and_an_empty_project() {
        let sandbox = Sandbox::new(false);
        let output = sandbox.init();
        // Catches: registering a judge that does not exist, or creating files before the
        // lookup fails.
        assert_eq!(output.status.code(), Some(2));
        assert!(
            err(&output).contains("no pdks executable on PATH"),
            "stderr: {}",
            err(&output)
        );
        assert_eq!(out(&output), "");
        assert_eq!(sandbox.entries(), Vec::<String>::new());
    }

    #[test]
    fn hooks_of_the_wrong_shape_stop_init_before_anything_is_written() {
        let shapes = [
            "[]",
            "not json",
            r#"{"hooks":"#,
            r#"{"hooks": []}"#,
            r#"{"hooks": {"PreToolUse": {}}}"#,
            r#"{"hooks": {"SessionEnd": "x"}}"#,
        ];
        for shape in shapes {
            let sandbox = Sandbox::new(true);
            sandbox.write(HOOKS, shape);
            let output = sandbox.init();
            // Catches: overwriting a hooks file the adapter could not read, or creating the
            // config (a partial init) before the check that should have stopped it.
            assert_eq!(output.status.code(), Some(2), "shape: {shape}");
            assert!(!err(&output).trim().is_empty(), "shape: {shape}");
            assert_eq!(sandbox.read(HOOKS), shape);
            assert_eq!(
                sandbox.entries(),
                vec![".codex".to_owned()],
                "shape: {shape}"
            );
        }
    }

    #[test]
    fn a_failing_pdks_init_is_relayed_and_nothing_is_registered() {
        let sandbox = Sandbox::new(false);
        let fake = sandbox.pdks();
        fs::write(&fake, "#!/bin/sh\necho boom >&2\nexit 1\n").expect("the script is writable");
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755))
            .expect("the script is chmod-able");
        let output = sandbox.init();
        // Catches: ignoring the scaffold's status and registering a hook over a project whose
        // config was never created, or swallowing the reason.
        assert_eq!(output.status.code(), Some(2), "stderr: {}", err(&output));
        assert!(err(&output).contains("boom"), "stderr: {}", err(&output));
        assert!(!sandbox.project.join(HOOKS).exists());
    }
}
