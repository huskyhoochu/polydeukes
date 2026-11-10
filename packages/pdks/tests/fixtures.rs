use std::path::Path;
use std::process::Command;

#[test]
fn conformance_cases_pass() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo = crate_dir
        .parent()
        .and_then(Path::parent)
        .expect("the crate sits two levels below the repository root");
    let expected = "274 covenant fixture cases passed.";
    let output = Command::new("node")
        .arg(repo.join("scripts/verify-covenant-fixtures.mjs"))
        .args(["--executable", env!("CARGO_BIN_EXE_pdks")])
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
