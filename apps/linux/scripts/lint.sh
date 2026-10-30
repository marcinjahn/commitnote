#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$script_dir/container.sh" ci/steps/lint.sh
cd "$script_dir/../../.."
npx tsx apps/linux/markdown-vectors/generate.ts --check
