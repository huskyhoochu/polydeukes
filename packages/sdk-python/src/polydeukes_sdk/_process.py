"""Executable resolution and binary process transport shared by all verbs."""

import math
import os
import subprocess

from ._contract import Path, Spawn, SpawnOutcome, SpawnSpec


def _absolute(path: Path, cwd: str) -> str:
    return os.path.normpath(os.path.join(cwd, os.fspath(path)))


def _resolve(executable: Path | None, cwd: str) -> str:
    if executable is not None:
        return _absolute(executable, cwd)
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        if os.path.isabs(directory):
            candidate = os.path.join(directory, "pdks")
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    raise FileNotFoundError("No executable pdks found in absolute PATH directories")


def _spawn(spec: SpawnSpec) -> SpawnOutcome:
    child = subprocess.Popen(
        (spec.command, *spec.args),
        cwd=spec.cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        close_fds=True,
    )
    try:
        stdout, stderr = child.communicate(spec.stdin, timeout=spec.timeout)
    except BaseException:
        child.kill()
        child.wait()
        # A surviving descendant can keep these pipes open after the direct child exits.
        for stream in (child.stdin, child.stdout, child.stderr):
            if stream is not None:
                stream.close()
        raise
    return SpawnOutcome(
        status=child.returncode if child.returncode >= 0 else None,
        stdout=stdout,
        stderr=stderr,
    )


def run(
    root: Path,
    executable: Path | None,
    timeout: float | None,
    spawn: Spawn | None,
    args: tuple[str, ...],
    stdin: bytes,
) -> SpawnOutcome:
    if timeout is not None and (not math.isfinite(timeout) or timeout < 0):
        raise ValueError("timeout must be finite and nonnegative")
    cwd = os.getcwd()
    return (spawn or _spawn)(
        SpawnSpec(
            command=_resolve(executable, cwd),
            args=args,
            cwd=_absolute(root, cwd),
            stdin=stdin,
            timeout=timeout,
        )
    )
