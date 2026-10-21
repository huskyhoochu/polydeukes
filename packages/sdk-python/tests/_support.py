import json
import os
import sys
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
REPOSITORY = PACKAGE.parents[1]
if not os.environ.get("PDKS_SDK_INSTALLED"):
    sys.path.insert(0, str(PACKAGE / "src"))
FIXTURE = json.loads((REPOSITORY / "fixtures/sdk/contract.json").read_text())


def executable(directory: Path, name: str = "pdks", body: str = "pass") -> Path:
    path = directory / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"#!{sys.executable}\n{body}\n")
    path.chmod(0o755)
    return path
