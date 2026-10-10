//! `memory_search` is one `pdks memory search <query> --json [--limit n]` spawn in the memory
//! root and the child's stdout back as a value. The CLI already separates "nothing found"
//! (exit 0, `results: []`) from "could not run" (exit 2, stderr); this verb's whole job is
//! to keep that separation as two enum arms, and to parse the hits into the type generated
//! from core's schema. Every case injects the `spawn` seam and reads what it was handed, and
//! every row of the status → outcome table has a case, because `Empty` is the one arm a
//! failure must never land in.

use std::cell::RefCell;
use std::fs;
use std::io;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};

use polydeukes_sdk::{
    MemorySearchOutcome, MemorySearchResult, MemorySearchSpec, SpawnOutcome, SpawnSpec,
    memory_search,
};
use serde_json::{Value, json};
use tempfile::TempDir;

/// The umbrella's own manifest spells the bin with a leading `./`, so the stub does too.
const STUB_BIN_REL: &str = "./dist/bin.js";
/// What the child must be asked to run, after the bin path, around the query.
const SEARCH_VERB: [&str; 2] = ["memory", "search"];
const JSON_FLAG: &str = "--json";
const LIMIT_FLAG: &str = "--limit";
/// Injected fixture values — a two-word query the CLI must receive as one argument, and
/// the section ids the fake CLI answers with.
const QUERY: &str = "cognee removal";
const FIRST_ID: &str = "notes/decisions#cognee";
const SECOND_ID: &str = "notes/log#cleanup";
const THIRD_ID: &str = "notes/log#triage";
const STAMP: &str = "2026-10-10T14:00:00.000Z";

/// A fixture tree whose path is canonical, so a bin path and a cwd computed from it agree
/// with one computed through the filesystem (macOS hands out `/var/...` for `/private/var/...`).
fn fixture_root() -> (TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix("pdks-sdk-rust-memory-")
        .tempdir()
        .expect("tempdir");
    let root = dir.path().canonicalize().expect("canonical tempdir");
    (dir, root)
}

/// A stub `polydeukes` install under `dir`; returns the bin file it points at.
fn install_stub_polydeukes(dir: &Path) -> PathBuf {
    let pkg_dir = dir.join("node_modules").join("polydeukes");
    fs::create_dir_all(pkg_dir.join("dist")).expect("stub dist dir");
    fs::write(
        dir.join("package.json"),
        "{\"name\":\"consumer\",\"private\":true}\n",
    )
    .expect("consumer manifest");
    fs::write(
        pkg_dir.join("package.json"),
        json!({ "name": "polydeukes", "bin": { "pdks": STUB_BIN_REL } }).to_string(),
    )
    .expect("stub manifest");
    let bin = pkg_dir.join("dist").join("bin.js");
    fs::write(&bin, "").expect("stub bin");
    bin
}

/// One result in the nine-field shape `pdks memory search --json` prints.
fn result(id: &str, trust: &str, match_path: &str, superseded_by: &[&str]) -> Value {
    json!({
        "id": id,
        "conceptId": id.split('#').next().unwrap(),
        "docTitle": "Decisions",
        "sectionTitle": "Cognee",
        "status": "active",
        "trust": trust,
        "stale": false,
        "matchPath": match_path,
        "supersededBy": superseded_by,
    })
}

fn three_hits() -> Vec<Value> {
    vec![
        result(FIRST_ID, "human-reviewed", "and", &[]),
        result(SECOND_ID, "unverified", "like", &["notes/newer"]),
        result(THIRD_ID, "machine-verified", "or", &[]),
    ]
}

fn output(results: Vec<Value>) -> String {
    json!({ "ingestedAt": STAMP, "results": results }).to_string()
}

/// A seam that records every spec it is handed and answers `outcome` for each.
struct RecordingSeam {
    calls: RefCell<Vec<SpawnSpec>>,
    outcome: Option<(Option<i32>, String, String)>,
}

impl RecordingSeam {
    fn answering(
        status: Option<i32>,
        stdout: impl Into<String>,
        stderr: impl Into<String>,
    ) -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            outcome: Some((status, stdout.into(), stderr.into())),
        }
    }

    fn failing() -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            outcome: None,
        }
    }

    fn spawn(&self, spec: SpawnSpec) -> io::Result<SpawnOutcome> {
        self.calls.borrow_mut().push(spec);
        match &self.outcome {
            Some((status, stdout, stderr)) => Ok(SpawnOutcome {
                status: *status,
                stdout: stdout.clone(),
                stderr: stderr.clone(),
            }),
            None => Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "spawn EACCES",
            )),
        }
    }

    fn calls(&self) -> std::cell::Ref<'_, Vec<SpawnSpec>> {
        self.calls.borrow()
    }
}

fn spec<'a>(
    root: &'a Path,
    spawn: &'a dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>,
) -> MemorySearchSpec<'a> {
    MemorySearchSpec {
        root,
        query: QUERY,
        limit: None,
        executable: None,
        spawn: Some(spawn),
    }
}

