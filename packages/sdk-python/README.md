# `polydeukes-sdk` (Python)

**English** · [한국어](README.ko.md)

Call the Polydeukes judge and memory commands from Python 3.12 or newer. Three synchronous verbs
share one executable resolver and process runner. The package has zero runtime dependencies.

```sh
python -m pip install polydeukes-sdk
```

Download `pdks-<target>-v<version>.tar.gz` from a
[GitHub
Release](https://github.com/huskyhoochu/polydeukes/releases),
extract the archive, mark the executable executable, and put it on an absolute `PATH` directory as
`pdks`, or pass its path as `executable`. Keep the SDK and executable on the same minor release.
Prebuilt executables support Linux x64, Linux arm64, and macOS arm64. On macOS, a browser download
may require `xattr -d com.apple.quarantine /path/to/pdks`.

Run the example from a configured project root. In a new example project, run `pdks init` first. For
memory queries, also prepare the extension and document collection using the
[memory walkthrough](../../docs/how-to/use-memory.md). Treat an unjudged operation or unavailable
search as a failure to establish a result, not as permission or an empty answer.

```python
from polydeukes_sdk import (
    CheckCovenantSpec,
    CovenantInput,
    Upheld,
    check_covenant,
    CheckChangeSetSpec,
    check_change_set,
    MemorySearchSpec,
    memory_search,
    Found,
    Empty,
    Unavailable,
)

payload: CovenantInput = {"toolCalls": [], "subagentSpawns": [], "userMessages": []}
verdict = check_covenant(CheckCovenantSpec(repo_root=".", input=payload, timeout=10))
if isinstance(verdict, Upheld):
    print("The proposed operation may proceed", verdict.advisories)

verdict = check_change_set(CheckChangeSetSpec(repo_root=".", diff="", timeout=10))
recall = memory_search(MemorySearchSpec(root=".", query="design decision", limit=5, timeout=10))
match recall:
    case Found(hits=hits):
        print(hits[0]["sectionTitle"])
    case Empty():
        print("No matches")
    case Unavailable(reason=reason):
        print("Memory unavailable:", reason)
```

The host supplies IR evidence and decides whether to execute the proposed operation. Only `Upheld`
permits it in this example. The child reads configuration, judges disciplines, writes telemetry, and
runs memory search.

Memory search runs `pdks memory ...`, which invokes `pdks-memory` on the SDK process's `PATH`.
Follow the [installation guide](../../docs/how-to/install.md) to install the extension. For a local
npm installation, add the project's absolute `node_modules/.bin` directory to `PATH` before starting
the SDK host. If it is missing, search returns `Unavailable` with the reason `pdks` prints.

The
[Python SDK
reference](https://github.com/huskyhoochu/polydeukes/blob/main/docs/reference/packages/sdk-python.md)
describes every spec, outcome, timeout, and the injectable `spawn` boundary.

[Installation guide](../../docs/how-to/install.md) ·
[Memory
walkthrough](../../docs/how-to/use-memory.md)
· [Migration](../../docs/how-to/migrate-to-rust.md)
