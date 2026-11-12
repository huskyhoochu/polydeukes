// Process-level tests of `pdks docs`. Every case runs in a directory whose configuration file is
// invalid, so a command that reads the configuration cannot answer.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{Map, Value};

const CONFIG: &str = "polydeukes.config.yaml";
const BROKEN_CONFIG: &str = "intentionally: [invalid";
const TOPICS: [&str; 6] = [
    "install",
    "recipes",
    "config",
    "discipline",
    "witness",
    "covenant",
];
const FAIL_PREFIX: &str = "pdks docs: ";

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Sandbox {
    dir: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "pdks-docs-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).expect("the sandbox directory is creatable");
        fs::write(dir.join(CONFIG), BROKEN_CONFIG).expect("the sandbox config is writable");
        Self { dir }
    }

    fn docs(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_pdks"))
            .arg("docs")
            .args(args)
            .current_dir(&self.dir)
            .output()
            .expect("the pdks executable starts")
    }

    fn exists(&self, name: &str) -> bool {
        self.dir.join(name).exists()
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

fn code(output: &Output) -> Option<i32> {
    output.status.code()
}

fn json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).expect("stdout is one JSON document")
}

fn keys(value: &Value) -> Vec<&str> {
    value
        .as_object()
        .expect("the value is an object")
        .keys()
        .map(String::as_str)
        .collect()
}

fn doc_file(relative: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs")
        .join(relative);
    fs::read_to_string(path).expect("the bundled document exists")
}

fn assert_fails(sandbox: &Sandbox, args: &[&str]) -> String {
    let output = sandbox.docs(args);
    assert_eq!(code(&output), Some(2), "args {args:?}");
    assert_eq!(out(&output), "", "stdout is empty for {args:?}");
    let stderr = err(&output);
    assert!(
        stderr.starts_with(FAIL_PREFIX),
        "stderr starts with the docs prefix for {args:?}: {stderr}"
    );
    stderr
}

mod cli_cases {
    use super::*;

    #[test]
    fn every_topic_answers_in_korean_with_a_see_also_line() {
        // Catches: a topic that ignores --lang, drops the closing see-also line, or reads the config.
        let sandbox = Sandbox::new();
        for topic in TOPICS {
            let output = sandbox.docs(&[topic, "--lang", "ko"]);
            assert_eq!(code(&output), Some(0), "{topic}: {}", err(&output));
            let text = out(&output);
            assert!(text.contains("See also: pdks docs show"), "{topic}");
            assert!(
                text.chars().any(|c| ('\u{ac00}'..='\u{d7a3}').contains(&c)),
                "{topic} has Hangul"
            );
        }
    }

    #[test]
    fn topics_default_to_english() {
        // Catches: --lang defaulting to ko, or both languages read from the same file. English
        // documents carry a Hangul language-switch link, so the check compares whole outputs.
        let sandbox = Sandbox::new();
        for topic in TOPICS {
            let default = sandbox.docs(&[topic]);
            assert_eq!(code(&default), Some(0), "{topic}: {}", err(&default));
            assert_eq!(
                out(&default),
                out(&sandbox.docs(&[topic, "--lang", "en"])),
                "{topic}"
            );
            assert_ne!(
                out(&default),
                out(&sandbox.docs(&[topic, "--lang", "ko"])),
                "{topic}"
            );
        }
    }

    #[test]
    fn a_phrase_found_nowhere_is_an_explicit_empty_success() {
        // Catches: an empty result treated as a failure (exit 2), or `results` omitted.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["search", "zz-docs-no-such-phrase-539", "--json"]);
        assert_eq!(code(&output), Some(0), "{}", err(&output));
        let value = json(&output);
        assert_eq!(value.get("count"), Some(&Value::from(0)));
        assert_eq!(value.get("results"), Some(&Value::Array(Vec::new())));
    }

    #[test]
    fn a_phrase_found_nowhere_prints_the_empty_text_form() {
        // Catches: the text form printing a header line or no empty-list marker.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["search", "zz-docs-no-such-phrase-539"]);
        assert_eq!(code(&output), Some(0));
        assert_eq!(
            out(&output),
            "0 results for zz-docs-no-such-phrase-539\n[]\n"
        );
    }

