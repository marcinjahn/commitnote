#!/bin/sh
set -eu

usage() {
  echo "usage: $0 [--testing]" >&2
  exit 2
}

testing=
case "${1:-}" in
  --testing)
    testing=1
    shift
    ;;
esac
[ "$#" -eq 0 ] || usage

cd "$(dirname -- "$0")/../../.."

release_app_id=io.github.marcinjahn.commitnote
state_dir=/state/flatpak-builder
repo_dir=/state/repo

if [ -n "$testing" ]; then
  app_id=$release_app_id.Devel
  build_dir=/state/build-testing
  bundle=apps/linux/out/flatpak/commitnote-testing-x86_64.flatpak
else
  app_id=$release_app_id
  build_dir=/state/build
  bundle=apps/linux/out/flatpak/commitnote-x86_64.flatpak
fi
manifest=apps/linux/flatpak/$app_id.yml

apps/linux/flatpak/generate-sources.sh

if [ -n "$testing" ]; then
  apps/linux/flatpak/testing-manifest.py
fi

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

if [ -z "$testing" ]; then
  apps/linux/flatpak/lint.sh "$manifest" "$build_dir" "$repo_dir"
fi

mkdir -p "$(dirname "$bundle")"
flatpak build-bundle "$repo_dir" "$bundle" \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo \
  --arch=x86_64 \
  "$app_id" master
