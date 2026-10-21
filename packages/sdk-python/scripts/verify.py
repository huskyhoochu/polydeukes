"""Check types, generated artifacts, and isolated Python distributions."""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
ROOT = PACKAGE.parents[1]


def run(*args: str, success: bool = True, **kwargs):
    result = subprocess.run(args, cwd=ROOT, check=False, **kwargs)
    if (result.returncode == 0) != success:
        raise SystemExit(f"Unexpected exit {result.returncode}: {args}")
    return result


def check_types():
    pyright = str(PACKAGE / ".venv/bin/pyright")
    run(pyright, "--project", str(PACKAGE / "pyproject.toml"))
    result = run(
        pyright,
        "--project",
        str(PACKAGE / "pyproject.toml"),
        str(PACKAGE / "tests/typing/invalid.py"),
        "--outputjson",
        success=False,
        capture_output=True,
        text=True,
    )
    diagnostics = json.loads(result.stdout)["generalDiagnostics"]
    lines = (PACKAGE / "tests/typing/invalid.py").read_text().splitlines()
    for marker in ("wrong_kind:", "missing_post:", "assert_never(verdict)"):
        start = next(i for i, line in enumerate(lines) if marker in line)
        end = start + (5 if marker != "assert_never(verdict)" else 1)
        assert any(
            d["severity"] == "error" and start <= d["range"]["start"]["line"] < end
            for d in diagnostics
        ), (marker, diagnostics)
    print("All three intended negative type diagnostics detected", flush=True)


def check_generation():
    script = PACKAGE / "scripts/generate_types.py"
    run(sys.executable, str(script), "--check")
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        package = root / "packages/sdk-python"
        shutil.copytree(PACKAGE / "src", package / "src")
        shutil.copytree(PACKAGE / "scripts", package / "scripts")
        schemas = root / "packages/core/schema"
        shutil.copytree(ROOT / "packages/core/schema", schemas)
        copied_script = str(package / "scripts/generate_types.py")
        run(sys.executable, copied_script, "--check")
        generated = package / "src/polydeukes_sdk/ir.py"
        original = generated.read_text()
        generated.write_text(original + "\n# drift\n")
        run(sys.executable, copied_script, "--check", success=False)
        generated.write_text(original)
        schema = schemas / "covenant-input.schema.json"
        value = json.loads(schema.read_text())
        value["required"].remove("toolCalls")
        schema.write_text(json.dumps(value))
        run(sys.executable, copied_script, "--check", success=False)
        schema.unlink()
        run(sys.executable, copied_script, "--check", success=False)
    print("Generated output and schema mutations both rejected", flush=True)


def check_distributions(executable: str, interpreters: list[str]):
    with tempfile.TemporaryDirectory() as directory:
        temporary = Path(directory)
        artifacts = temporary / "dist"
        run("uv", "build", "--project", str(PACKAGE), "--out-dir", str(artifacts))
        wheel = next(artifacts.glob("*.whl"))
        with zipfile.ZipFile(wheel) as archive:
            metadata = archive.read(
                next(n for n in archive.namelist() if n.endswith("/METADATA"))
            ).decode()
            assert "Requires-Dist:" not in metadata
            assert "polydeukes_sdk/py.typed" in archive.namelist()
        for artifact, interpreter in (
            (a, p)
            for a in sorted(artifacts.iterdir())
            if a.name.endswith((".whl", ".tar.gz"))
            for p in interpreters
        ):
            environment = temporary / (
                artifact.name.replace(".", "-") + "-" + str(interpreters.index(interpreter))
            )
            run("uv", "venv", "--python", interpreter, str(environment))
            python = str(environment / "bin/python")
            run("uv", "pip", "install", "--python", python, "--no-deps", str(artifact))
            # -I removes cwd/PYTHONPATH; this check verifies the actual installed package.
            run(
                python,
                "-I",
                "-c",
                (
                    "import pathlib,polydeukes_sdk as s; "
                    f"assert pathlib.Path(s.__file__).resolve().is_relative_to(pathlib.Path({str(environment)!r}).resolve()); "
                    "assert pathlib.Path(s.__file__).with_name('py.typed').exists()"
                ),
            )
            for name in ("ir", "memory"):
                module = PACKAGE / f"src/polydeukes_sdk/{name}.py"
                run(
                    python,
                    "-I",
                    "-S",
                    "-c",
                    (
                        "import importlib.util; "
                        f"spec=importlib.util.spec_from_file_location('wire',{str(module)!r}); "
                        "spec.loader.exec_module(importlib.util.module_from_spec(spec))"
                    ),
                )
            env = {**os.environ, "PDKS_SDK_INSTALLED": "1", "PDKS_EXECUTABLE": executable}
            run(
                python,
                "-I",
                "-c",
                (
                    "import unittest,sys; "
                    f"sys.path.insert(0,{str(PACKAGE / 'tests')!r}); "
                    f"suite=unittest.defaultTestLoader.discover({str(PACKAGE / 'tests')!r}); "
                    "result=unittest.TextTestRunner(verbosity=1).run(suite); "
                    "sys.exit(not result.wasSuccessful())"
                ),
                env=env,
            )
        print("Wheel and sdist passed isolated installed SDK tests", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", required=True)
    parser.add_argument("--skip-generation", action="store_true")
    parser.add_argument("--python", action="append", dest="interpreters")
    args = parser.parse_args()
    check_types()
    if not args.skip_generation:
        check_generation()
    check_distributions(
        str(Path(args.executable).absolute()), args.interpreters or [sys.executable]
    )
