#!/bin/sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <release bundle> [<testing bundle>]" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
linux_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

set -- "$@" -- /tests/smoke.sh "/out/input/$(basename -- "$1")" ${2:+"/out/input/$(basename -- "$2")"}
"$script_dir/flatpak-test-container.sh" smoke "$@"
echo "$linux_dir/out/flatpak/smoke"