    #[test]
    fn failure_messages_name_the_reason() {
        // Catches: a generic failure line that hides which argument was wrong.
        let sandbox = Sandbox::new();
        let cases: [(&[&str], &str); 8] = [
            (&["search"], "pdks docs: missing search query\n"),
            (
                &["search", "x", "--limit", "51"],
                "pdks docs: invalid limit: 51\n",
            ),
            (
                &["show", "unknown"],
                "pdks docs: unknown document: unknown\n",
            ),
            (
                &["show", "first-judgment", "--section", "absent"],
                "pdks docs: unknown section: absent\n",
            ),
            (
                &["install", "--lang", "fr"],
                "pdks docs: unsupported language: fr\n",
            ),
            (&["bogus"], "pdks docs: unknown docs command: bogus\n"),
            (&["show"], "pdks docs: missing document id\n"),
            (
                &["install", "--bogus"],
                "pdks docs: unknown docs flag: --bogus\n",
            ),
        ];
        for (args, expected) in cases {
            assert_eq!(assert_fails(&sandbox, args), expected, "args {args:?}");
        }
    }
}

mod argument_errors {
    use super::*;

    #[test]
    fn malformed_argument_lists_exit_two_with_an_empty_stdout() {
        // Catches: any one of these slipping through as valid (a later duplicate silently winning,
        // a missing value swallowing the next flag, a stray positional ignored).
        let sandbox = Sandbox::new();
        let cases: [&[&str]; 23] = [
            &["search", "x", "--json", "--json"],
            &["search", "x", "--lang", "en", "--lang", "en"],
            &["search", "x", "--limit", "1", "--limit", "2"],
            &["search", "x", "--lang"],
            &["search", "x", "--limit"],
            &["search", "x", "--lang", "--json"],
            &["search", "x", "--limit", "--json"],
            &["search", "x", "y"],
            &["search", ""],
            &["search", "   "],
            &["search", "x", "--limit", "0"],
            &["search", "x", "--limit", "51"],
            &["search", "x", "--limit", "1.5"],
            &["search", "x", "--limit", "99999999999999999999"],
            &["search", "x", "--bogus"],
            &[
                "show",
                "cli-docs",
                "--section",
                "search",
                "--section",
                "show",
            ],
            &["show", "cli-docs", "--lang"],
            &["show", "cli-docs", "extra"],
            &["show", "cli-docs", "--bogus"],
            &["show", "a/b"],
            &["show", "cli-docs", "--section", "../x"],
            &["install", "--lang", "en", "--lang", "en"],
            &["install", "extra"],
        ];
        for args in cases {
            assert_fails(&sandbox, args);
        }
    }

    #[test]
    fn a_leading_dash_word_is_a_query_not_a_flag() {
        // Catches: the first search argument parsed as a flag, so `--diff` fails as unknown.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["search", "--diff"]);
        assert_eq!(code(&output), Some(0), "{}", err(&output));
        assert!(out(&output).contains("results for --diff"));
    }

    #[test]
    fn limits_of_one_and_fifty_are_accepted_and_five_is_the_default() {
        // Catches: an off-by-one range (1..50 or 2..=50), a cap that is ignored, and a default
        // other than five.
        let sandbox = Sandbox::new();
        let one = sandbox.docs(&["search", "pdks", "--limit", "1", "--json"]);
        assert_eq!(code(&one), Some(0), "{}", err(&one));
        let one = json(&one);
        assert_eq!(one.get("count"), Some(&Value::from(1)));
        assert_eq!(
            one.get("results").and_then(Value::as_array).map(Vec::len),
            Some(1)
        );

        let fifty = sandbox.docs(&["search", "pdks", "--limit", "50", "--json"]);
        assert_eq!(code(&fifty), Some(0), "{}", err(&fifty));
        let fifty = json(&fifty);
        let count = fifty.get("count").and_then(Value::as_u64).expect("count");
        assert!(count > 5 && count <= 50, "count {count}");

        let default = json(&sandbox.docs(&["search", "pdks", "--json"]));
        assert_eq!(default.get("count"), Some(&Value::from(5)));
    }

