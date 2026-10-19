#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command...>" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
workspace_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
toolchain_file="$workspace_root/src-tauri/rust-toolchain.toml"

image_hash=$(cat "$script_dir/Dockerfile" "$script_dir/install-build-deps.sh" "$toolchain_file" \
  | sha256sum | cut -c1-12)
image="commitnote-appimage-builder:$image_hash"

if ! docker image inspect "$image" >/dev/null 2>&1; then
  context_dir=$(mktemp -d)
  cp "$script_dir/Dockerfile" "$script_dir/install-build-deps.sh" "$toolchain_file" "$context_dir/"
  build_status=0
  docker build -t "$image" "$context_dir" || build_status=$?
  rm -rf "$context_dir"
  [ "$build_status" -eq 0 ] || exit "$build_status"
fi

cache_root="${COMMITNOTE_APPIMAGE_CACHE_DIR:-$HOME/.cache/commitnote-appimage}"
mkdir -p "$cache_root/cargo-registry" "$cache_root/cargo-target" "$cache_root/npm" "$cache_root/xdg"

tty_flags=
if [ -t 0 ] && [ -t 1 ]; then
  tty_flags=-it
fi

# shellcheck disable=SC2086
exec docker run --rm --init $tty_flags \
  --cpus "${COMMITNOTE_DOCKER_CPUS:-4}" \
  --memory "${COMMITNOTE_DOCKER_MEMORY:-8g}" \
  -v "$workspace_root:/src" \
  -v commitnote-appimage-node-modules:/src/node_modules \
  -v "$cache_root/cargo-registry:/usr/local/cargo/registry" \
  -v "$cache_root/cargo-target:/cargo-target" \
  -v "$cache_root/npm:/npm-cache" \
  -v "$cache_root/xdg:/xdg-cache" \
  -e CARGO_TARGET_DIR=/cargo-target \
  -e npm_config_cache=/npm-cache \
  -e XDG_CACHE_HOME=/xdg-cache \
  -w /src \
  "$image" \
  sh -c 'npm ci --no-audit --no-fund && exec "$@"' sh "$@"
