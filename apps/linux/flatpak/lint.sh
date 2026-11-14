#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <manifest> <builddir> <repo>" >&2
  exit 2
fi

manifest=$1
builddir=$2
repo=$3

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exceptions="$script_dir/lint-exceptions.json"
app_id=$(sed -n 's/^name=//p' "$builddir/metadata" | head -n 1)

failed=
lint() {
  echo "flatpak-builder-lint $1"
  if ! flatpak-builder-lint --exceptions --user-exceptions "$exceptions" "$1" "$2"; then
    failed="$failed $1"
  fi
}

lint manifest "$manifest"
lint appstream "$builddir/files/share/metainfo/$app_id.metainfo.xml"
lint builddir "$builddir"
lint repo "$repo"

if [ -n "$failed" ]; then
  echo "flatpak-builder-lint failed in:$failed" >&2
  exit 1
fi