    #[test]
    fn help_forms_print_the_same_root_help() {
        // Catches: `search --help` or `show --help` parsed as a query or document id.
        let sandbox = Sandbox::new();
        let root = sandbox.docs(&[]);
        assert_eq!(code(&root), Some(0));
        let text = out(&root);
        assert!(text.starts_with("pdks docs\nUsage: pdks docs [topic]\n"));
        assert!(text.contains(
            "\nTopics:\n  install\n  recipes\n  config\n  discipline\n  witness\n  covenant\n"
        ));
        for args in [&["--help"][..], &["search", "--help"], &["show", "--help"]] {
            let output = sandbox.docs(args);
            assert_eq!(code(&output), Some(0), "{args:?}");
            assert_eq!(out(&output), text, "{args:?}");
        }
    }
}

mod independence_from_the_project {
    use super::*;

    #[test]
    fn a_topic_answers_beside_a_broken_config_and_creates_nothing() {
        // Catches: docs loading the config (exit 2) or opening telemetry under `.polydeukes/`.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["install"]);
        assert_eq!(code(&output), Some(0), "{}", err(&output));
        assert_ne!(out(&output), "");
        assert!(!sandbox.exists(".polydeukes"));
    }

    #[test]
    fn failures_and_queries_leave_no_telemetry_directory() {
        // Catches: a telemetry row written on the failure and search paths only.
        let sandbox = Sandbox::new();
        sandbox.docs(&["search", "pdks"]);
        sandbox.docs(&["show", "unknown"]);
        assert!(!sandbox.exists(".polydeukes"));
    }
}

mod normalization {
    use super::*;

    #[test]
    fn a_decomposed_korean_query_matches_like_the_composed_one() {
        // Catches: tokens lowercased without NFC first, so a macOS-copied (NFD) query finds nothing.
        let sandbox = Sandbox::new();
        let nfc = "\u{ac80}\u{c0c9}";
        let nfd = "\u{1100}\u{1165}\u{11b7}\u{1109}\u{1162}\u{11a8}";
        assert_ne!(nfc, nfd);

        let composed = json(&sandbox.docs(&["search", nfc, "--lang", "ko", "--json"]));
        let decomposed = json(&sandbox.docs(&["search", nfd, "--lang", "ko", "--json"]));

        let mut composed_rest: Map<String, Value> = composed.as_object().expect("object").clone();
        let mut decomposed_rest: Map<String, Value> =
            decomposed.as_object().expect("object").clone();
        composed_rest.remove("query");
        decomposed_rest.remove("query");
        assert!(composed.get("count").and_then(Value::as_u64) > Some(0));
        assert_eq!(decomposed_rest, composed_rest);
        let command = composed
            .pointer("/results/0/command")
            .and_then(Value::as_str)
            .expect("the first result carries a command");
        assert!(
            command.ends_with(&format!(
                "--lang ko --section {}",
                composed
                    .pointer("/results/0/sectionId")
                    .and_then(Value::as_str)
                    .expect("the first result carries a section id")
            )),
            "{command}"
        );
    }
}

mod json_shape {
    use super::*;

    #[test]
    fn show_json_has_the_documented_keys_and_nulls_the_section_of_a_whole_document() {
        // Catches: reordered or renamed keys, a wrong package version, a section id that is not null.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["show", "cli-docs", "--json"]);
        assert_eq!(code(&output), Some(0), "{}", err(&output));
        let value = json(&output);
        assert_eq!(
            keys(&value),
            [
                "schemaVersion",
                "packageVersion",
                "language",
                "documentId",
                "sectionId",
                "source",
                "markdown"
            ]
        );
        assert_eq!(value.get("schemaVersion"), Some(&Value::from(1)));
        assert_eq!(
            value.get("packageVersion"),
            Some(&Value::from(env!("CARGO_PKG_VERSION")))
        );
        assert_eq!(value.get("language"), Some(&Value::from("en")));
        assert_eq!(value.get("documentId"), Some(&Value::from("cli-docs")));
        assert_eq!(value.get("sectionId"), Some(&Value::Null));
        assert_eq!(
            value.get("source"),
            Some(&Value::from("reference/cli/docs.md"))
        );
        assert_eq!(
            value.get("markdown"),
            Some(&Value::from(doc_file("reference/cli/docs.md")))
        );
        assert!(out(&output).ends_with("}\n"));
    }

