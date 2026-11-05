#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
workspace_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)

rm -rf "$workspace_root/apps/linux/out/read-back"
mkdir -p "$workspace_root/apps/linux/out/read-back"

"$script_dir/container.sh" ci/steps/test.sh

cd "$workspace_root"
npx tsx scripts/read-back-native-repo.ts apps/linux/out/read-back
