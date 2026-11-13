#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
linux_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
tests_dir=$linux_dir/flatpak/tests

image_hash=$(sha256sum <"$tests_dir/Dockerfile" | cut -c1-12)
image="commitnote-flatpak-test:$image_hash"

usage() {
  echo "usage: $0 [--print-image-tag | --write-context <dir> | <name> <bundle>... -- <command...>]" >&2
  exit 2
}

case "${1:-}" in
  --print-image-tag)
    echo "$image"
    exit 0
    ;;
  --write-context)
    [ "$#" -eq 2 ] || usage
    mkdir -p "$2"
    cp "$tests_dir/Dockerfile" "$2/"
    exit 0
    ;;
esac

[ "$#" -ge 1 ] || usage
name=$1
shift
case "$name" in
  "" | .* | *[!A-Za-z0-9._-]*)
    echo "the run name must be a plain directory name, got '$name'" >&2
    exit 2
    ;;
esac

if ! docker image inspect "$image" >/dev/null 2>&1; then
  context_dir=$(mktemp -d)
  cp "$tests_dir/Dockerfile" "$context_dir/"
  build_status=0
  docker build -t "$image" "$context_dir" || build_status=$?
  rm -rf "$context_dir"
  [ "$build_status" -eq 0 ] || exit "$build_status"
fi

# A bundle may already live in the run directory from an earlier run, so the bundles are staged
# next to the run directory before that directory is recreated.
runs_dir=$linux_dir/out/flatpak
run_dir=$runs_dir/$name
mkdir -p "$runs_dir"
staging_dir=$(mktemp -d "$runs_dir/.staging.XXXXXX")
chmod 0755 "$staging_dir"
bundles=0
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do
  if [ ! -f "$1" ]; then
    echo "no Flatpak bundle at $1" >&2
    rm -rf "$staging_dir"
    exit 2
  fi
  if [ -e "$staging_dir/$(basename -- "$1")" ]; then
    echo "two bundles are named $(basename -- "$1")" >&2
    rm -rf "$staging_dir"
    exit 2
  fi
  cp "$1" "$staging_dir/"
  bundles=$((bundles + 1))
  shift
done
if [ "$bundles" -eq 0 ] || [ "$#" -lt 2 ]; then
  rm -rf "$staging_dir"
  usage
fi
shift
rm -rf "$run_dir"
mkdir "$run_dir"
mv "$staging_dir" "$run_dir/input"

# Privileged, so Flatpak can create its bubblewrap sandbox and the document portal its FUSE mount.
exec docker run --rm --init --privileged \
  --cpus "${COMMITNOTE_DOCKER_CPUS:-4}" \
  --memory "${COMMITNOTE_DOCKER_MEMORY:-8g}" \
  -v "$tests_dir:/tests:ro" \
  -v "$run_dir:/out" \
  "$image" \
  /tests/run-as-tester.sh "$@"