    #[test]
    fn show_json_for_a_section_names_it_in_the_source() {
        // Catches: a section source without the fragment, or a Korean request answered with the
        // English path.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&[
            "show",
            "cli-docs",
            "--lang",
            "ko",
            "--section",
            "search",
            "--json",
        ]);
        assert_eq!(code(&output), Some(0), "{}", err(&output));
        let value = json(&output);
        assert_eq!(value.get("language"), Some(&Value::from("ko")));
        assert_eq!(value.get("sectionId"), Some(&Value::from("search")));
        assert_eq!(
            value.get("source"),
            Some(&Value::from("reference/cli/docs.ko.md#search"))
        );
    }

    #[test]
    fn search_json_has_the_documented_keys_and_result_fields() {
        // Catches: reordered keys, a result missing its command or score, a query echoed after
        // trimming differently.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["search", "pdks docs", "--json"]);
        assert_eq!(code(&output), Some(0), "{}", err(&output));
        let value = json(&output);
        assert_eq!(
            keys(&value),
            [
                "schemaVersion",
                "packageVersion",
                "language",
                "query",
                "count",
                "results"
            ]
        );
        assert_eq!(
            value.get("packageVersion"),
            Some(&Value::from(env!("CARGO_PKG_VERSION")))
        );
        assert_eq!(value.get("query"), Some(&Value::from("pdks docs")));
        let results = value
            .get("results")
            .and_then(Value::as_array)
            .expect("results");
        assert_eq!(
            value.get("count").and_then(Value::as_u64),
            Some(results.len() as u64)
        );
        let first = results.first().expect("at least one result");
        assert_eq!(
            keys(first),
            [
                "documentId",
                "sectionId",
                "title",
                "excerpt",
                "source",
                "command",
                "score"
            ]
        );
        let document = first.get("documentId").and_then(Value::as_str).expect("id");
        let section = first
            .get("sectionId")
            .and_then(Value::as_str)
            .expect("section");
        assert_eq!(
            first.get("command").and_then(Value::as_str),
            Some(format!("pdks docs show {document} --lang en --section {section}").as_str())
        );
    }

    #[test]
    fn search_results_are_ordered_by_score_then_document_then_section() {
        // Catches: an unsorted or ascending result list, and unstable tie-breaking.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["search", "pdks", "--limit", "50", "--json"]);
        let value = json(&output);
        let results = value
            .get("results")
            .and_then(Value::as_array)
            .expect("results");
        let rows: Vec<(u64, &str, &str)> = results
            .iter()
            .map(|r| {
                (
                    r.get("score").and_then(Value::as_u64).expect("score"),
                    r.get("documentId").and_then(Value::as_str).expect("doc"),
                    r.get("sectionId").and_then(Value::as_str).expect("section"),
                )
            })
            .collect();
        assert!(rows.len() > 1);
        for pair in rows.windows(2) {
            let (a, b) = (pair.first().expect("a"), pair.get(1).expect("b"));
            assert!(
                a.0 > b.0 || (a.0 == b.0 && (a.1, a.2) < (b.1, b.2)),
                "{a:?} before {b:?}"
            );
        }
    }
}

mod retrieval {
    use super::*;

    #[test]
    fn show_section_returns_the_anchor_through_the_line_before_the_next_anchor() {
        // Catches: a section that drops its anchor line, bleeds into the next section, or is cut short.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["show", "cli-docs", "--section", "search"]);
        assert_eq!(code(&output), Some(0), "{}", err(&output));
        let text = out(&output);
        assert!(text.starts_with("<a id=\"search\"></a>\n## Search\n"));
        assert!(!text.contains("<a id=\"show\"></a>"));
        assert!(doc_file("reference/cli/docs.md").contains(&text));
    }

    #[test]
    fn the_witness_topic_lists_the_configuration_section_before_troubleshooting() {
        // Catches: topic references emitted out of catalog order, or the second reference dropped.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["witness"]);
        assert_eq!(code(&output), Some(0), "{}", err(&output));
        let text = out(&output);
        let configuration = text.find("<a id=\"witness\"></a>\n## `witness`");
        let troubleshooting =
            text.find("<a id=\"opening-a-blocked-call\"></a>\n## Opening a blocked call");
        assert!(configuration.is_some(), "configuration section present");
        assert!(troubleshooting.is_some(), "troubleshooting section present");
        assert!(configuration < troubleshooting);
        assert!(text.ends_with("See also: pdks docs show troubleshooting --lang en\n"));
    }
}

