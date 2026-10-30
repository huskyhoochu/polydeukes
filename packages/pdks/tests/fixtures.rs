use std::path::Path;
use std::process::Command;

fn run_runner(selector: &[&str], expected: &str) {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo = crate_dir
        .parent()
        .and_then(Path::parent)
        .expect("the crate sits two levels below the repository root");
    let output = Command::new("node")
        .arg(repo.join("scripts/verify-covenant-fixtures.mjs"))
        .args(["--executable", env!("CARGO_BIN_EXE_pdks")])
        .args(selector)
        .current_dir(repo)
        .output()
        .expect("node starts the fixture runner");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success() && stdout.contains(expected),
        "expected `{expected}`\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
}

#[test]
fn listed_conformance_cases_pass() {
    let list = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixture-cases.txt");
    run_runner(
        &["--cases", &list.to_string_lossy()],
        "44 covenant fixture cases passed.",
    );
}

#[test]
fn divergent_cases_pass() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/divergent");
    run_runner(
        &["--cases-dir", &dir.to_string_lossy()],
        "8 covenant fixture cases passed.",
    );
}

#[test]
fn not_ported_paths_block() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/not-ported");
    run_runner(
        &["--cases-dir", &dir.to_string_lossy()],
        "5 covenant fixture cases passed.",
    );
}
