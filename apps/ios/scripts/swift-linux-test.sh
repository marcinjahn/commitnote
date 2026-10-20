#!/bin/sh
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)

for package in "$ROOT"/apps/ios/Packages/*/; do
  name=$(basename "$package")
  [ -f "$package/Package.swift" ] || continue
  [ "$name" = "CoreRuntime" ] && continue
  echo "==> swift test: $name"
  docker run --rm --cpus 4 --memory 6g \
    -v "$ROOT:$ROOT" -w "$ROOT/apps/ios/Packages/$name" \
    swift:6.2 swift test --scratch-path .build-linux
done
