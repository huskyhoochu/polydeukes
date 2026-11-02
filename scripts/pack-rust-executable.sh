#!/bin/sh
# Packs one built Rust executable for a GitHub Release:
#   pack-rust-executable.sh <name> <target> <version> <binary> <out-dir>
# writes <out-dir>/<name>-<target>-v<version>.tar.gz, holding one directory of the same name with
# the executable and its license files. The file name and layout are the first defaults
# `cargo binstall` tries, so a crate whose `repository` is this repository needs no
# `[package.metadata.binstall]` table.
set -eu

name=$1
target=$2
version=$3
binary=$4
out=$5

root=$(cd "$(dirname "$0")/.." && pwd)
stem="$name-$target-v$version"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir "$work/$stem"
cp "$binary" "$work/$stem/$name"
chmod 755 "$work/$stem/$name"
cp "$root/LICENSE" "$work/$stem/"
if [ "$name" = pdks-memory ]; then
  # The embedded analyzer model and dictionary carry their own licenses.
  cp "$root/packages/pdks-memory/models/GARU-LICENSE" "$root/packages/pdks-memory/models/EN-KO-LICENSE" "$work/$stem/"
fi

# Entries are owned by root, so an archive unpacked by root does not hand the files to whichever
# local account has the build runner's uid. macOS tar also needs COPYFILE_DISABLE and --no-xattrs,
# or it adds AppleDouble `._` entries and extended-attribute headers GNU tar warns about.
if tar --version | grep -q 'GNU tar'; then
  owner="--owner=0 --group=0 --numeric-owner"
else
  owner="--uid 0 --gid 0 --uname root --gname wheel"
fi
mkdir -p "$out"
# shellcheck disable=SC2086 # $owner is a list of flags.
COPYFILE_DISABLE=1 tar $owner --no-xattrs -czf "$out/$stem.tar.gz" -C "$work" "$stem"
