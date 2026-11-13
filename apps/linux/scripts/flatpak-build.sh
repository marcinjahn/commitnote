#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
workspace_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)

image=ghcr.io/flathub-infra/flatpak-github-actions:gnome-51
sdk_volume=commitnote-flatpak-sdk
workspace_hash=$(printf '%s' "$workspace_root" | sha256sum | cut -c1-12)
state_volume="commitnote-flatpak-state-$workspace_hash"

build_args=
case "${1:-}" in
  --remove-state-volume)
    exec docker volume rm "$state_volume"
    ;;
  --testing)
    build_args=--testing
    ;;
  "")
    ;;
  *)
    echo "usage: $0 [--testing | --remove-state-volume]" >&2
    exit 2
    ;;
esac

if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker pull "$image"
fi

# flatpak-builder needs privileges to create the bubblewrap sandbox it builds in.
exec docker run --rm --init --privileged \
  --cpus "${COMMITNOTE_DOCKER_CPUS:-4}" \
  --memory "${COMMITNOTE_DOCKER_MEMORY:-8g}" \
  -v "$workspace_root:/src" \
  -v "$sdk_volume:/var/lib/flatpak" \
  -v "$state_volume:/state" \
  -w /src \
  "$image" \
  apps/linux/flatpak/build.sh $build_args