fn found(outcome: MemorySearchOutcome) -> Vec<MemorySearchResult> {
    match outcome {
        MemorySearchOutcome::Found { hits } => hits,
        MemorySearchOutcome::Empty => panic!("expected found, got empty"),
        MemorySearchOutcome::Unavailable { reason } => {
            panic!("expected found, got unavailable: {reason}")
        }
    }
}

fn unavailable(outcome: MemorySearchOutcome) -> String {
    match outcome {
        MemorySearchOutcome::Unavailable { reason } => reason,
        MemorySearchOutcome::Found { hits } => {
            panic!("expected unavailable, got found with {} hits", hits.len())
        }
        MemorySearchOutcome::Empty => panic!("expected unavailable, got empty"),
    }
}

/// `args` with the bin path canonicalized, so `./dist/bin.js` and `dist/bin.js` read alike.
fn argv_with_canonical_bin(spec: &SpawnSpec) -> Vec<String> {
    let mut args = spec.args.clone();
    let bin = Path::new(&args[0])
        .canonicalize()
        .expect("the bin path names a file");
    args[0] = bin.to_string_lossy().into_owned();
    args
}

fn expected_argv(bin: &Path, tail: &[&str]) -> Vec<String> {
    std::iter::once(bin.to_string_lossy().into_owned())
        .chain(SEARCH_VERB.iter().map(|s| s.to_string()))
        .chain(tail.iter().map(|s| s.to_string()))
        .collect()
}

mod what_the_seam_is_handed {
    use super::*;

    #[test]
    fn spawns_node_on_the_resolved_bin_with_the_query_as_one_arg_then_json_cwd_root_empty_stdin() {
        // The query travels as ONE argument: split on spaces it still joins back on the CLI
        // side, but a query starting with `--` or holding a flag word would be reparsed. The
        // CLI without `--json` prints the table form, which the parse step refuses — every
        // search would come back `Unavailable`. A cwd off `root` reads another index.
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(0), output(vec![]), "");

        memory_search(spec(&root, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].command, "node");
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &[QUERY, JSON_FLAG])
        );
        assert_eq!(calls[0].cwd, root);
        assert_eq!(calls[0].stdin, "");
    }

    #[test]
    fn a_limit_appends_the_flag_and_its_decimal_value_after_json() {
        // `--limit=5`, the value before the flag, or the flag with no value are all shapes
        // the CLI refuses as usage; a limit rendered through `Debug` (`5` is fine, but a
        // non-zero wrapper could print its type) is one too.
        let (_dir, root) = fixture_root();
        let bin = install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(0), output(vec![]), "");
        let spawn = |s| seam.spawn(s);
        let mut s = spec(&root, &spawn);
        s.limit = NonZeroU32::new(5);

        memory_search(s);

        assert_eq!(
            argv_with_canonical_bin(&seam.calls()[0]),
            expected_argv(&bin, &[QUERY, JSON_FLAG, LIMIT_FLAG, "5"])
        );
    }

    #[test]
    fn a_relative_root_resolves_from_the_current_directory_and_spawns_absolute_paths() {
        // A relative root has no ancestors above `.`, and a relative cwd is read against the
        // host's own cwd. The fixture is reached through `..` from the test's cwd so no test
        // changes the process-wide current directory.
        let (_dir, workspace) = fixture_root();
        let bin = install_stub_polydeukes(&workspace);
        let root = workspace.join("apps").join("consumer");
        fs::create_dir_all(&root).expect("nested root");
        let cwd = std::env::current_dir()
            .expect("cwd")
            .canonicalize()
            .expect("canonical cwd");
        let mut relative = PathBuf::new();
        for _ in cwd.components().skip(1) {
            relative.push("..");
        }
        relative.push(root.strip_prefix("/").expect("absolute fixture"));
        let seam = RecordingSeam::answering(Some(0), output(vec![]), "");

        memory_search(spec(&relative, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert!(Path::new(&calls[0].args[0]).is_absolute());
        assert!(calls[0].cwd.is_absolute());
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &[QUERY, JSON_FLAG])
        );
        assert_eq!(calls[0].cwd.canonicalize().expect("cwd exists"), root);
    }
}

mod the_child_status_and_stdout_are_the_outcome {
    use super::*;

    #[test]
    fn status_0_with_hits_is_found_with_the_hits_in_the_clis_order() {
        // The hits are the value: a verb that returns only the first, sorts by id, or drops
        // a hit whose `supersededBy` is non-empty hands the host a different answer than
        // the CLI gave. Serializing the parsed hits back compares every field at once.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(0), output(three_hits()), "");

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        let hits = found(outcome);
        assert_eq!(hits.len(), 3);
        assert_eq!(
            serde_json::to_value(&hits).expect("hits serialize"),
            Value::Array(three_hits())
        );
    }

