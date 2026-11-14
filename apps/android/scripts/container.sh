#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
android_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
workspace_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)

image_hash=$(sha256sum "$android_dir/ci/Dockerfile" | cut -c1-12)
image="commitnote-android-builder:$image_hash"

write_context() {
  cp "$android_dir/ci/Dockerfile" "$1/"
}

case "${1:-}" in
  --print-image-tag)
    echo "$image"
    exit 0
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

network_flags=
if [ "${1:-}" = "--host-network" ]; then
  network_flags="--network host"
  shift
fi

if [ "$#" -eq 0 ]; then
  echo "usage: $0 [--print-image-tag | --write-context <dir> | [--host-network] <command...>]" >&2
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

if [ -n "${COMMITNOTE_ANDROID_CACHE_DIR:-}" ]; then
  mkdir -p "$COMMITNOTE_ANDROID_CACHE_DIR/gradle"
  gradle_mount="$COMMITNOTE_ANDROID_CACHE_DIR/gradle"
else
  gradle_mount=commitnote-android-gradle
fi

tty_flags=
if [ -t 0 ] && [ -t 1 ]; then
  tty_flags=-it
fi

# shellcheck disable=SC2086
exec docker run --rm --init $tty_flags $network_flags \
  -e CI \
  --cpus "${COMMITNOTE_DOCKER_CPUS:-4}" \
  --memory "${COMMITNOTE_DOCKER_MEMORY:-8g}" \
  -v "$workspace_root:/src" \
  -v "$gradle_mount:/gradle" \
  -w /src/apps/android \
  "$image" \
  "$@"
