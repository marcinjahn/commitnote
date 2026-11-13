#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <bundle>" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
linux_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

"$script_dir/flatpak-test-container.sh" "$1" launch /tests/launch.sh "/out/input/$(basename -- "$1")"
echo "$linux_dir/out/flatpak/launch/launch.png"
