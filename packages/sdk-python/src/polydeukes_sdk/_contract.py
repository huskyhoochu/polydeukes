"""Immutable call specifications and result variants."""

from collections.abc import Callable
from dataclasses import dataclass
from os import PathLike
from typing import Literal

from .ir import CovenantInput
from .memory import MemorySearchResult

type Path = str | PathLike[str]
type Enforce = Literal["advise", "block"]


@dataclass(frozen=True, kw_only=True)
class SpawnSpec:
    """One direct executable invocation; an injected spawn enforces its timeout."""

    command: str
    args: tuple[str, ...]
    cwd: str
    stdin: bytes
    timeout: float | None


@dataclass(frozen=True, kw_only=True)
class SpawnOutcome:
    """Captured process output, with a missing status representing a signal."""

    status: int | None
    stdout: bytes
    stderr: bytes


type Spawn = Callable[[SpawnSpec], SpawnOutcome]


@dataclass(frozen=True, kw_only=True)
class CheckCovenantSpec:
    """Check a caller-built input in the repository root."""

    repo_root: Path
    input: CovenantInput
    enforce: Enforce = "block"
    config_layer: Path | None = None
    telemetry_path: Path | None = None
    executable: Path | None = None
    timeout: float | None = None
    spawn: Spawn | None = None


@dataclass(frozen=True, kw_only=True)
class CheckChangeSetSpec:
    """Check the exact UTF-8 bytes of a caller's unified diff."""

    repo_root: Path
    diff: str
    enforce: Enforce = "block"
    config_layer: Path | None = None
    telemetry_path: Path | None = None
    executable: Path | None = None
    timeout: float | None = None
    spawn: Spawn | None = None


@dataclass(frozen=True, kw_only=True)
class MemoryIngestSpec:
    """Ask the executable to ingest documents under root."""

    root: Path
    executable: Path | None = None
    timeout: float | None = None
    spawn: Spawn | None = None


@dataclass(frozen=True, kw_only=True)
class MemorySearchSpec:
    """Search the executable's memory index with one literal query argument."""

    root: Path
    query: str
    limit: int | None = None
    executable: Path | None = None
    timeout: float | None = None
    spawn: Spawn | None = None


@dataclass(frozen=True)
class Upheld:
    """The executable upheld the covenant, possibly with advisories."""

    advisories: str


@dataclass(frozen=True)
class Blocked:
    """The covenant command returned its blocking exit status."""

    reason: str


@dataclass(frozen=True)
class Unjudged:
    """No covenant verdict was available."""

    reason: str


@dataclass(frozen=True)
class Ingested:
    """The memory ingest command succeeded."""


@dataclass(frozen=True)
class Unavailable:
    """The memory command or its response could not be consumed."""

    reason: str


@dataclass(frozen=True)
class Found:
    """Nonempty search hits in the executable's ranking order."""

    hits: tuple[MemorySearchResult, ...]


@dataclass(frozen=True)
class Empty:
    """A valid successful search returned no hits."""


type CheckCovenantVerdict = Upheld | Blocked | Unjudged
type MemoryIngestOutcome = Ingested | Unavailable
type MemorySearchOutcome = Found | Empty | Unavailable
