//! `src/ir.rs` is the input schema translated by typify and committed, so a consumer build
//! needs no schema file and no generator. This test regenerates from the schema beside this
//! crate and compares: a hand-edited line, or a schema change without a regeneration, fails
//! here. With `POLYDEUKES_REGEN_IR=1` it writes the file instead of comparing. Outside the
//! checkout (a published crate) the schema is absent and the test has nothing to compare.

use std::fs;
use std::path::Path;

/// The exact lines ahead of the generated text in the committed file.
const HEADER: &str = "// Generated from packages/core/schema/covenant-input.schema.json by typify. Do not edit;\n// run `POLYDEUKES_REGEN_IR=1 cargo test --test ir_generated` to regenerate.\n\n";
const SCHEMA_REL: &str = "../core/schema/covenant-input.schema.json";
const IR_REL: &str = "src/ir.rs";
const REGEN_ENV: &str = "POLYDEUKES_REGEN_IR";

fn generate(schema_text: &str) -> String {
    let schema: schemars::schema::RootSchema =
        serde_json::from_str(schema_text).expect("the schema is JSON Schema");
    let mut space =
        typify::TypeSpace::new(typify::TypeSpaceSettings::default().with_struct_builder(false));
    space
        .add_root_schema(schema)
        .expect("typify accepts the schema");
    let file = syn::parse2::<syn::File>(space.to_stream()).expect("generated tokens parse");
    prettyplease::unparse(&file)
}

/// The first line where two texts differ, for a failure message shorter than both files.
fn first_difference(committed: &str, expected: &str) -> String {
    let mut committed_lines = committed.lines();
    let mut expected_lines = expected.lines();
    let mut line_no = 1;
    loop {
        match (committed_lines.next(), expected_lines.next()) {
            (None, None) => return "the texts differ only in their trailing newline".into(),
            (have, want) if have != want => {
                return format!(
                    "line {line_no}: committed {:?}, regenerated {:?}",
                    have.unwrap_or("<end of file>"),
                    want.unwrap_or("<end of file>")
                );
            }
            _ => line_no += 1,
        }
    }
}

#[test]
fn committed_ir_equals_the_header_plus_a_fresh_generation_from_the_schema() {
    // A field added to the schema, or a line edited by hand in `src/ir.rs`, makes the two
    // texts differ; a test that generated from the committed file's own doc comment, or
    // compared only type names, would stay green through both.
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let schema_path = manifest_dir.join(SCHEMA_REL);
    // Outside the repository (a packaged crate) there is no schema to compare against. Inside
    // it, a schema that moved would otherwise turn this check off without a word.
    let Ok(schema_text) = fs::read_to_string(&schema_path) else {
        assert!(
            !manifest_dir.join("../core/package.json").exists(),
            "{} is missing inside the repository",
            schema_path.display()
        );
        return;
    };
    let expected = format!("{HEADER}{}", generate(&schema_text));
    let ir_path = manifest_dir.join(IR_REL);

    if std::env::var_os(REGEN_ENV).is_some_and(|value| value == "1") {
        fs::write(&ir_path, expected).expect("write src/ir.rs");
        return;
    }

    let committed = fs::read_to_string(&ir_path).unwrap_or_else(|error| {
        panic!(
            "{} is not readable ({error}); run `{REGEN_ENV}=1 cargo test --test ir_generated` to generate it",
            ir_path.display()
        )
    });
    assert!(
        committed == expected,
        "{} differs from a fresh generation at {}; run `{REGEN_ENV}=1 cargo test --test ir_generated` to regenerate",
        ir_path.display(),
        first_difference(&committed, &expected)
    );
}
