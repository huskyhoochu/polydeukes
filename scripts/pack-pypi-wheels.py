# Builds the PyPI wheels from a release's Rust executable archives:
#   python3 -I scripts/pack-pypi-wheels.py <archives-dir> <version> <out-dir>
# Each wheel carries one executable for one platform under <dist>-<version>.data/scripts/, which
# installers copy into the environment's bin/. The executable is the archive's file, unchanged.
import base64
import hashlib
import re
import sys
import tarfile
import zipfile
from pathlib import Path
from typing import NoReturn

REPOSITORY = Path(__file__).resolve().parent.parent
PACKAGES = {
    "pdks": "polydeukes",
    "pdks-claude-code": "polydeukes-claude-code",
    "pdks-codex": "polydeukes-codex",
    "pdks-memory": "polydeukes-memory",
}
# The Linux executables are static musl builds, so one wheel serves glibc and musl systems.
PLATFORMS = {
    "aarch64-apple-darwin": "macosx_11_0_arm64",
    "x86_64-unknown-linux-musl": "manylinux_2_17_x86_64.manylinux2014_x86_64.musllinux_1_1_x86_64",
    "aarch64-unknown-linux-musl": "manylinux_2_17_aarch64.manylinux2014_aarch64.musllinux_1_1_aarch64",
}
# The license files each archive holds; pdks-memory adds its model's and dictionary's.
LICENSES = {"pdks-memory": ["LICENSE", "GARU-LICENSE", "EN-KO-LICENSE"]}
# A fixed timestamp makes the same archives produce byte-identical wheels.
EPOCH = (1980, 1, 1, 0, 0, 0)


def fail(message) -> NoReturn:
    print(f"pack-pypi-wheels: {message}", file=sys.stderr)
    sys.exit(1)


def field(text, key):
    match = re.search(rf'^{key} = "([^"]*)"$', text, re.MULTILINE)
    return match and match.group(1)


def digest(data):
    return base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


def wheel(crate, name, target, version, archives, out):
    archive = archives / f"{crate}-{target}-v{version}.tar.gz"
    if not archive.is_file():
        fail(f"missing archive {archive.name}")
    root = f"{crate}-{target}-v{version}"
    with tarfile.open(archive) as tar:

        def read(member):
            try:
                file = tar.extractfile(f"{root}/{member}")
            except KeyError:
                file = None
            if file is None:
                fail(f"{archive.name} has no {member}")
            return file.read()

        executable = read(crate)
        licenses = {file: read(file) for file in LICENSES.get(crate, ["LICENSE"])}

    manifest = (REPOSITORY / "packages" / crate / "Cargo.toml").read_text()
    root_manifest = (REPOSITORY / "Cargo.toml").read_text()
    license_expression = field(manifest, "license") or field(root_manifest, "license")
    dist = name.replace("-", "_")
    info = f"{dist}-{version}.dist-info"
    tag = PLATFORMS[target]
    # PyPI renders relative links against pypi.org, so they point at the tagged repository tree.
    tree = f"https://github.com/huskyhoochu/polydeukes/blob/v{version}/"
    readme = (REPOSITORY / "packages" / crate / "README.md").read_text()
    readme = readme.replace("](./", f"]({tree}packages/{crate}/").replace(
        "](../../", f"]({tree}"
    )
    metadata = "".join(
        [
            "Metadata-Version: 2.4\n",
            f"Name: {name}\n",
            f"Version: {version}\n",
            f"Summary: {field(manifest, 'description')}\n",
            f"License-Expression: {license_expression}\n",
            *(f"License-File: {file}\n" for file in licenses),
            "Project-URL: Repository, https://github.com/huskyhoochu/polydeukes\n",
            "Project-URL: Documentation, https://polydeukes.vercel.app\n",
            "Description-Content-Type: text/markdown\n",
            "\n",
            readme,
        ]
    )
    wheel_file = (
        "Wheel-Version: 1.0\nGenerator: pack-pypi-wheels\nRoot-Is-Purelib: false\n"
        + "".join(f"Tag: py3-none-{platform}\n" for platform in tag.split("."))
    )
    # Mode bits carry the regular-file type: pip keeps the executable bit only when it is there.
    files = [
        (f"{dist}-{version}.data/scripts/{crate}", executable, 0o100755),
        *(
            (f"{info}/licenses/{file}", data, 0o100644)
            for file, data in licenses.items()
        ),
        (f"{info}/METADATA", metadata.encode(), 0o100644),
        (f"{info}/WHEEL", wheel_file.encode(), 0o100644),
    ]
    record = "".join(
        f"{path},sha256={digest(data)},{len(data)}\n" for path, data, _ in files
    )
    files.append((f"{info}/RECORD", (record + f"{info}/RECORD,,\n").encode(), 0o100644))

    with zipfile.ZipFile(
        out / f"{dist}-{version}-py3-none-{tag}.whl", "w"
    ) as archive_out:
        for path, data, mode in files:
            entry = zipfile.ZipInfo(path, EPOCH)
            entry.external_attr = mode << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive_out.writestr(entry, data)


def main():
    if len(sys.argv) != 4:
        fail("usage: pack-pypi-wheels.py <archives-dir> <version> <out-dir>")
    archives, version, out = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
    # An archive outside the tables (a new target or crate) fails here rather than being skipped.
    extra = {p.name for p in archives.glob("*.tar.gz")} - {
        f"{crate}-{target}-v{version}.tar.gz"
        for crate in PACKAGES
        for target in PLATFORMS
    }
    if extra:
        fail(f"archives this script has no wheel for: {', '.join(sorted(extra))}")
    out.mkdir(parents=True, exist_ok=True)
    for crate, name in PACKAGES.items():
        for target in PLATFORMS:
            wheel(crate, name, target, version, archives, out)


main()
