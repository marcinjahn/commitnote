#!/bin/sh
set -eu

cd "$(dirname -- "$0")/../../.."

app_id=io.github.marcinjahn.commitnote
manifest=apps/linux/flatpak/$app_id.yml
state_dir=/state/flatpak-builder
build_dir=/state/build
repo_dir=/state/repo
bundle=apps/linux/out/flatpak/commitnote-x86_64.flatpak

apps/linux/flatpak/generate-sources.sh

flatpak-builder \
  --repo="$repo_dir" \
  --disable-rofiles-fuse \
  --install-deps-from=flathub \
  --force-clean \
  --default-branch=master \
  --arch=x86_64 \
  --state-dir "$state_dir" \
  "$build_dir" \
  "$manifest"

apps/linux/flatpak/lint.sh "$manifest" "$build_dir" "$repo_dir"

mkdir -p "$(dirname "$bundle")"
flatpak build-bundle "$repo_dir" "$bundle" \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo \
  --arch=x86_64 \
  "$app_id" master
