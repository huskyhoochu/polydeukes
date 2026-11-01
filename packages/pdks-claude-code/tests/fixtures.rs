#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("the crate sits two levels below the repository root")
        .to_path_buf()
}

fn build_judge(repo: &Path) -> PathBuf {
    let status = Command::new(env!("CARGO"))
        .args(["build", "-p", "pdks"])
        .current_dir(repo)
        .status()
        .expect("cargo starts");
    assert!(status.success(), "cargo build -p pdks failed");
    let target = std::env::var_os("CARGO_TARGET_DIR")
        .map_or_else(|| repo.join("target"), |dir| repo.join(dir));
    target.join("debug/pdks")
}

#[test]
fn adapter_conformance_cases_pass() {
    let repo = repo_root();
    let judge = build_judge(&repo);
    let command = serde_json::json!([
        env!("CARGO_BIN_EXE_pdks-claude-code"),
        "hook",
        "--project-root",
        "@@ROOT@@",
        "--pdks",
        judge.to_string_lossy(),
    ]);
    let output = Command::new("node")
        .arg(repo.join("scripts/verify-adapter-fixtures.mjs"))
        .args(["--command", &command.to_string()])
        .current_dir(&repo)
        .output()
        .expect("node starts the fixture runner");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success() && stdout.contains("72 adapter fixture cases passed."),
        "expected `72 adapter fixture cases passed.`\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
}