    #[test]
    fn status_0_with_an_empty_results_list_is_empty() {
        // The one path to `Empty`. A verb that returns `Found { hits: vec![] }` makes the
        // host check emptiness twice; one that reads an empty list as `Unavailable` turns
        // every miss into an outage.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(0), output(vec![]), "");

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        assert!(matches!(outcome, MemorySearchOutcome::Empty));
    }

    #[test]
    fn status_0_with_an_unparseable_stdout_is_unavailable_not_empty() {
        // The table form at exit 0 is what a verb that forgot `--json` sees; a parse that
        // falls back to an empty list reports "nothing found" for an index it never read.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(
            Some(0),
            format!(
                "# ingested at {STAMP}\n{FIRST_ID}\tand\tactive\tunverified\tDecisions › Cognee\n"
            ),
            "",
        );

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        unavailable(outcome);
    }

    #[test]
    fn status_0_with_a_hit_outside_the_closed_enums_is_unavailable() {
        // A `trust` or `matchPath` value the generated enum does not know is a CLI newer
        // than this crate; a parse that coerces it or drops the hit reads a different
        // answer. A named failure is the value the host should see.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(
            Some(0),
            output(vec![result(FIRST_ID, "unverified", "fuzzy", &[])]),
            "",
        );

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        unavailable(outcome);
    }

    #[test]
    fn status_0_with_a_hit_missing_a_required_field_is_unavailable() {
        // Every one of the nine fields is required; a type generated with them optional
        // would parse a CLI that renamed `stale` as a hit that is never stale.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let mut hit = result(FIRST_ID, "unverified", "and", &[]);
        hit.as_object_mut().unwrap().remove("stale");
        let seam = RecordingSeam::answering(Some(0), output(vec![hit]), "");

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        unavailable(outcome);
    }

    #[test]
    fn status_2_is_unavailable_carrying_stderr_as_the_reason_whatever_stdout_holds() {
        // Exit 2 with a stdout that happens to parse (an index that was there a moment
        // ago, a usage line after a partial print) is still not an answer; the status
        // decides first, and the stderr line is what the host logs.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(
            Some(2),
            output(vec![]),
            "pdks memory: no index at .polydeukes/memory.db — run `pdks memory ingest` first\n",
        );

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        assert_eq!(
            unavailable(outcome),
            "pdks memory: no index at .polydeukes/memory.db — run `pdks memory ingest` first\n"
        );
    }

    #[test]
    fn status_0_with_no_results_key_is_unavailable_not_empty() {
        // Only a `results` list the CLI printed may read as "nothing found".
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam =
            RecordingSeam::answering(Some(0), json!({ "ingestedAt": STAMP }).to_string(), "");

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        unavailable(outcome);
    }

    #[test]
    fn a_status_other_than_2_carries_its_stderr_as_the_reason() {
        // Every non-zero status is a failure of the same kind here; the covenant verbs'
        // split between exit 2 and the rest does not apply.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(1), "", "node: out of memory\n");

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        assert_eq!(unavailable(outcome), "node: out of memory\n");
    }

    #[test]
    fn a_non_zero_status_with_an_empty_stderr_names_the_status() {
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(Some(1), "", "");

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        let reason = unavailable(outcome);
        assert!(
            reason.contains("status 1"),
            "reason names the status: {reason}"
        );
    }

    #[test]
    fn a_signalled_child_is_unavailable_with_a_reason_naming_the_signal() {
        // `None` is a child that never left a status; `unwrap_or(0)` reads a kill as a
        // status 0 and then parses whatever stdout was left.
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::answering(None, output(three_hits()), "");

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        let reason = unavailable(outcome);
        assert!(
            reason.to_lowercase().contains("signal"),
            "reason names the signal: {reason}"
        );
    }

    #[test]
    fn a_seam_that_fails_is_unavailable_carrying_the_error_never_a_panic() {
        let (_dir, root) = fixture_root();
        install_stub_polydeukes(&root);
        let seam = RecordingSeam::failing();

        let outcome = memory_search(spec(&root, &|s| seam.spawn(s)));

        let reason = unavailable(outcome);
        assert!(
            reason.contains("spawn EACCES"),
            "reason carries the error: {reason}"
        );
    }
}

mod resolving_the_umbrella {
    use super::*;

    #[test]
    fn an_install_in_an_ancestor_of_root_is_found_and_cwd_stays_root() {
        // One probe that the verb walks the covenant verbs' path: a lookup of its own that
        // stops at `root` reads a workspace member as not installed, and a cwd moved to the
        // install's directory searches the workspace's index instead of the member's.
        let (_dir, workspace) = fixture_root();
        let bin = install_stub_polydeukes(&workspace);
        let root = workspace.join("apps").join("consumer");
        fs::create_dir_all(&root).expect("nested root");
        let seam = RecordingSeam::answering(Some(0), output(vec![]), "");

        memory_search(spec(&root, &|s| seam.spawn(s)));

        let calls = seam.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            argv_with_canonical_bin(&calls[0]),
            expected_argv(&bin, &[QUERY, JSON_FLAG])
        );
        assert_eq!(calls[0].cwd, root);
    }
}
