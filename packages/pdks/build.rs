use std::env;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::exit;

fn fail(message: &str) -> ! {
    eprintln!("build.rs: {message}");
    exit(1);
}

/// A relative path whose segments are all real names, so it stays under `docs/`.
fn checked(path: &str) -> &str {
    if path.starts_with('/') || path.split('/').any(|part| matches!(part, "" | "." | "..")) {
        fail(&format!("unsafe documentation path: {path}"));
    }
    path
}

fn main() {
    let manifest = env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|e| fail(&e.to_string()));
    let out_dir = env::var("OUT_DIR").unwrap_or_else(|e| fail(&e.to_string()));
    let docs: PathBuf = Path::new(&manifest).join("docs");
    let catalog_path = docs.join("catalog.json");
    println!("cargo:rerun-if-changed={}", catalog_path.display());
    let text = fs::read_to_string(&catalog_path).unwrap_or_else(|e| fail(&e.to_string()));
    let catalog: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|e| fail(&e.to_string()));
    let documents = catalog
        .get("documents")
        .and_then(serde_json::Value::as_array)
        .unwrap_or_else(|| fail("catalog has no documents array"));

    let mut generated = format!(
        "pub const CATALOG: &str = include_str!({:?});\npub const FILES: &[(&str, &str)] = &[\n",
        catalog_path.display().to_string()
    );
    for document in documents {
        if document.get("bundled") != Some(&serde_json::Value::Bool(true)) {
            continue;
        }
        for language in ["en", "ko"] {
            let path = document
                .get(language)
                .and_then(|translation| translation.get("path"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_else(|| fail("a bundled document lacks a path"));
            let file = docs.join(checked(path));
            println!("cargo:rerun-if-changed={}", file.display());
            writeln!(
                generated,
                "    ({path:?}, include_str!({:?})),",
                file.display().to_string()
            )
            .unwrap_or_else(|e| fail(&e.to_string()));
        }
    }
    generated.push_str("];\n");
    fs::write(Path::new(&out_dir).join("docs_bundle.rs"), generated)
        .unwrap_or_else(|e| fail(&e.to_string()));
}
