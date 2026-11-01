#![cfg(unix)]
#![expect(
    clippy::indexing_slicing,
    reason = "serde_json::Value indexing yields Null for a missing key and the assertions fail loudly"
)]
// Process-level tests of `pdks-claude-code init`. The adapter runs with the project directory as
// its cwd and a temp `bin` directory as the only PATH entry; that directory holds a symlink to a
// real debug `pdks` (built once), so the adapter's call to `pdks init` is the real one.
//
// The project path is the one the process reports as its cwd, which on macOS is the physical
// path under `/private`; expectations use the canonicalized sandbox for that reason, and the
// `pdks` path is the PATH entry joined with `pdks`, not the symlink's target.

use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{Value, json};

const ADAPTER: &str = env!("CARGO_BIN_EXE_pdks-claude-code");
const MATCHER: &str = "Edit|Write|MultiEdit|NotebookEdit|Bash";
const SETTINGS: &str = ".claude/settings.json";
const LOCAL: &str = ".claude/settings.local.json";
const CONFIG: &str = "polydeukes.config.yaml";
const NO_PDKS: &str = "pdks-claude-code init: no pdks executable on PATH; install pdks first\n";
const FLOW_LIST: &str = "pdks-claude-code init: add .claude/settings.json and .claude/settings.local.json to protectedPaths in polydeukes.config.yaml, then run init again\n";
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

struct Sandbox {
    dir: PathBuf,
    bin: PathBuf,
    project: PathBuf,
}

