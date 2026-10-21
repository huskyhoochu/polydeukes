"""Generate standard-library TypedDict modules from the two core wire schemas."""

import argparse
import importlib.metadata
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    if importlib.metadata.version("datamodel-code-generator") != "0.86.0":
        raise RuntimeError("datamodel-code-generator==0.86.0 is required")
    package = Path(__file__).resolve().parents[1]
    schemas = package.parents[1] / "packages/core/schema"
    output = package / "src/polydeukes_sdk"
    with tempfile.TemporaryDirectory() as temporary:
        for schema, module in (
            ("covenant-input.schema.json", "ir.py"),
            ("memory-search-output.schema.json", "memory.py"),
        ):
            source = schemas / schema
            if not source.is_file():
                raise FileNotFoundError(source)
            generated = Path(temporary) / module
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "datamodel_code_generator",
                    "--input",
                    str(source),
                    "--output",
                    str(generated),
                    "--input-file-type",
                    "jsonschema",
                    "--output-model-type",
                    "typing.TypedDict",
                    "--target-python-version",
                    "3.12",
                    "--use-standard-collections",
                    "--use-union-operator",
                    "--no-use-closed-typed-dict",
                    "--use-tag-as-union-variant-name",
                    "--formatters",
                    "builtin",
                    "--disable-timestamp",
                ],
                check=True,
            )
            target = output / module
            if options.check:
                if not target.is_file() or target.read_bytes() != generated.read_bytes():
                    print(f"Generated types differ: {target}", file=sys.stderr)
                    return 1
            else:
                target.write_bytes(generated.read_bytes())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