mod topic_list {
    use super::*;

    #[test]
    fn the_recipes_topic_prints_the_recipe_list_and_ends_with_the_host_support_line() {
        // Catches: a recipes topic wired to another document, or one whose closing see-also line
        // names a different document or is followed by more text.
        let sandbox = Sandbox::new();
        let output = sandbox.docs(&["recipes"]);
        assert_eq!(code(&output), Some(0), "{}", err(&output));
        let text = out(&output);
        assert!(
            text.contains("# Copy a discipline for the task you are doing"),
            "the recipe list heading is printed"
        );
        assert_eq!(
            text.lines().rfind(|line| !line.trim().is_empty()),
            Some("See also: pdks docs show host-support --lang en")
        );
    }

    #[test]
    fn topics_follow_the_navigation_order_of_their_first_reference_category() {
        // Catches: a topic listed out of navigation order, so `pdks docs` and the site sidebar
        // disagree; and a catalog that carries no category list to compare against.
        let sandbox = Sandbox::new();
        let help = out(&sandbox.docs(&[]));
        let listed: Vec<&str> = help
            .split_once("\nTopics:\n")
            .expect("the help has a Topics block")
            .1
            .lines()
            .map_while(|line| line.strip_prefix("  "))
            .collect();
        assert_ne!(listed.len(), 0, "the Topics block lists topics");

        let catalog: Value =
            serde_json::from_str(&doc_file("catalog.json")).expect("the catalog is JSON");
        let order: Vec<&str> = catalog
            .get("categories")
            .and_then(Value::as_array)
            .expect("the catalog has a categories array")
            .iter()
            .map(|category| category.get("id").and_then(Value::as_str).expect("id"))
            .collect();
        let documents = catalog
            .get("documents")
            .and_then(Value::as_array)
            .expect("documents is an array");

        let mut previous: Option<(&str, usize)> = None;
        for topic in listed {
            let document_id = catalog
                .pointer(&format!("/topics/{topic}/references/0/documentId"))
                .and_then(Value::as_str)
                .ok_or_else(|| format!("topic {topic} has no first reference"))
                .expect("every listed topic has a first reference");
            let category = documents
                .iter()
                .find(|document| document.get("id").and_then(Value::as_str) == Some(document_id))
                .and_then(|document| document.get("category").and_then(Value::as_str))
                .ok_or_else(|| format!("topic {topic}: document {document_id} has no category"))
                .expect("the referenced document carries a category");
            let position = order
                .iter()
                .position(|id| *id == category)
                .ok_or_else(|| format!("topic {topic}: category {category} is not listed"))
                .expect("the category is one of the catalog categories");
            if let Some((before, at)) = previous {
                assert!(
                    position >= at,
                    "topic {topic} ({category}) is listed after {before} but its category comes earlier"
                );
            }
            previous = Some((topic, position));
        }
    }
}

mod bundle {
    use std::collections::BTreeSet;

    use super::*;

    const LANGUAGES: [&str; 2] = ["en", "ko"];

    struct Bundled {
        id: String,
        paths: [String; 2],
    }

    fn bundled_documents() -> Vec<Bundled> {
        let catalog: Value =
            serde_json::from_str(&doc_file("catalog.json")).expect("the catalog is JSON");
        let path = |document: &Value, language: &str| -> String {
            document
                .get(language)
                .and_then(|translation| translation.get("path"))
                .and_then(Value::as_str)
                .expect("a translation has a path")
                .to_owned()
        };
        catalog
            .get("documents")
            .and_then(Value::as_array)
            .expect("documents is an array")
            .iter()
            .filter(|document| document.get("bundled") == Some(&Value::Bool(true)))
            .map(|document| Bundled {
                id: document
                    .get("id")
                    .and_then(Value::as_str)
                    .expect("a document has an id")
                    .to_owned(),
                paths: [path(document, "en"), path(document, "ko")],
            })
            .collect()
    }

    struct Section {
        id: String,
        text: String,
    }

