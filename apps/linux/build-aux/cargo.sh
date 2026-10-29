#!/bin/sh
set -eu

if [ "$#" -lt 4 ]; then
  echo "usage: $0 <build|test|ui|clippy> <meson build root> <meson source root> <output> [ui test args...]" >&2
  exit 2
fi

mode=$1
build_root=$2
source_root=$3
output=$4
shift 4

: "${COMMITNOTE_APP_ID:?}" "${COMMITNOTE_PROFILE:?}" "${COMMITNOTE_VERSION:?}"
export COMMITNOTE_APP_ID COMMITNOTE_PROFILE COMMITNOTE_VERSION
export COMMITNOTE_RESOURCES="$build_root/data/resources.gresource"

target_subdir=debug
release_flag=
if [ "$COMMITNOTE_PROFILE" = release ]; then
  release_flag=--release
  target_subdir=release
fi
features_flag=
if [ "${COMMITNOTE_TESTING:-false}" = true ]; then
  features_flag="--features=testing"
fi

cargo_run() {
  subcommand=$1
  shift
  # shellcheck disable=SC2086
  cargo "$subcommand" --locked --manifest-path "$source_root/Cargo.toml" \
    --target-dir "$source_root/target" -p commitnote $release_flag $features_flag "$@"
}

case "$mode" in
build)
  cargo_run build
  cp "$source_root/target/$target_subdir/commitnote" "$output"
  ;;
test)
  cargo_run test --lib --bins
  ;;
ui)
  features_flag="--features=testing"
  cargo_run test --test ui -- "$@"
  ;;
clippy)
  cargo_run clippy --all-targets -- -D warnings
  ;;
*)
  echo "unknown mode: $mode" >&2
  exit 2
  ;;
esac
