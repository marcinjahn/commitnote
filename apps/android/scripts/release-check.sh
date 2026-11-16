#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$script_dir/release.sh"
exec "$script_dir/container.sh" ci/steps/release-check.sh