impl Sandbox {
    fn new(with_pdks: bool) -> Self {
        let raw = std::env::temp_dir().join(format!(
            "pdks-cc-init-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(raw.join("bin")).expect("the bin directory is creatable");
        fs::create_dir_all(raw.join("project")).expect("the project directory is creatable");
        let dir = fs::canonicalize(&raw).expect("the sandbox is canonicalizable");
        let sandbox = Self {
            bin: dir.join("bin"),
            project: dir.join("project"),
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

    fn settings(&self) -> Value {
        serde_json::from_str(&self.read(SETTINGS)).expect("settings.json is JSON")
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

    fn registration(&self) -> Value {
        json!({
            "matcher": MATCHER,
            "hooks": [{
                "type": "command",
                "command": ADAPTER,
                "args": ["hook", "--project-root", self.root(), "--pdks", self.pdks()],
                "timeout": 60,
            }],
        })
    }

    // A 0.20.x registration: an executable run as `adapter claude-code hook`.
    fn old_handler(&self) -> Value {
        json!({
            "type": "command",
            "command": "/opt/old/pdks",
            "args": ["adapter", "claude-code", "hook", "--project-root", self.root()],
            "timeout": 30,
        })
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
    fn writes_one_pre_tool_use_registration_pinned_to_absolute_paths() {
        let sandbox = Sandbox::new(true);
        let output = sandbox.init();
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        // Catches: an `onFailure` key (a missing executable would then block every write), a
        // PATH-relative command or `--pdks` (the hook would search PATH at run time), a
        // symlink-resolved `pdks` path (breaks a versionless link), a stray lifecycle event, or
        // a timeout other than the host's 60 seconds. Whole-file equality fails on any extra key.
        assert_eq!(
            sandbox.settings(),
            json!({"hooks": {"PreToolUse": [sandbox.registration()]}})
        );
    }

    #[test]
    fn the_config_is_created_and_lists_both_claude_settings_files() {
        let sandbox = Sandbox::new(true);
        sandbox.init();
        // Catches: registering hooks without protecting the files that hold them, so the agent
        // could remove its own judgment; or forgetting the local settings file, whose
        // `disableAllHooks` switches the registration off.
        assert_eq!(
            protected_paths(&sandbox.read(CONFIG)),
            vec![SETTINGS.to_owned(), LOCAL.to_owned()]
        );
        assert!(
            sandbox
                .read(".gitignore")
                .lines()
                .any(|l| l == ".polydeukes/")
        );
    }

    #[test]
    fn reports_what_pdks_init_and_the_adapter_created() {
        let sandbox = Sandbox::new(true);
        let output = sandbox.init();
        // Catches: dropping the stdout of `pdks init`, so the config it created goes unreported.
        let lines: Vec<String> = out(&output).lines().map(str::to_owned).collect();
        assert!(
            lines.iter().any(|l| l == "created polydeukes.config.yaml"),
            "stdout: {}",
            out(&output)
        );
        assert!(
            lines.iter().any(|l| l == "created .claude/settings.json"),
            "stdout: {}",
            out(&output)
        );
    }

    #[test]
    fn writes_the_rules_and_skill_documents() {
        let sandbox = Sandbox::new(true);
        sandbox.init();
        // Catches: skipping the generated documents the scaffold promises.
        assert!(
            sandbox
                .project
                .join(".claude/rules/polydeukes.md")
                .is_file()
        );
        assert!(
            sandbox
                .project
                .join(".claude/skills/discipline-draft/SKILL.md")
                .is_file()
        );
    }

    #[test]
    fn existing_rules_and_skill_documents_are_left_byte_identical() {
        let sandbox = Sandbox::new(true);
        sandbox.write(".claude/rules/polydeukes.md", "my rules\n");
        sandbox.write(".claude/skills/discipline-draft/SKILL.md", "my skill\n");
        let output = sandbox.init();
        // Catches: overwriting a document the owner has edited.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(sandbox.read(".claude/rules/polydeukes.md"), "my rules\n");
        assert_eq!(
            sandbox.read(".claude/skills/discipline-draft/SKILL.md"),
            "my skill\n"
        );
    }
}

mod earlier_registrations {
    use super::*;

    fn old_settings(sandbox: &Sandbox) -> Value {
        let owned = sandbox.old_handler();
        let mut blocking = owned.clone();
        blocking["onFailure"] = json!("block");
        json!({
            "permissions": {"allow": ["x"]},
            "hooks": {
                "PreToolUse": [{
                    "matcher": "Write",
                    "hooks": [blocking, {"type": "command", "command": "echo keep"}],
                }],
                "UserPromptSubmit": [{"hooks": [owned.clone()]}],
                "PostToolUse": [{"matcher": "*", "hooks": [owned.clone()]}],
                "SessionEnd": [{"hooks": [owned]}],
            },
        })
    }

    #[test]
    fn replaces_owned_handlers_and_keeps_siblings_and_other_keys() {
        let sandbox = Sandbox::new(true);
        sandbox.write(SETTINGS, &old_settings(&sandbox).to_string());
        let output = sandbox.init();
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        // Catches: leaving an old owned handler (two judges per call), dropping the sibling
        // handler or the unrelated key, keeping an emptied entry or event array, and leaving the
        // three lifecycle events registered.
        assert_eq!(
            sandbox.settings(),
            json!({
                "permissions": {"allow": ["x"]},
                "hooks": {"PreToolUse": [
                    {"matcher": "Write", "hooks": [{"type": "command", "command": "echo keep"}]},
                    sandbox.registration(),
                ]},
            })
        );
    }

    #[test]
    fn recognizes_an_owned_handler_written_as_one_shell_quoted_string() {
        let sandbox = Sandbox::new(true);
        let command = format!(
            "'/opt/old/pdks' 'adapter' 'claude-code' 'hook' '--project-root' '{}'",
            sandbox.root()
        );
        let settings = json!({"hooks": {"PreToolUse": [
            {"matcher": "Write", "hooks": [{"type": "command", "command": command}]},
        ]}});
        sandbox.write(SETTINGS, &settings.to_string());
        sandbox.init();
        // Catches: matching only the `args` form, which leaves the old judge registered beside
        // the new one.
        assert_eq!(
            sandbox.settings(),
            json!({"hooks": {"PreToolUse": [sandbox.registration()]}})
        );
    }

    #[test]
    fn replaces_a_handler_this_adapter_registered_from_another_path() {
        let sandbox = Sandbox::new(true);
        let earlier = json!({
            "type": "command",
            "command": "/elsewhere/pdks-claude-code",
            "args": ["hook", "--project-root", sandbox.root(), "--pdks", "/elsewhere/pdks"],
            "timeout": 60,
        });
        sandbox.write(
            SETTINGS,
            &json!({"hooks": {"PreToolUse": [{"matcher": MATCHER, "hooks": [earlier]}]}})
                .to_string(),
        );
        sandbox.init();
        // Catches: recognizing only 0.20.x handlers, so a moved install accumulates one
        // registration per path.
        assert_eq!(
            sandbox.settings(),
            json!({"hooks": {"PreToolUse": [sandbox.registration()]}})
        );
    }

    #[test]
    fn keeps_handlers_that_only_resemble_an_owned_one() {
        let sandbox = Sandbox::new(true);
        let lookalikes = vec![
            // First word is not an absolute path.
            json!({"type": "command", "command":
                format!("echo adapter claude-code hook --project-root {}", sandbox.root())}),
            // No `--project-root`.
            json!({"type": "command", "command": "/opt/old/pdks",
                "args": ["adapter", "claude-code", "hook"]}),
            // A relative project root.
            json!({"type": "command", "command": "/opt/old/pdks",
                "args": ["adapter", "claude-code", "hook", "--project-root", "relative"]}),
        ];
        let settings = json!({"hooks": {"PreToolUse": [{"hooks": lookalikes.clone()}]}});
        sandbox.write(SETTINGS, &settings.to_string());
        sandbox.init();
        // Catches: a suffix match loose enough to delete a user's own handler.
        assert_eq!(
            sandbox.settings(),
            json!({"hooks": {"PreToolUse": [{"hooks": lookalikes}, sandbox.registration()]}})
        );
    }

    #[test]
    fn a_second_init_changes_nothing_and_reports_unchanged() {
        let sandbox = Sandbox::new(true);
        sandbox.write(SETTINGS, &old_settings(&sandbox).to_string());
        sandbox.init();
        let first = sandbox.read(SETTINGS);
        let output = sandbox.init();
        // Catches: appending a second registration on every run, or rewriting the file (a
        // different key order or whitespace) when nothing changed.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(sandbox.read(SETTINGS), first);
        assert!(
            out(&output)
                .lines()
                .any(|line| line == "unchanged .claude/settings.json"),
            "stdout: {}",
            out(&output)
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
            vec![SETTINGS.to_owned(), LOCAL.to_owned()]
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
            &format!("protectedPaths:\n  - '{SETTINGS}'\n  - '{LOCAL}'\n{WITNESS_TAIL}"),
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
    fn a_block_list_gets_two_items_at_its_own_indent() {
        for indent in ["  ", "    "] {
            let sandbox = Sandbox::new(true);
            sandbox.write(
                CONFIG,
                &format!("# head\nprotectedPaths:\n{indent}- \"a\"\n{WITNESS_TAIL}"),
            );
            let output = sandbox.init();
            // Catches: a fixed indent that makes the new items a different YAML structure, or an
            // insertion that lands inside or after the neighbouring key.
            assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
            assert_eq!(
                sandbox.read(CONFIG),
                format!(
                    "# head\nprotectedPaths:\n{indent}- \"a\"\n{indent}- '{SETTINGS}'\n{indent}- '{LOCAL}'\n{WITNESS_TAIL}"
                )
            );
        }
    }

    #[test]
    fn only_the_missing_path_is_appended() {
        let sandbox = Sandbox::new(true);
        sandbox.write(
            CONFIG,
            &format!("protectedPaths:\n  - '{SETTINGS}'\n{WITNESS_TAIL}"),
        );
        sandbox.init();
        // Catches: appending both paths regardless, which duplicates an entry.
        assert_eq!(
            sandbox.read(CONFIG),
            format!("protectedPaths:\n  - '{SETTINGS}'\n  - '{LOCAL}'\n{WITNESS_TAIL}")
        );
    }

    #[test]
    fn a_list_that_already_holds_both_paths_is_left_untouched() {
        let sandbox = Sandbox::new(true);
        let original =
            format!("# keep\nprotectedPaths:\n  - \"{LOCAL}\"\n  - '{SETTINGS}'\n{WITNESS_TAIL}");
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
        // files unprotected, or registering hooks before the protection is in place.
        assert_eq!(output.status.code(), Some(2));
        assert_eq!(err(&output), FLOW_LIST);
        assert_eq!(out(&output), "");
        assert_eq!(sandbox.read(CONFIG), original);
        assert!(!sandbox.project.join(SETTINGS).exists());
    }
}

mod bare_name_invocation {
    use super::*;

    #[test]
    fn a_bare_argv0_is_registered_as_the_path_spelling_of_the_adapter() {
        let sandbox = Sandbox::new(true);
        let link = sandbox.bin.join("pdks-claude-code");
        symlink(ADAPTER, &link).expect("the adapter link is creatable");
        let output = Command::new("pdks-claude-code")
            .arg("init")
            .env_clear()
            .env("PATH", &sandbox.bin)
            .current_dir(&sandbox.project)
            .stdin(Stdio::null())
            .output()
            .expect("the adapter starts through PATH");
        // Catches: registering the bare name (resolved through PATH at run time), the
        // symlink-resolved target, or the cwd-relative spelling.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert_eq!(
            sandbox.settings()["hooks"]["PreToolUse"][0]["hooks"][0]["command"],
            json!(link)
        );
    }
}

mod this_registration_lookalikes {
    use super::*;

    #[test]
    fn handlers_that_only_resemble_this_adapters_registration_are_kept() {
        let sandbox = Sandbox::new(true);
        let root = sandbox.root();
        let lookalikes = vec![
            // No `--pdks`.
            json!({"type": "command", "command": "/x/pdks-claude-code",
                "args": ["hook", "--project-root", root]}),
            // A relative `--pdks`.
            json!({"type": "command", "command": "/x/pdks-claude-code",
                "args": ["hook", "--project-root", root, "--pdks", "relative/pdks"]}),
            // A different file name with the right tail.
            json!({"type": "command", "command": "/x/pdks-claude-code-old",
                "args": ["hook", "--project-root", root, "--pdks", "/x/pdks"]}),
        ];
        sandbox.write(
            SETTINGS,
            &json!({"hooks": {"PreToolUse": [{"hooks": lookalikes.clone()}]}}).to_string(),
        );
        sandbox.init();
        // Catches: matching on the file name alone or on a prefix of it, which deletes a
        // handler the owner wrote.
        assert_eq!(
            sandbox.settings(),
            json!({"hooks": {"PreToolUse": [{"hooks": lookalikes}, sandbox.registration()]}})
        );
    }
}

mod pdks_init_failure {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

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
        assert!(!sandbox.project.join(SETTINGS).exists());
    }
}

mod generated_documents {
    use super::*;

    #[test]
    fn the_generated_documents_name_no_node_install_path() {
        let sandbox = Sandbox::new(true);
        sandbox.init();
        // Catches: shipping the TypeScript-era wording, which tells a reader to run a command
        // this executable does not provide.
        for rel in [
            ".claude/rules/polydeukes.md",
            ".claude/skills/discipline-draft/SKILL.md",
        ] {
            let text = sandbox.read(rel);
            assert!(!text.contains("node_modules"), "{rel}");
            assert!(!text.contains("pdks adapter claude-code"), "{rel}");
        }
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
        assert_eq!(err(&output), NO_PDKS);
        assert_eq!(out(&output), "");
        assert_eq!(sandbox.entries(), Vec::<String>::new());
    }

    #[test]
    fn settings_of_the_wrong_shape_stop_init_before_anything_is_written() {
        let shapes = ["[]", r#"{"hooks": []}"#, r#"{"hooks": {"PreToolUse": {}}}"#];
        for shape in shapes {
            let sandbox = Sandbox::new(true);
            sandbox.write(SETTINGS, shape);
            let output = sandbox.init();
            // Catches: overwriting a settings file the adapter could not read, or creating the
            // config (a partial init) before the check that should have stopped it.
            assert_eq!(output.status.code(), Some(2), "shape: {shape}");
            assert!(!err(&output).trim().is_empty(), "shape: {shape}");
            assert_eq!(sandbox.read(SETTINGS), shape);
            assert_eq!(
                sandbox.entries(),
                vec![".claude".to_owned()],
                "shape: {shape}"
            );
        }
    }
}
