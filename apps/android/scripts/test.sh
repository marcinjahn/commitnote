#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
workspace_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)

rm -rf "$workspace_root/apps/android/out/read-back"
mkdir -p "$workspace_root/apps/android/out/read-back"

"$script_dir/container.sh" ./gradlew test

cd "$workspace_root"
npx tsx scripts/read-back-native-repo.ts apps/android/out/read-back
