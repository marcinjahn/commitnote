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

for marker in "fake.saveNote" "fake.processImage" "sample/large-tree" "sample notes repo passphrase" "fake.importArchive" "sample-import.zip" "Imported plan"; do
  if grep -qF "$marker" "$CORE"; then
    fail "core bundle contains fake core bundle marker: $marker"
  fi
done

for marker in "fake.saveNote" "fake.remoteEdit" "fake.failNext" "fake.shareNote" "fake.holdLoading" "fake.processImage" "testing-menu" "testing-share-note" "testing-share-permission" "testing-loading-bar" "testing-select-word" "testing-caret-end" "testing-undo" "testing-import-archive" "fake.importArchive" "sample-import.zip" "Imported plan" "unanswered for" "Core queue has not run"; do
  if grep -rlF "$marker" "$APP" | grep -q .; then
    fail "app contains $marker"
  fi
done

[ -z "$(find "$APP" -name embedded.mobileprovision)" ] || fail "app contains embedded.mobileprovision"
[ -z "$(find "$APP" -name '*.entitlements')" ] || fail "app contains an entitlements file"

PLIST="$APP/Info.plist"
[ -f "$PLIST" ] || fail "Info.plist is missing"
PLIST_JSON="$DIR/Info.json"
plutil -convert json -o "$PLIST_JSON" "$PLIST" || fail "Info.plist is unreadable"
if grep -qF "NSFaceIDUsageDescription" "$PLIST_JSON"; then
  fail "Info.plist contains NSFaceIDUsageDescription"
fi

FONT_COUNT=0
FONTS=$(plutil -extract UIAppFonts json -o - "$PLIST" | tr -d '[]"' | tr ',' '\n')
while IFS= read -r font; do
  [ -n "$font" ] || continue
  [ -f "$APP/$font" ] || fail "bundled font is missing: $font"
  FONT_COUNT=$((FONT_COUNT + 1))
done <<EOF
$FONTS
EOF
[ "$FONT_COUNT" -gt 0 ] || fail "Info.plist lists no UIAppFonts"
echo "check-ipa: $FONT_COUNT fonts checked"

echo "check-ipa: ok"
