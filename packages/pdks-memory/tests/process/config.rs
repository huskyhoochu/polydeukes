//! Config discovery and the `memory` section's reach.

use serde_json::json;

use crate::common::{NOTES_INCLUDE, Project, doc};

const MEMORY_YAML: &str = "memory:\n  include:\n    - 'notes/**/*.md'\n";

// Each of the three names is a config; a name the lookup forgets turns a valid project into
// "no config".
#[test]
fn each_of_the_three_config_names_is_read() {
    for name in [
        "polydeukes.config.yaml",
        "polydeukes.config.yml",
        "polydeukes.config.json",
    ] {
        let project = Project::bare();
        let text = if name.ends_with("json") {
            json!({ "memory": { "include": [NOTES_INCLUDE] } }).to_string()
        } else {
            MEMORY_YAML.to_string()
        };
        project.write(name, &text);
        project.write("notes/a.md", &doc(&[], &[("One", "x")]));

        assert_eq!(
            project.ok(&["stats"]),
            "documents  1\nsections  1\nlinks  0\nunresolved  0\nisolated  1/1\n",
            "{name}"
        );
    }
}

// Only `memory` is read: a discipline list that would fail the judge's own loader must not stop
// a memory command.
#[test]
fn an_invalid_key_outside_memory_does_not_stop_a_command() {
    let project = Project::bare();
    project.write(
        "polydeukes.config.json",
        &json!({
            "memory": { "include": [NOTES_INCLUDE] },
            "disciplines": "not a list",
            "witness": 42,
            "unknownKey": { "nested": true }
        })
        .to_string(),
    );
    project.write("notes/a.md", &doc(&[], &[("One", "x")]));

    assert_eq!(
        project.ok(&["stats", "--json"]),
        "{\"documents\":1,\"sections\":1,\"links\":0,\"unresolved\":0,\"isolated\":1}\n"
    );
}

// The same holds for a YAML config, where the other keys are read by a different parser.
#[test]
fn an_invalid_key_outside_memory_does_not_stop_a_command_in_yaml() {
    let project = Project::bare();
    project.write(
        "polydeukes.config.yaml",
        &format!("disciplines: not a list\nwitness: 42\n{MEMORY_YAML}"),
    );
    project.write("notes/a.md", &doc(&[], &[("One", "x")]));

    assert_eq!(
        project.ok(&["stats", "--json"]),
        "{\"documents\":1,\"sections\":1,\"links\":0,\"unresolved\":0,\"isolated\":1}\n"
    );
}

// The config is looked up in the working directory only; a config in a parent directory is not
// found.
#[test]
fn a_config_in_a_parent_directory_is_not_found() {
    let project = Project::notes();
    project.write("child/notes/a.md", &doc(&[], &[("One", "x")]));

    let out = project.run_in("child", &["stats"]);

    assert_eq!(out.code, 2);
    assert_eq!(out.stdout, "");
    assert!(
        out.stderr.starts_with("pdks memory: no config in "),
        "{}",
        out.stderr
    );
}
