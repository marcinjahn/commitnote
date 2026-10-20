#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: build-unsigned-ipa.sh <out-dir>" >&2
  exit 2
fi

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT=$1
WORK=$(mktemp -d)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

xcodebuild archive \
  -project "$ROOT/apps/ios/Commitnote.xcodeproj" \
  -scheme Commitnote \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$WORK/commitnote.xcarchive" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""

APP="$WORK/commitnote.xcarchive/Products/Applications/commitnote.app"
[ -d "$APP" ] || { echo "archive does not contain commitnote.app" >&2; exit 1; }

mkdir "$WORK/Payload"
cp -R "$APP" "$WORK/Payload/commitnote.app"
IPA="$OUT/commitnote-unsigned.ipa"
cd "$WORK"
ditto -c -k --sequesterRsrc --keepParent Payload "$IPA"
echo "built $IPA"
