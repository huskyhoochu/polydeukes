# `polydeukes-sdk` (Python)

**English** · [한국어](sdk-python.ko.md)

Python 3.12+ synchronous client for `pdks covenant check` and `pdks memory`.
[Installation and four-verb example](../../../packages/sdk-python/README.md).

<a id="contract"></a>
## Contract

Each verb takes one keyword-only frozen dataclass spec and returns a frozen result value.
Paths accept `str | os.PathLike[str]`. Generated `TypedDict` inputs keep the CLI's camelCase
wire fields. `py.typed` is included; runtime dependencies are empty.

| Verb | Required spec fields | Result |
| --- | --- | --- |
| `check_covenant(CheckCovenantSpec(...))` | `repo_root`, `input: CovenantInput` | `Upheld(advisories)`, `Blocked(reason)`, `Unjudged(reason)` |
| `check_change_set(CheckChangeSetSpec(...))` | `repo_root`, `diff: str` | The same `CheckCovenantVerdict` union |
| `memory_ingest(MemoryIngestSpec(...))` | `root` | `Ingested()` or `Unavailable(reason)` |
| `memory_search(MemorySearchSpec(...))` | `root`, `query: str` | `Found(hits)`, `Empty()`, `Unavailable(reason)` |

Every spec has `executable=None`, `timeout=None`, and `spawn=None`. The covenant specs also
have `enforce='block'`, `config_layer=None`, and `telemetry_path=None`. Search adds
`limit=None`; a supplied limit must be a positive integer. `enforce` accepts `'advise'` or
`'block'`. Use `typing.assert_never` after a complete class-pattern match to check that every
result variant is handled. Frozen dataclasses are shallow: their nested input dictionaries
remain caller-owned.

<a id="execution"></a>
## Executable and process

All four verbs use one resolver and runner. A specified `executable` is a file path relative
to the caller's cwd, even for a bare name; its symlink spelling is preserved. Otherwise the
first executable regular file named `pdks` in an absolute `PATH` directory runs. Empty and
relative entries are skipped. A selected executable's failure returns a failure result.

The child cwd is the absolute `repo_root` or `root`, based on the caller's cwd. Configuration
and telemetry paths are passed unchanged; the child resolves relative values from that root.
The SDK sends the caller's IR as UTF-8 JSON (`allow_nan=False`) or the diff's unchanged UTF-8
bytes. It supplies no evidence of its own. Query text stays one argv item. Standard streams
are piped, descriptors are closed, and no shell evaluates the command.

| Verb | Arguments after executable | stdin |
| --- | --- | --- |
| `check_covenant` | `covenant check --enforce <level>` | JSON |
| `check_change_set` | `covenant check --diff --enforce <level>` | Unified diff |
| `memory_ingest` | `memory ingest` | Empty bytes |
| `memory_search` | `memory search <query> --json [--limit <n>]` | Empty bytes |

Both covenant verbs append `--config-layer` and `--telemetry-path` when specified. Generate
a diff with `git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ HEAD`;
untracked files require `git add -N` first. The SDK does not run git.

`timeout` is a finite nonnegative number of seconds; `0` is an immediate deadline and `None`
waits. It starts after process creation, during communication. Timeout kills and reaps the
direct child; descendants keep running, and inherited pipes do not extend the deadline on
Linux x64 and macOS arm64. Serialization and executable resolution precede this deadline.
An async caller uses `await asyncio.to_thread(check_covenant, spec)`.

<a id="outcomes"></a>
## Outcomes

Covenant exit `0` gives `Upheld`; exit `2` gives `Blocked`; other statuses, signals, resolution,
serialization, spawn, and timeout failures give `Unjudged`. The child's stderr is preserved
in `advisories` or `reason`. Exit `2` also includes CLI configuration failures: status alone
is the result contract. Read telemetry to identify the disciplines actually judged.
`Unjudged` is not permission to execute.

Memory nonzero exits, signals, spawn failures, and timeout give `Unavailable`. Ingest exit `0`
gives `Ingested`. Search requires valid UTF-8 JSON with a string `ingestedAt` and a `results`
array. Every hit's required fields, types, and `trust`/`matchPath` enums are checked; additional
fields are accepted. Only a valid empty array gives `Empty`. `Found.hits` is a nonempty tuple
that preserves CLI order; hit fields retain camelCase. Missing indexes and malformed replies
are `Unavailable`. Search retrieves sections; obligation lookup is a separate CLI command.

<a id="spawn"></a>
## Injecting spawn

The optional synchronous callable takes `SpawnSpec(command: str, args: tuple[str, ...],
cwd: str, stdin: bytes, timeout: float | None)` and returns
`SpawnOutcome(status: int | None, stdout: bytes, stderr: bytes)`. A `None` status means a
signal. The injected callable enforces the supplied timeout itself. Ordinary exceptions map
to the verb's failure result; `KeyboardInterrupt` and `SystemExit` propagate.

<a id="development"></a>
## Development and release

From the repository root:

```sh
uv sync --project packages/sdk-python --locked
uv run --project packages/sdk-python --locked python -m unittest discover -s packages/sdk-python/tests
uv run --project packages/sdk-python --locked python packages/sdk-python/scripts/generate_types.py --check
uv run --project packages/sdk-python --locked pyright --project packages/sdk-python/pyproject.toml
uv run --project packages/sdk-python --locked ruff check packages/sdk-python
uv build --project packages/sdk-python
```

Types are generated deterministically from core's two JSON schemas with the locked development
generator. The wheel and sdist install without runtime dependencies. Release automation bumps
`project.version` with the repository, verifies tag/package versions, tests the Linux executable
artifact, and publishes to PyPI with OIDC after executable builds pass. Existing PyPI versions
are skipped on retries.

Before the first release, the owner must configure a PyPI pending trusted publisher for project
`polydeukes-sdk`, owner `huskyhoochu`, repository `polydeukes`, workflow `publish.yml`, environment
`pypi`, and confirm the matching GitHub environment. This is a first-release prerequisite;
repository wiring alone does not establish that these external settings exist.

For a Python-only publication at an existing release version, create an annotated
`sdk-python-v<version>` tag containing the SDK and dispatch `publish.yml` from that tag with
`python_only=true`. This path verifies that the other packages' sources and manifests match
`v<version>`, downloads that release's Linux executable and checks its digest, then runs the
same Python distribution checks and PyPI upload. The npm/crate and executable release jobs are
skipped. Normal unified releases continue to use `v<version>` with `python_only=false`.
