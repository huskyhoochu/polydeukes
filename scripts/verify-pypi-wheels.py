# Installs the wheels pack-pypi-wheels.py built for this platform into a fresh venv and runs them:
#   python3 -I scripts/verify-pypi-wheels.py <wheels-dir>
# The judge alone installs one executable and registers no hook; each extension adds its own.
import json
import os
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

TAGS = {
    ("darwin", "arm64"): "macosx_11_0_arm64",
    ("linux", "x86_64"): "x86_64",
    ("linux", "aarch64"): "aarch64",
}


def run(args, cwd, expect=0, stdin=None, env=None):
    result = subprocess.run(
        args,
        check=False,
        cwd=cwd,
        input=stdin,
        capture_output=True,
        text=True,
        env=env or os.environ,
    )
    if result.returncode != expect:
        sys.exit(
            f"{' '.join(map(str, args))} exited {result.returncode}, expected {expect}\n"
            f"{result.stdout}{result.stderr}"
        )
    return result.stdout


def hooks_of(file):
    groups = json.loads(file.read_text())["hooks"].values()
    return [hook for group in groups for entry in group for hook in entry["hooks"]]


def write_ir(path):
    return json.dumps(
        {
            "toolCalls": [
                {
                    "name": "session-write",
                    "args": {"file_path": path, "content": "x\n"},
                    "fileChange": {"kind": "create", "path": path, "post": "x\n"},
                }
            ],
            "subagentSpawns": [],
            "userMessages": [],
            "tools": {"mutating": ["session-write"], "shell": [], "commandArgs": []},
        }
    )


def claude_write(cwd):
    return json.dumps(
        {
            "hook_event_name": "PreToolUse",
            "session_id": "s-1",
            "cwd": str(cwd),
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(cwd / "polydeukes.config.yaml"),
                "content": "x\n",
            },
        }
    )


def codex_remove(cwd):
    return json.dumps(
        {
            "session_id": "s-1",
            "turn_id": "t-1",
            "transcript_path": None,
            "cwd": str(cwd),
            "hook_event_name": "PreToolUse",
            "model": "gpt-5",
            "permission_mode": "default",
            "tool_name": "Bash",
            "tool_use_id": "call-1",
            "tool_input": {"command": "rm polydeukes.config.yaml"},
        }
    )


def main():
    if len(sys.argv) != 2 or not Path(sys.argv[1]).is_dir():
        sys.exit("usage: verify-pypi-wheels.py <wheels-dir>")
    tag = TAGS.get((sys.platform, platform.machine()))
    if not tag:
        sys.exit(f"no wheel for {sys.platform} {platform.machine()}")
    wheels = {}
    for file in Path(sys.argv[1]).resolve().glob("*.whl"):
        if tag in file.name:
            wheels[file.name.split("-")[0]] = file
    names = [
        "polydeukes",
        "polydeukes_claude_code",
        "polydeukes_codex",
        "polydeukes_memory",
    ]
    if sorted(wheels) != names:
        sys.exit(
            f"expected one {tag} wheel for each of {names}, found {sorted(wheels)}"
        )
    version = wheels["polydeukes"].name.split("-")[1]

    with tempfile.TemporaryDirectory(prefix="pdks-pypi-verify-") as scratch:
        # The real path: macOS's tmpdir is a link, and init registers resolved paths.
        scratch = Path(scratch).resolve()
        venv, repo = scratch / "venv", scratch / "repo"
        bin_dir = venv / "bin"
        run([sys.executable, "-m", "venv", venv], scratch)
        repo.mkdir()
        run(["git", "init", "-q"], repo)
        # Only the venv's bin and the system directories: no Node, no other pdks install.
        env = {**os.environ, "PATH": f"{bin_dir}:/usr/bin:/bin"}
        bare = {**os.environ, "PATH": "/usr/bin:/bin"}

        def install(name):
            run([bin_dir / "pip", "install", "-q", "--no-index", wheels[name]], scratch)

        # The judge alone: one executable, no host registration.
        install("polydeukes")
        installed = sorted(
            p.name for p in bin_dir.iterdir() if p.name.startswith("pdks")
        )
        if installed != ["pdks"]:
            sys.exit(f"polydeukes installed {installed}")
        if not os.access(bin_dir / "pdks", os.X_OK):
            sys.exit("pdks is not executable")
        if run(["pdks", "--version"], repo, env=env).strip() != f"pdks {version}":
            sys.exit("pdks --version does not name the wheel version")
        run(["pdks", "init"], repo, env=env)
        for host in [".claude", ".codex"]:
            if (repo / host).exists():
                sys.exit(f"pdks init wrote {host}")
        run(["pdks", "covenant", "check"], repo, stdin=write_ir("notes.txt"), env=env)
        run(
            ["pdks", "covenant", "check", "--enforce", "block"],
            repo,
            expect=2,
            stdin=write_ir("polydeukes.config.yaml"),
            env=env,
        )

        # Each adapter's init registers the venv's bin paths, which keep across an upgrade, and
        # the registered command blocks a protected write.
        install("polydeukes_claude_code")
        run(["pdks-claude-code", "init"], repo, env=env)
        hooks = hooks_of(repo / ".claude" / "settings.json")
        if not hooks:
            sys.exit("pdks-claude-code init registered no hook")
        for hook in hooks:
            if hook["command"] != str(bin_dir / "pdks-claude-code"):
                sys.exit(f"pdks-claude-code registered {hook['command']}")
            if hook["args"][hook["args"].index("--pdks") + 1] != str(bin_dir / "pdks"):
                sys.exit(f"pdks-claude-code registered --pdks {hook['args']}")
        run([hooks[0]["command"], *hooks[0]["args"]], repo, 2, claude_write(repo), bare)

        install("polydeukes_codex")
        run(["pdks-codex", "init"], repo, env=env)
        words = [
            bin_dir / "pdks-codex",
            "hook",
            "--project-root",
            repo,
            "--pdks",
            bin_dir / "pdks",
        ]
        quoted = " ".join(f"'{word}'" for word in words)
        codex_hooks = hooks_of(repo / ".codex" / "hooks.json")
        if not codex_hooks:
            sys.exit("pdks-codex init registered no hook")
        for hook in codex_hooks:
            if hook["command"] != quoted:
                sys.exit(f"pdks-codex registered {hook['command']}")
        run(["sh", "-c", quoted], repo, 2, codex_remove(repo), bare)

        # `pdks memory` finds pdks-memory on PATH.
        install("polydeukes_memory")
        (repo / "docs").mkdir()
        (repo / "docs" / "release.md").write_text(
            "# Release steps\n\nTag the commit, then publish.\n"
        )
        with (repo / "polydeukes.config.yaml").open("a") as config:
            config.write("\nmemory:\n  include:\n    - 'docs/**/*.md'\n")
        found = json.loads(
            run(["pdks", "memory", "search", "publish", "--json"], repo, env=env)
        )
        if (
            not found["results"]
            or found["results"][0].get("conceptId") != "docs/release"
        ):
            sys.exit(f"memory search missed the document: {found}")

    print(f"verify-pypi-wheels: {tag} {version} ok")


main()
