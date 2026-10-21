import json
import os
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from _support import FIXTURE, executable

import polydeukes_sdk as sdk


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_real_process_receives_root_and_drains_both_output_pipes(self):
        # Reading one stream before the other deadlocks when both exceed pipe capacity.
        program = executable(
            self.root,
            body="import os, sys\nassert os.path.samefile(os.getcwd(), sys.argv[-1])\nassert sys.stdin.buffer.read() == b'payload\\r\\n'\nsys.stdout.buffer.write(b'x' * 1048576)\nsys.stderr.buffer.write(b'y' * 1048576)",
        )
        result = sdk.check_change_set(
            sdk.CheckChangeSetSpec(
                repo_root=self.root,
                diff="payload\r\n",
                executable=program,
                telemetry_path=str(self.root),
                timeout=3,
            )
        )
        self.assertIsInstance(result, sdk.Upheld)
        self.assertEqual(result.advisories, "y" * 1048576)

    def test_child_closing_stdin_early_still_returns_its_verdict(self):
        # BrokenPipe during a large write must not replace the child's actual exit status.
        program = executable(self.root, body="import os\nos.close(0)\nos._exit(2)")
        result = sdk.check_change_set(
            sdk.CheckChangeSetSpec(
                repo_root=self.root, diff="x" * 1048576, executable=program, timeout=2
            )
        )
        self.assertIsInstance(result, sdk.Blocked)

    def test_timeout_returns_and_reaps_sleeping_and_nonreading_children(self):
        # Deadline handling must cover blocked writes as well as blocked reads.
        for diff in ("", "x" * 1048576):
            with self.subTest(stdin_length=len(diff)):
                pidfile = self.root / "child.pid"
                program = executable(
                    self.root,
                    body=f"import sys\nif '--warmup' in sys.argv: sys.exit(0)\nimport os,time\nfrom pathlib import Path\nPath({str(pidfile)!r}).write_text(str(os.getpid()))\ntime.sleep(30)",
                )
                # Warm macOS executable startup before measuring the communication deadline.
                subprocess.run([str(program), "--warmup"], check=True)
                pidfile.unlink(missing_ok=True)
                before = time.monotonic()
                result = sdk.check_change_set(
                    sdk.CheckChangeSetSpec(
                        repo_root=self.root, diff=diff, executable=program, timeout=0.2
                    )
                )
                self.assertLess(time.monotonic() - before, 5)
                self.assertIsInstance(result, sdk.Unjudged)
                self.assertTrue(result.reason)
                pid = int(pidfile.read_text())
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)

    @unittest.skipUnless(hasattr(os, "fork"), "requires POSIX process semantics")
    def test_descendant_holding_output_pipe_does_not_extend_deadline(self):
        # Waiting to drain a killed parent's inherited pipes hangs on its living descendant.
        direct = self.root / "direct.pid"
        descendant = self.root / "descendant.pid"
        program = executable(
            self.root,
            body=f"import sys\nif '--warmup' in sys.argv: sys.exit(0)\nimport os,time\nfrom pathlib import Path\nPath({str(direct)!r}).write_text(str(os.getpid()))\npid=os.fork()\nif pid == 0:\n Path({str(descendant)!r}).write_text(str(os.getpid()))\n time.sleep(30)\n os._exit(0)\ntime.sleep(30)",
        )
        subprocess.run([str(program), "--warmup"], check=True)
        try:
            before = time.monotonic()
            result = sdk.memory_ingest(
                sdk.MemoryIngestSpec(root=self.root, executable=program, timeout=0.2)
            )
            self.assertLess(time.monotonic() - before, 5)
            self.assertIsInstance(result, sdk.Unavailable)
            with self.assertRaises(ProcessLookupError):
                os.kill(int(direct.read_text()), 0)
            os.kill(int(descendant.read_text()), 0)
        finally:
            if descendant.exists():
                try:
                    os.kill(int(descendant.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass


@unittest.skipUnless(os.environ.get("PDKS_EXECUTABLE"), "set PDKS_EXECUTABLE to a standalone pdks")
class StandaloneTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.binary = Path(os.environ["PDKS_EXECUTABLE"]).absolute()
        for name, text in FIXTURE["rootFiles"].items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        (self.root / "polydeukes.config.json").write_text(json.dumps(FIXTURE["config"]))
        self.log = self.root / "telemetry.log"

    def test_real_ir_and_diff_judgments_have_telemetry_identity(self):
        # An assembly crash also exits 2; only a matching label and subject proves judgment.
        for verb, spec_type, field, value in (
            (sdk.check_covenant, sdk.CheckCovenantSpec, "input", FIXTURE["input"]),
            (sdk.check_change_set, sdk.CheckChangeSetSpec, "diff", FIXTURE["diff"]),
        ):
            with self.subTest(verb=verb.__name__):
                self.log.unlink(missing_ok=True)
                with patch.dict(os.environ, {"PATH": "/nonexistent"}):
                    blocked = verb(
                        spec_type(
                            repo_root=self.root,
                            executable=self.binary,
                            telemetry_path=self.log,
                            **{field: value},
                        )
                    )
                    advised = verb(
                        spec_type(
                            repo_root=self.root,
                            executable=self.binary,
                            telemetry_path=self.log,
                            enforce="advise",
                            **{field: value},
                        )
                    )
                self.assertIsInstance(blocked, sdk.Blocked)
                self.assertIsInstance(advised, sdk.Upheld)
                self.assertIn("TODO", advised.advisories)
                rows = [line.split("\t") for line in self.log.read_text().splitlines()]
                for event in ("blocked", "advised"):
                    self.assertTrue(
                        any(row[1:4] == [event, "sdk-no-todo", "lib/sample.ts"] for row in rows),
                        rows,
                    )
        ordinary = {"toolCalls": [], "subagentSpawns": [], "userMessages": []}
        self.assertIsInstance(
            sdk.check_covenant(
                sdk.CheckCovenantSpec(repo_root=self.root, input=ordinary, executable=self.binary)
            ),
            sdk.Upheld,
        )
        clean_diff = FIXTURE["diff"].replace("TODO", "DONE")
        self.assertIsInstance(
            sdk.check_change_set(
                sdk.CheckChangeSetSpec(repo_root=self.root, diff=clean_diff, executable=self.binary)
            ),
            sdk.Upheld,
        )

    def test_real_memory_distinguishes_absent_index_found_and_empty(self):
        # Only an ingested index can answer Found or Empty.
        with patch.dict(os.environ, {"PATH": "/nonexistent"}):

            def search(query):
                return sdk.memory_search(
                    sdk.MemorySearchSpec(root=self.root, query=query, executable=self.binary)
                )

            self.assertIsInstance(search(FIXTURE["query"]), sdk.Unavailable)
            self.assertIsInstance(
                sdk.memory_ingest(sdk.MemoryIngestSpec(root=self.root, executable=self.binary)),
                sdk.Ingested,
            )
            result = search(FIXTURE["query"])
            self.assertIsInstance(result, sdk.Found)
            self.assertEqual([hit["id"] for hit in result.hits], [FIXTURE["hit"]["id"]])
            self.assertIsInstance(search("absentwordxyz"), sdk.Empty)

    def test_invalid_config_never_returns_upheld(self):
        # Configuration failure shares exit 2 with blocked judgments in the CLI contract.
        (self.root / "polydeukes.config.json").write_text("{")
        result = sdk.check_covenant(
            sdk.CheckCovenantSpec(
                repo_root=self.root, input=FIXTURE["input"], executable=self.binary
            )
        )
        self.assertIsInstance(result, sdk.Blocked)
        self.assertTrue(result.reason)
