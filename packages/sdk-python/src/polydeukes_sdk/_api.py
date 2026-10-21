"""Four synchronous process clients for the pdks executable."""

import json
import os
from typing import cast

from ._contract import (
    Blocked,
    CheckChangeSetSpec,
    CheckCovenantSpec,
    CheckCovenantVerdict,
    Empty,
    Found,
    Ingested,
    MemoryIngestOutcome,
    MemoryIngestSpec,
    MemorySearchOutcome,
    MemorySearchSpec,
    SpawnOutcome,
    Unavailable,
    Unjudged,
    Upheld,
)
from ._process import run
from .memory import MemorySearchResult


def _reason(error: Exception) -> str:
    return str(error) or type(error).__name__


def _failure(outcome: SpawnOutcome) -> str:
    return outcome.stderr.decode("utf-8", errors="replace") or (
        f"pdks exited with status {outcome.status}"
    )


def _check(spec: CheckCovenantSpec | CheckChangeSetSpec) -> CheckCovenantVerdict:
    try:
        args = ("covenant", "check")
        if isinstance(spec, CheckChangeSetSpec):
            args += ("--diff",)
            stdin = spec.diff.encode("utf-8")
        else:
            stdin = json.dumps(spec.input, ensure_ascii=False, allow_nan=False).encode("utf-8")
        args += ("--enforce", spec.enforce)
        if spec.config_layer is not None:
            args += ("--config-layer", os.fspath(spec.config_layer))
        if spec.telemetry_path is not None:
            args += ("--telemetry-path", os.fspath(spec.telemetry_path))
        outcome = run(spec.repo_root, spec.executable, spec.timeout, spec.spawn, args, stdin)
        if outcome.status == 0:
            return Upheld(outcome.stderr.decode("utf-8"))
        if outcome.status == 2:
            return Blocked(outcome.stderr.decode("utf-8"))
        return Unjudged(_failure(outcome))
    except Exception as error:
        return Unjudged(_reason(error))


def check_covenant(spec: CheckCovenantSpec) -> CheckCovenantVerdict:
    """Check caller-provided IR; only Upheld authorizes the proposed action."""
    return _check(spec)


def check_change_set(spec: CheckChangeSetSpec) -> CheckCovenantVerdict:
    """Check a unified diff without changing its content or line endings."""
    return _check(spec)


def memory_ingest(spec: MemoryIngestSpec) -> MemoryIngestOutcome:
    """Ingest through pdks, returning Unavailable for every process failure."""
    try:
        outcome = run(
            spec.root, spec.executable, spec.timeout, spec.spawn, ("memory", "ingest"), b""
        )
        return Ingested() if outcome.status == 0 else Unavailable(_failure(outcome))
    except Exception as error:
        return Unavailable(_reason(error))


def _invalid_constant(value: str) -> object:
    raise ValueError(f"Invalid JSON constant: {value}")


def _hits(data: bytes) -> tuple[MemorySearchResult, ...]:
    payload: object = json.loads(data.decode("utf-8"), parse_constant=_invalid_constant)
    if not isinstance(payload, dict):
        raise ValueError("memory search response must be an object")
    root = cast(dict[str, object], payload)
    results = root.get("results")
    if not isinstance(root.get("ingestedAt"), str) or not isinstance(results, list):
        raise ValueError("memory search response requires ingestedAt and results")
    for value in cast(list[object], results):
        if not isinstance(value, dict):
            raise ValueError("memory search hit must be an object")
        hit = cast(dict[str, object], value)
        if not all(
            isinstance(hit.get(field), str)
            for field in ("id", "conceptId", "docTitle", "sectionTitle", "status")
        ):
            raise ValueError("memory search hit requires string identity and status fields")
        if hit.get("trust") not in ("human-reviewed", "machine-verified", "unverified"):
            raise ValueError("memory search hit has invalid trust")
        if hit.get("matchPath") not in ("and", "or", "like"):
            raise ValueError("memory search hit has invalid matchPath")
        superseded = hit.get("supersededBy")
        if (
            not isinstance(hit.get("stale"), bool)
            or not isinstance(superseded, list)
            or not all(isinstance(item, str) for item in cast(list[object], superseded))
        ):
            raise ValueError("memory search hit requires stale and supersededBy")
    return tuple(cast(list[MemorySearchResult], results))


def memory_search(spec: MemorySearchSpec) -> MemorySearchOutcome:
    """Return ranked hits, a valid empty search, or an unavailable response."""
    try:
        args = ("memory", "search", spec.query, "--json")
        if spec.limit is not None:
            if type(spec.limit) is not int or spec.limit <= 0:
                raise ValueError("limit must be a positive integer")
            args += ("--limit", str(spec.limit))
        outcome = run(spec.root, spec.executable, spec.timeout, spec.spawn, args, b"")
        if outcome.status != 0:
            return Unavailable(_failure(outcome))
        hits = _hits(outcome.stdout)
        return Found(hits) if hits else Empty()
    except Exception as error:
        return Unavailable(_reason(error))