    // The anchored H2–H6 sections of a document and the exact text `show --section` must return:
    // from the anchor line to the next anchor of a same-or-higher heading, or to the next H1
    // (its anchor line when it has one). Fenced lines are skipped, so a `#` line inside a code
    // block never counts as a heading or a boundary.
    fn sections(markdown: &str) -> Vec<Section> {
        let lines: Vec<&str> = markdown.split_inclusive('\n').collect();
        let mut starts: Vec<(String, usize, usize)> = Vec::new();
        let mut top_level: Vec<usize> = Vec::new();
        let mut fence: Option<(char, usize)> = None;
        let mut pending: Option<(String, usize)> = None;
        for (index, raw) in lines.iter().enumerate() {
            let line = raw.trim_end_matches('\n');
            let trimmed = line.trim();
            let marker = trimmed.chars().next().filter(|c| *c == '`' || *c == '~');
            if let Some(mark) = marker {
                let run = trimmed.chars().take_while(|c| *c == mark).count();
                if run >= 3 {
                    fence = match fence {
                        None => Some((mark, run)),
                        Some((open, length)) if open == mark && run >= length => None,
                        open => open,
                    };
                    pending = None;
                    continue;
                }
            }
            if fence.is_some() || trimmed.is_empty() {
                continue;
            }
            if let Some(id) = trimmed
                .strip_prefix("<a id=\"")
                .and_then(|rest| rest.strip_suffix("\"></a>"))
            {
                pending = Some((id.to_owned(), index));
                continue;
            }
            let level = line.chars().take_while(|c| *c == '#').count();
            let is_heading = (1..=6).contains(&level)
                && line.chars().nth(level).is_some_and(char::is_whitespace);
            if is_heading && level == 1 {
                top_level.push(pending.as_ref().map_or(index, |(_, at)| *at));
            } else if is_heading && let Some((id, at)) = pending.take() {
                starts.push((id, level, at));
            }
            pending = None;
        }
        let mut result = Vec::new();
        for (position, (id, level, start)) in starts.iter().enumerate() {
            let mut end = top_level
                .iter()
                .copied()
                .find(|boundary| boundary > start)
                .unwrap_or(lines.len());
            if let Some((_, _, next)) = starts
                .iter()
                .skip(position + 1)
                .find(|(_, next_level, _)| next_level <= level)
            {
                end = end.min(*next);
            }
            let text = lines
                .get(*start..end)
                .expect("bounds come from the scan")
                .concat();
            result.push(Section {
                id: id.clone(),
                text,
            });
        }
        result
    }

    fn section_ids(markdown: &str) -> BTreeSet<String> {
        sections(markdown)
            .into_iter()
            .map(|section| section.id)
            .collect()
    }

    #[test]
    fn every_bundled_section_is_retrievable_in_both_languages() {
        // Catches: a bundled file missing from the executable, a fenced `#` line read as a
        // heading or a boundary, or a section that ends early, late, or without its anchor.
        let sandbox = Sandbox::new();
        let documents = bundled_documents();
        assert_ne!(documents.len(), 0, "the catalog bundles documents");
        for document in &documents {
            for (language, path) in LANGUAGES.iter().zip(&document.paths) {
                let markdown = doc_file(path);
                let whole = sandbox.docs(&["show", &document.id, "--lang", language]);
                assert!(
                    out(&whole) == markdown,
                    "{} {language} returns the source file: {}",
                    document.id,
                    err(&whole)
                );
                for expected in sections(&markdown) {
                    let id = expected.id.as_str();
                    let args = ["show", &document.id, "--lang", language, "--section", id];
                    let section = sandbox.docs(&args);
                    assert_eq!(code(&section), Some(0), "{args:?}: {}", err(&section));
                    assert!(
                        out(&section) == expected.text,
                        "{args:?} returns the section from its anchor to its boundary"
                    );
                }
            }
        }
    }

    #[test]
    fn english_and_korean_carry_the_same_section_ids() {
        // Catches: a translation that adds, drops or renames an anchor, so `--section` answers in
        // one language and fails in the other.
        for document in bundled_documents() {
            let [en, ko] = &document.paths;
            assert_eq!(
                section_ids(&doc_file(en)),
                section_ids(&doc_file(ko)),
                "{}",
                document.id
            );
        }
    }
}
