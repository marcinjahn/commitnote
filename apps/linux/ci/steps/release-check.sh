#!/bin/sh
set -eu

if [ -d target/meson/release ]; then
  meson setup --reconfigure target/meson/release -Dprofile=release
else
  meson setup target/meson/release -Dprofile=release
fi
meson compile -C target/meson/release

binary=target/meson/release/commitnote
gresource_file=target/meson/release/data/resources.gresource
core_path=/io/github/marcinjahn/commitnote/core/commitnote-core.js

fake_names=$(sed -n '/^export const FAKE_CORE_COMMAND_NAMES = \[/,/^\]/p' /src/src/native-core/api.ts | grep -o '"fake\.[A-Za-z0-9_]*"' | tr -d '"')
name_count=$(printf '%s\n' "$fake_names" | grep -c .)
if [ "$name_count" -lt 10 ]; then
  echo "found only $name_count fake command names" >&2
  exit 1
fi

for name in $fake_names; do
  if grep -a -F -q "$name" "$binary"; then
    echo "release binary contains fake command $name" >&2
    exit 1
  fi
done

extracted=$(mktemp)
trap 'rm -f "$extracted"' EXIT
gresource extract "$gresource_file" "$core_path" > "$extracted"

if ! cmp -s "$extracted" /src/dist-native-core/commitnote-core.js; then
  echo "release bundle differs from dist-native-core" >&2
  exit 1
fi

if cmp -s "$extracted" /src/dist-native-core-fake/commitnote-core.js; then
  echo "production and fake core bundles are identical" >&2
  exit 1
fi

if ! meson introspect --buildoptions target/meson/release \
  | python3 -c 'import json, sys; sys.exit(0 if any(o["name"] == "testing" and o["value"] is False for o in json.load(sys.stdin)) else 1)'; then
  echo "release build has testing enabled" >&2
  exit 1
fi

echo "release check passed"
