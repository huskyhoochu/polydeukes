#![cfg(unix)]
// Process-level tests of `pdks <name>` running a `pdks-<name>` executable found on PATH.
// Extensions are shell scripts in a temp directory that is the only PATH entry, so the scripts
// use shell builtins only.

use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};

const USAGE: &str = "usage: pdks covenant check";
const USAGE_TAIL: &str = "| pdks <extension> [args...]";
const MARKER: &str = "EXTENSION RAN";

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Sandbox {
    root: PathBuf,
    bin: PathBuf,
    work: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "pdks-ext-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let bin = root.join("bin");
        let work = root.join("work");
        fs::create_dir_all(&bin).expect("the bin directory is creatable");
        fs::create_dir_all(&work).expect("the work directory is creatable");
        Self { root, bin, work }
    }

    fn script(path: &Path, body: &str) {
        fs::write(path, format!("#!/bin/sh\n{body}\n")).expect("the script is writable");
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))
            .expect("the script is chmod-able");
    }

    fn extension(&self, file: &str, body: &str) {
        Self::script(&self.bin.join(file), body);
    }

    fn pdks(&self, args: &[&str], stdin: &str) -> Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_pdks"))
            .args(args)
            .env("PATH", &self.bin)
            .current_dir(&self.work)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the pdks executable starts");
        child
            .stdin
            .take()
            .expect("stdin is piped")
            .write_all(stdin.as_bytes())
            .expect("stdin is writable");
        child.wait_with_output().expect("pdks finishes")
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        // Cleanup failure leaves a temp directory behind and nothing else.
        #[expect(
            clippy::let_underscore_must_use,
            reason = "temp-dir removal is best effort"
        )]
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn out(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn err(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

const ECHO: &str = r#"for a in "$@"; do printf 'arg:%s\n' "$a"; done
printf 'to-stderr\n' >&2
while IFS= read -r line || [ -n "$line" ]; do printf '%s\n' "$line"; done
exit 7"#;

mod forwarding {
    use super::*;

    #[test]
    fn forwards_arguments_and_stdin_and_adopts_the_exit_code() {
        let sandbox = Sandbox::new();
        sandbox.extension("pdks-Echo_2-x", ECHO);
        let output = sandbox.pdks(&["Echo_2-x", "a", "b c", "--flag"], "payload");
        // The name carries every allowed character class, so a narrower name rule fails here.
        // Catches: dropping or re-splitting arguments, not inheriting stdin or stderr, or a fixed
        // exit code.
        assert_eq!(
            out(&output),
            "arg:a\narg:b c\narg:--flag\npayload\n",
            "stderr: {}",
            err(&output)
        );
        assert_eq!(err(&output), "to-stderr\n");
        assert_eq!(output.status.code(), Some(7));
    }

    #[test]
    fn passes_an_argument_that_is_not_utf8_unchanged() {
        let sandbox = Sandbox::new();
        sandbox.extension("pdks-echo", ECHO);
        let output = Command::new(env!("CARGO_BIN_EXE_pdks"))
            .arg("echo")
            .arg(OsStr::from_bytes(b"\xffraw"))
            .env("PATH", &sandbox.bin)
            .current_dir(&sandbox.work)
            .stdin(Stdio::null())
            .output()
            .expect("the pdks executable starts");
        // Catches: collecting argv as `String`, which turns this call into a usage error.
        assert_eq!(output.stdout, b"arg:\xffraw\n");
        assert_eq!(output.status.code(), Some(7));
    }

    #[test]
    fn an_extension_that_cannot_be_run_reports_the_error_and_exits_2() {
        let sandbox = Sandbox::new();
        let path = sandbox.bin.join("pdks-plain");
        fs::write(&path, "#!/bin/sh\nexit 0\n").expect("the file is writable");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644))
            .expect("the file is chmod-able");
        let output = sandbox.pdks(&["plain"], "");
        // Without the execute bit the spawn fails with a permission error, not "not found".
        assert!(
            err(&output).starts_with("pdks: cannot run pdks-plain: "),
            "stderr: {}",
            err(&output)
        );
        assert_eq!(output.status.code(), Some(2));
    }

    #[test]
    fn the_extension_replaces_the_pdks_process() {
        let sandbox = Sandbox::new();
        sandbox.extension("pdks-who", "printf '%s\\n' \"$$\"");
        let child = Command::new(env!("CARGO_BIN_EXE_pdks"))
            .arg("who")
            .env("PATH", &sandbox.bin)
            .current_dir(&sandbox.work)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the pdks executable starts");
        let id = child.id();
        let output = child.wait_with_output().expect("pdks finishes");
        // Catches: spawning the extension as a child, whose pid differs from pdks's.
        assert_eq!(out(&output).trim(), id.to_string());
    }

    #[test]
    fn a_missing_extension_names_the_install_and_exits_2() {
        let sandbox = Sandbox::new();
        let output = sandbox.pdks(&["missing", "x"], "");
        // Catches: a different wording, output on stdout, or an exit code other than 2.
        let stderr = err(&output);
        let mut lines = stderr.lines();
        assert_eq!(
            lines.next(),
            Some(
                "pdks: 'missing' is not a pdks command and no pdks-missing executable is on PATH; install pdks-missing to add it"
            )
        );
        let usage = lines.next().expect("the usage line follows");
        assert!(
            usage.starts_with(USAGE) && usage.ends_with(USAGE_TAIL),
            "stderr: {stderr}"
        );
        assert_eq!(lines.next(), None);
        assert_eq!(out(&output), "");
        assert_eq!(output.status.code(), Some(2));
    }
}

