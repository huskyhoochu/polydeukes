import copy
import json
import math
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from _support import FIXTURE, executable

import polydeukes_sdk as sdk


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.binary = executable(self.root)
        self.calls = []

    def invoke(self, verb="check_covenant", outcome=None, **extra):
        def spawn(spec):
            self.calls.append(spec)
            return outcome or sdk.SpawnOutcome(status=0, stdout=b"", stderr=b"")

        options = {"executable": self.binary, "spawn": spawn, **extra}
        if verb == "check_covenant":
            spec = sdk.CheckCovenantSpec(
                **{"repo_root": self.root, "input": copy.deepcopy(FIXTURE["input"]), **options}
            )
        elif verb == "check_change_set":
            spec = sdk.CheckChangeSetSpec(
                **{"repo_root": self.root, "diff": FIXTURE["diff"], **options}
            )
        elif verb == "memory_ingest":
            spec = sdk.MemoryIngestSpec(**{"root": self.root, **options})
        else:
            spec = sdk.MemorySearchSpec(**{"root": self.root, "query": FIXTURE["query"], **options})
        return getattr(sdk, verb)(spec)

    def test_shared_process_cases_preserve_arguments_and_result_meanings(self):
        # A successful process is insufficient to distinguish a judgment from a memory reply.
        for case in FIXTURE["processCases"]:
            with self.subTest(case=case["id"]):
                outcome = sdk.SpawnOutcome(
                    status=case["status"],
                    stdout=case["stdout"].encode(),
                    stderr=case["stderr"].encode(),
                )
                result = self.invoke(case["verb"], outcome)
                self.assertIsInstance(result, getattr(sdk, case["result"]))
                self.assertEqual(self.calls[-1].args, tuple(case["args"]))
                if isinstance(result, sdk.Upheld):
                    self.assertEqual(result.advisories, case["stderr"])
                elif isinstance(result, sdk.Blocked):
                    self.assertEqual(result.reason, case["stderr"])

    def test_optional_flags_and_query_are_literal_arguments(self):
        # Whitespace and shell syntax must survive as single arguments.
        self.invoke(
            config_layer=Path("layer name.json"), telemetry_path="log $HOME", enforce="advise"
        )
        self.assertEqual(
            self.calls[-1].args,
            (
                "covenant",
                "check",
                "--enforce",
                "advise",
                "--config-layer",
                "layer name.json",
                "--telemetry-path",
                "log $HOME",
            ),
        )
        query = "two words; $(touch injected)"
        self.invoke("memory_search", query=query, limit=7)
        self.assertEqual(self.calls[-1].args, ("memory", "search", query, "--json", "--limit", "7"))

    def test_stdin_preserves_evidence_absence_and_diff_line_endings(self):
        # Evidence belongs to its call, and a diff's CRLF is caller data.
        payload = {
            "toolCalls": [{"name": "fixture-edit"}],
            "subagentSpawns": [],
            "userMessages": [],
        }
        self.invoke(input=payload)
        self.assertEqual(json.loads(self.calls[-1].stdin), payload)
        diff = FIXTURE["diff"].replace("\n", "\r\n") + "한글"
        self.invoke("check_change_set", diff=diff)
        self.assertEqual(self.calls[-1].stdin, diff.encode())
        for verb in ("memory_ingest", "memory_search"):
            self.invoke(verb)
            self.assertEqual(self.calls[-1].stdin, b"")

    def test_serialization_failure_never_spawns_or_upholds(self):
        # Python's permissive NaN JSON would otherwise bypass the transport contract.
        for value in (float("nan"), object()):
            with self.subTest(value=type(value).__name__):
                payload = copy.deepcopy(FIXTURE["input"])
                payload["toolCalls"][0]["args"]["bad"] = value
                result = self.invoke(input=payload)
                self.assertIsInstance(result, sdk.Unjudged)
                self.assertTrue(result.reason)
        self.assertEqual(self.calls, [])

    def test_nonverdict_status_signal_and_spawn_error_are_closed_results(self):
        # A missing or signalled child is neither an upheld covenant nor an empty search.
        for verb in ("check_covenant", "check_change_set", "memory_ingest", "memory_search"):
            expected = sdk.Unjudged if verb.startswith("check") else sdk.Unavailable
            for status in (1, 127, None):
                with self.subTest(verb=verb, status=status):
                    result = self.invoke(
                        verb, sdk.SpawnOutcome(status=status, stdout=b"", stderr=b"failure\n")
                    )
                    self.assertIsInstance(result, expected)
                    self.assertTrue(result.reason)
            for error in (OSError("fixture spawn failure"), TimeoutError("fixture timeout")):

                def fail(_spec, error=error):
                    raise error

                self.assertIsInstance(self.invoke(verb, spawn=fail), expected)

    def test_memory_nonzero_including_two_is_unavailable(self):
        # Exit 2 has judgment meaning only on the covenant command.
        for verb in ("memory_ingest", "memory_search"):
            self.assertIsInstance(
                self.invoke(verb, sdk.SpawnOutcome(status=2, stdout=b"{}", stderr=b"failed")),
                sdk.Unavailable,
            )

    def test_control_flow_exceptions_propagate(self):
        # Catching BaseException would swallow a caller's cancellation.
        for error in (KeyboardInterrupt, SystemExit):

            def interrupt(_spec, error=error):
                raise error()

            with self.assertRaises(error):
                self.invoke(spawn=interrupt)

    def test_invalid_limits_and_timeouts_return_before_spawn(self):
        # Nonfinite deadlines and nonpositive limits cannot reach subprocess APIs.
        for limit in (0, -1, 1.5, True):
            self.assertIsInstance(self.invoke("memory_search", limit=limit), sdk.Unavailable)
        for verb in ("check_covenant", "check_change_set", "memory_ingest", "memory_search"):
            expected = sdk.Unjudged if verb.startswith("check") else sdk.Unavailable
            for timeout in (-1, math.inf, -math.inf, math.nan):
                with self.subTest(verb=verb, timeout=timeout):
                    self.assertIsInstance(self.invoke(verb, timeout=timeout), expected)
        self.assertEqual(self.calls, [])

    def test_zero_and_none_timeout_are_forwarded_on_every_verb(self):
        # Zero is an immediate deadline, rather than the unset value.
        for verb in ("check_covenant", "check_change_set", "memory_ingest", "memory_search"):
            for timeout in (None, 0, 0.2):
                self.invoke(verb, timeout=timeout)
                self.assertEqual(self.calls[-1].timeout, timeout)

    def test_relative_explicit_executable_and_root_use_callers_cwd(self):
        # Resolving the executable after chdir selects the wrong program.
        nested = self.root / "project"
        nested.mkdir()
        with patch("os.getcwd", return_value=str(self.root)):
            self.invoke(repo_root="project", executable="pdks")
        self.assertEqual(self.calls[-1].command, str(self.binary))
        self.assertEqual(self.calls[-1].cwd, str(nested))

    def test_path_uses_first_executable_regular_file_and_skips_relative_entries(self):
        # Relative PATH entries must not make the selected binary depend on the project.
        first = self.root / "first"
        first.mkdir()
        (first / "pdks").mkdir()
        denied = self.root / "denied"
        denied.mkdir()
        (denied / "pdks").write_text("not executable")
        second = self.root / "second"
        chosen = executable(second)
        third = self.root / "third"
        executable(third)
        with patch.dict(os.environ, {"PATH": f".:{first}:{denied}:{second}:{third}:"}):
            for verb in ("check_covenant", "check_change_set", "memory_ingest", "memory_search"):
                self.invoke(verb, executable=None)
                self.assertEqual(self.calls[-1].command, str(chosen))

    def test_missing_executable_never_probes_npm_or_calls_spawn(self):
        # A package installation cannot silently replace an absent standalone executable.
        npm = self.root / "node_modules/polydeukes"
        npm.mkdir(parents=True)
        (npm / "package.json").write_text('{"bin":{"pdks":"bin.js"}}')
        (npm / "bin.js").write_text("process.exit(0)")
        with patch.dict(os.environ, {"PATH": "relative::"}):
            for verb in ("check_covenant", "check_change_set", "memory_ingest", "memory_search"):
                expected = sdk.Unjudged if verb.startswith("check") else sdk.Unavailable
                result = self.invoke(verb, executable=None)
                self.assertIsInstance(result, expected)
                self.assertIn("PATH", result.reason)
        self.assertEqual(self.calls, [])

    def test_selected_executable_failure_does_not_fall_back(self):
        # A failed explicit executable cannot silently run a different installation.
        marker = self.root / "fallback-ran"
        fallback = self.root / "fallback"
        executable(fallback, body=f"from pathlib import Path\nPath({str(marker)!r}).touch()")
        with patch.dict(os.environ, {"PATH": str(fallback)}):
            result = sdk.check_covenant(
                sdk.CheckCovenantSpec(
                    repo_root=self.root, input=FIXTURE["input"], executable=self.root / "missing"
                )
            )
        self.assertIsInstance(result, sdk.Unjudged)
        self.assertFalse(marker.exists())

    def test_explicit_symlink_path_is_preserved(self):
        # Resolving a symlink changes the executable identity chosen by the caller.
        alias = self.root / "alias"
        alias.symlink_to(self.binary)
        self.invoke(executable=alias)
        self.assertEqual(self.calls[-1].command, str(alias))

    def search(self, value):
        data = value if isinstance(value, bytes) else json.dumps(value).encode()
        return self.invoke("memory_search", sdk.SpawnOutcome(status=0, stdout=data, stderr=b""))

    def test_search_keeps_hit_order_and_accepts_additional_fields(self):
        # Reordering or stripping a newer command's valid fields corrupts consumption.
        first = {**FIXTURE["hit"], "newField": "future"}
        second = {
            **FIXTURE["hit"],
            "id": "notes/beta#topic",
            "trust": "human-reviewed",
            "matchPath": "like",
        }
        result = self.search(
            {"ingestedAt": "fixture-time", "results": [first, second], "futureRoot": True}
        )
        self.assertIsInstance(result, sdk.Found)
        self.assertEqual(result.hits, (first, second))

    def test_only_valid_empty_search_is_empty(self):
        # Root shape errors must never be mistaken for a successful search with no hits.
        self.assertIsInstance(self.search({"ingestedAt": "fixture-time", "results": []}), sdk.Empty)
        for payload in (
            b"\xff",
            b"{",
            [],
            {},
            {"results": []},
            {"ingestedAt": 4, "results": []},
            {"ingestedAt": "x", "results": {}},
        ):
            with self.subTest(payload=repr(payload)):
                self.assertIsInstance(self.search(payload), sdk.Unavailable)

    def test_search_checks_each_required_field_and_consumed_type(self):
        # A missing field or wrong enum cannot masquerade as a schema-compatible hit.
        schema = json.loads(
            (
                Path(__file__).resolve().parents[3]
                / "packages/core/schema/memory-search-output.schema.json"
            ).read_text()
        )
        fields = schema["$defs"]["MemorySearchResult"]["required"]
        for field in fields:
            hit = copy.deepcopy(FIXTURE["hit"])
            del hit[field]
            with self.subTest(missing=field):
                self.assertIsInstance(
                    self.search({"ingestedAt": "x", "results": [hit]}), sdk.Unavailable
                )
        invalid = {
            "id": 2,
            "conceptId": None,
            "docTitle": [],
            "sectionTitle": {},
            "status": False,
            "trust": "other",
            "stale": 1,
            "matchPath": "other",
            "supersededBy": [3],
        }
        for field, value in invalid.items():
            with self.subTest(field=field):
                self.assertIsInstance(
                    self.search({"ingestedAt": "x", "results": [{**FIXTURE["hit"], field: value}]}),
                    sdk.Unavailable,
                )

    def test_path_selected_failure_never_tries_second_candidate(self):
        first = self.root / "first"
        chosen = executable(first, body="this is invalid python")
        second = self.root / "second"
        marker = self.root / "ran-second"
        executable(second, body=f"from pathlib import Path\nPath({str(marker)!r}).touch()")
        with patch.dict(os.environ, {"PATH": f"{first}:{second}"}):
            result = sdk.memory_ingest(sdk.MemoryIngestSpec(root=self.root))
        self.assertIsInstance(result, sdk.Unavailable)
        self.assertFalse(marker.exists())
        self.assertTrue(chosen.exists())

    def test_search_accepts_schema_enums_and_rejects_nonobject_hits(self):
        schema = json.loads(
            (
                Path(__file__).resolve().parents[3]
                / "packages/core/schema/memory-search-output.schema.json"
            ).read_text()
        )
        properties = schema["$defs"]["MemorySearchResult"]["properties"]
        for field in ("trust", "matchPath"):
            for value in properties[field]["enum"]:
                result = self.search(
                    {"ingestedAt": "x", "results": [{**FIXTURE["hit"], field: value}]}
                )
                self.assertIsInstance(result, sdk.Found)
        valid = {**FIXTURE["hit"], "supersededBy": ["notes/new"]}
        self.assertIsInstance(self.search({"ingestedAt": "x", "results": [valid]}), sdk.Found)
        for hit in (None, [], "hit", {**FIXTURE["hit"], "supersededBy": "notes/new"}):
            self.assertIsInstance(
                self.search({"ingestedAt": "x", "results": [hit]}), sdk.Unavailable
            )
