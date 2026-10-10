//! `src/ir.rs` and `src/memory.rs` are core's schemas translated by typify and committed, so
//! a consumer build needs no schema file and no generator. This test regenerates each from
//! the schema beside this crate and compares: a hand-edited line, or a schema change without
//! a regeneration, fails here. With `POLYDEUKES_REGEN_IR=1` it writes the files instead of
//! comparing. Outside the checkout (a published crate) the schemas are absent and the test
//! has nothing to compare.

use std::fs;
use std::path::Path;

const REGEN_ENV: &str = "POLYDEUKES_REGEN_IR";

/// One generated file: where its schema sits relative to the crate, where the committed
/// text lives, and the exact lines ahead of the generated text.
struct Generated {
    schema_rel: &'static str,
    file_rel: &'static str,
    header: &'static str,
}

const GENERATED: [Generated; 2] = [
    Generated {
        schema_rel: "../core/schema/covenant-input.schema.json",
        file_rel: "src/ir.rs",
        header: "// Generated from packages/core/schema/covenant-input.schema.json by typify. Do not edit;\n// run `POLYDEUKES_REGEN_IR=1 cargo test --test ir_generated` to regenerate.\n\n",
    },
    Generated {
        schema_rel: "../core/schema/memory-search-output.schema.json",
        file_rel: "src/memory.rs",
        header: "// Generated from packages/core/schema/memory-search-output.schema.json by typify. Do not edit;\n// run `POLYDEUKES_REGEN_IR=1 cargo test --test ir_generated` to regenerate.\n\n",
    },
];

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

fn check(generated: &Generated) {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let schema_path = manifest_dir.join(generated.schema_rel);
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
    let expected = format!("{}{}", generated.header, generate(&schema_text));
    let file_path = manifest_dir.join(generated.file_rel);

    if std::env::var_os(REGEN_ENV).is_some_and(|value| value == "1") {
        fs::write(&file_path, expected).expect("write the generated file");
        return;
    }

    let committed = fs::read_to_string(&file_path).unwrap_or_else(|error| {
        panic!(
            "{} is not readable ({error}); run `{REGEN_ENV}=1 cargo test --test ir_generated` to generate it",
            file_path.display()
        )
    });
    assert!(
        committed == expected,
        "{} differs from a fresh generation at {}; run `{REGEN_ENV}=1 cargo test --test ir_generated` to regenerate",
        file_path.display(),
        first_difference(&committed, &expected)
    );
}

#[test]
fn committed_ir_equals_the_header_plus_a_fresh_generation_from_the_schema() {
    // A field added to the schema, or a line edited by hand in `src/ir.rs`, makes the two
    // texts differ; a test that generated from the committed file's own doc comment, or
    // compared only type names, would stay green through both.
    check(&GENERATED[0]);
}

#[test]
fn committed_memory_types_equal_the_header_plus_a_fresh_generation_from_the_schema() {
    // The memory schema is the only thing that fixes the hit type's field names; a
    // `src/memory.rs` edited by hand to match an older CLI, or left behind after a schema
    // change, is what this catches. Inside the checkout a missing schema fails rather than
    // skips, so the check cannot be turned off by moving the file.
    check(&GENERATED[1]);
}
