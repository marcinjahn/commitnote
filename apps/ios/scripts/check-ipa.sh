#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: check-ipa.sh <ipa>" >&2
  exit 2
fi

IPA=$1
DIR=$(mktemp -d)
unzip -q "$IPA" -d "$DIR"
APP="$DIR/Payload/commitnote.app"
CORE="$APP/commitnote-core.js"

fail() {
  echo "check-ipa: $1" >&2
  exit 1
}

[ -d "$APP" ] || fail "Payload/commitnote.app is missing"
[ -f "$CORE" ] || fail "commitnote-core.js is missing"
grep -q "commitnote-native-core" "$CORE" || fail "core bundle is not the production one"

for marker in "fake.saveNote" "sample/large-tree" "sample notes repo passphrase"; do
  if grep -qF "$marker" "$CORE"; then
    fail "core bundle contains fake core bundle marker: $marker"
  fi
done

if grep -rlF "fake.saveNote" "$APP" | grep -q .; then
  fail "app contains fake.saveNote"
fi

[ -z "$(find "$APP" -name embedded.mobileprovision)" ] || fail "app contains embedded.mobileprovision"
[ -z "$(find "$APP" -name '*.entitlements')" ] || fail "app contains an entitlements file"

echo "check-ipa: ok"
