#!/bin/sh
set -eu

tools_url=https://github.com/flatpak/flatpak-builder-tools
tools_commit=9d86d336a39b9af38b86f114b6ce5820fe260f91

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
output_dir="$script_dir/generated"

tools_dir=$(mktemp -d)
trap 'rm -rf "$tools_dir"' EXIT

git -C "$tools_dir" init --quiet
git -C "$tools_dir" fetch --quiet --depth 1 "$tools_url" "$tools_commit"
git -C "$tools_dir" checkout --quiet --detach FETCH_HEAD
fetched_commit=$(git -C "$tools_dir" rev-parse HEAD)
if [ "$fetched_commit" != "$tools_commit" ]; then
  echo "fetched flatpak-builder-tools $fetched_commit, expected $tools_commit" >&2
  exit 1
fi

mkdir -p "$output_dir"

python3 "$tools_dir/cargo/flatpak-cargo-generator.py" \
  "$repo_root/apps/linux/Cargo.lock" \
  -o "$output_dir/cargo-sources.json"

PYTHONPATH="$tools_dir/node${PYTHONPATH:+:$PYTHONPATH}" python3 -m flatpak_node_generator \
  npm "$repo_root/package-lock.json" \
  -o "$output_dir/node-sources.json" \
  --no-playwright-browsers
