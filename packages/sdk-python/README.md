# `polydeukes-sdk` (Python)

**English** · [한국어](README.ko.md)

Call the Polydeukes judge and memory commands from Python 3.12 or newer. Four synchronous
verbs share one executable resolver and process runner. The package has zero runtime dependencies.

```sh
python -m pip install polydeukes-sdk
```

Download `pdks-linux-x64` or `pdks-darwin-arm64` from a
[GitHub Release](https://github.com/huskyhoochu/polydeukes/releases), mark it executable, and
put it on an absolute `PATH` directory as `pdks`, or pass its path as `executable`.
Keep the SDK and executable on the same minor release. These are the supported platforms:
Linux x64 and macOS arm64. On macOS, a browser download may require
`xattr -d com.apple.quarantine /path/to/pdks`.

```python
from polydeukes_sdk import (
    CheckCovenantSpec,
    CovenantInput,
    Upheld,
    check_covenant,
    CheckChangeSetSpec,
    check_change_set,
    MemoryIngestSpec,
    memory_ingest,
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
ingest = memory_ingest(MemoryIngestSpec(root=".", timeout=30))
recall = memory_search(MemorySearchSpec(root=".", query="design decision", limit=5, timeout=10))
match recall:
    case Found(hits=hits):
        print(hits[0]["sectionTitle"])
    case Empty():
        print("No matches")
    case Unavailable(reason=reason):
        print("Memory unavailable:", reason)
```

The host supplies IR evidence and decides whether to execute the proposed operation. Only
`Upheld` permits it in this example. The child reads configuration, judges disciplines, writes
telemetry, and manages the memory index.

The [Python SDK reference](https://github.com/huskyhoochu/polydeukes/blob/main/docs/reference/packages/sdk-python.md)
describes every spec, outcome, timeout, and the injectable `spawn` boundary.