mod precedence {
    use super::*;

    fn shadowed() -> Sandbox {
        let sandbox = Sandbox::new();
        let ran = sandbox.root.join("ran");
        let body = format!("printf '{MARKER}\\n'; printf x > '{}'", ran.display());
        sandbox.extension("pdks-docs", &body);
        for name in ["pdks-covenant", "pdks-explain", "pdks-init"] {
            sandbox.extension(name, &body);
        }
        sandbox
    }

    #[test]
    fn a_builtin_docs_wins_over_a_pdks_docs_extension() {
        let sandbox = shadowed();
        let output = sandbox.pdks(&["docs"], "");
        // Catches: checking PATH before the builtin table.
        assert_eq!(output.status.code(), Some(0), "stderr: {}", err(&output));
        assert!(!out(&output).contains(MARKER));
        assert!(!sandbox.root.join("ran").exists());
    }

    #[test]
    fn a_builtin_covenant_with_bad_arguments_still_prints_usage_and_exits_2() {
        let sandbox = shadowed();
        let output = sandbox.pdks(&["covenant", "bogus"], "");
        // Catches: handing a malformed builtin invocation to the same-named extension.
        assert_eq!(output.status.code(), Some(2));
        assert!(err(&output).starts_with(USAGE), "stderr: {}", err(&output));
        assert!(
            err(&output).trim_end().ends_with(USAGE_TAIL),
            "stderr: {}",
            err(&output)
        );
        assert!(!out(&output).contains(MARKER));
        assert!(!sandbox.root.join("ran").exists());
    }

    #[test]
    fn a_builtin_name_never_runs_an_extension_whatever_its_case() {
        for args in [
            &["explain", "x"][..],
            &["init", "x"][..],
            &["Covenant", "check"][..],
        ] {
            let sandbox = shadowed();
            let output = sandbox.pdks(args, "");
            // Catches: a case-sensitive builtin table, since some filesystems resolve
            // `pdks-Covenant` to `pdks-covenant`.
            assert_eq!(output.status.code(), Some(2), "args: {args:?}");
            assert!(err(&output).starts_with(USAGE), "stderr: {}", err(&output));
            assert!(!sandbox.root.join("ran").exists());
        }
    }
}

mod names {
    use super::*;

    #[test]
    fn a_name_with_a_slash_never_runs_a_cwd_relative_path() {
        let sandbox = Sandbox::new();
        let dir = sandbox.work.join("pdks-a");
        fs::create_dir_all(&dir).expect("the directory is creatable");
        Sandbox::script(&dir.join("b"), &format!("printf '{MARKER}\\n'"));
        let output = sandbox.pdks(&["a/b"], "");
        // Catches: building `pdks-a/b` and letting Command resolve it against the cwd.
        assert_eq!(output.status.code(), Some(2));
        assert!(err(&output).starts_with(USAGE), "stderr: {}", err(&output));
        assert!(!out(&output).contains(MARKER));
    }

    #[test]
    fn a_name_starting_with_a_dash_is_not_an_extension() {
        let sandbox = Sandbox::new();
        sandbox.extension("pdks--x", &format!("printf '{MARKER}\\n'"));
        let output = sandbox.pdks(&["--x"], "");
        // Catches: treating an unknown flag as an extension name.
        assert_eq!(output.status.code(), Some(2));
        assert!(err(&output).starts_with(USAGE), "stderr: {}", err(&output));
        assert!(!out(&output).contains(MARKER));
    }
}
