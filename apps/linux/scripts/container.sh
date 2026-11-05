#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
linux_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
workspace_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)

image_hash=$(cat \
  "$linux_dir/ci/Dockerfile" \
  "$linux_dir/ci/build-packages.txt" \
  "$linux_dir/ci/run-packages.txt" \
  "$linux_dir/ci/test-packages.txt" \
  "$linux_dir/rust-toolchain.toml" \
  | sha256sum | cut -c1-12)
image="commitnote-linux-builder:$image_hash"
workspace_hash=$(printf '%s' "$workspace_root" | sha256sum | cut -c1-12)
target_volume="commitnote-linux-target-$workspace_hash"

write_context() {
  cp "$linux_dir/ci/Dockerfile" \
    "$linux_dir/ci/build-packages.txt" \
    "$linux_dir/ci/run-packages.txt" \
    "$linux_dir/ci/test-packages.txt" \
    "$linux_dir/rust-toolchain.toml" \
    "$1/"
}

case "${1:-}" in
  --print-image-tag)
    echo "$image"
    exit 0
    ;;
  --remove-target-volume)
    exec docker volume rm "$target_volume"
    ;;
  --write-context)
    if [ "$#" -ne 2 ]; then
      echo "usage: $0 --write-context <dir>" >&2
      exit 2
    fi
    mkdir -p "$2"
    write_context "$2"
    exit 0
    ;;
esac

if [ "$#" -eq 0 ]; then
  echo "usage: $0 [--print-image-tag | --remove-target-volume | --write-context <dir> | <command...>]" >&2
  exit 2
fi

if ! docker image inspect "$image" >/dev/null 2>&1; then
  context_dir=$(mktemp -d)
  write_context "$context_dir"
  build_status=0
  docker build -t "$image" "$context_dir" || build_status=$?
  rm -rf "$context_dir"
  [ "$build_status" -eq 0 ] || exit "$build_status"
fi

if [ -n "${COMMITNOTE_LINUX_CACHE_DIR:-}" ]; then
  mkdir -p "$COMMITNOTE_LINUX_CACHE_DIR/registry" "$COMMITNOTE_LINUX_CACHE_DIR/git" "$COMMITNOTE_LINUX_CACHE_DIR/target"
  registry_mount="$COMMITNOTE_LINUX_CACHE_DIR/registry"
  git_mount="$COMMITNOTE_LINUX_CACHE_DIR/git"
  target_mount="$COMMITNOTE_LINUX_CACHE_DIR/target"
else
  registry_mount=commitnote-linux-cargo-registry
  git_mount=commitnote-linux-cargo-git
  target_mount=$target_volume
fi

tty_flags=
if [ -t 0 ] && [ -t 1 ]; then
  tty_flags=-it
fi

# shellcheck disable=SC2086
exec docker run --rm --init $tty_flags \
  -e CI \
  -e COMMITNOTE_UI_FILTER \
  --cpus "${COMMITNOTE_DOCKER_CPUS:-4}" \
  --memory "${COMMITNOTE_DOCKER_MEMORY:-8g}" \
  -v "$workspace_root:/src" \
  -v "$registry_mount:/usr/local/cargo/registry" \
  -v "$git_mount:/usr/local/cargo/git" \
  -v "$target_mount:/src/apps/linux/target" \
  -w /src/apps/linux \
  "$image" \
  "$@"
