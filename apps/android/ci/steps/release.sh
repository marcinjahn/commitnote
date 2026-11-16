#!/bin/sh
set -eu

if [ -n "${COMMITNOTE_ANDROID_KEYSTORE:-}" ] &&
  [ -n "${COMMITNOTE_ANDROID_KEYSTORE_PASSWORD:-}" ] &&
  [ -n "${COMMITNOTE_ANDROID_KEY_ALIAS:-}" ] &&
  [ -n "${COMMITNOTE_ANDROID_KEY_PASSWORD:-}" ]; then
  signed=true
else
  signed=false
fi

if [ "$signed" = true ]; then
  ./gradlew :app:assembleRelease :app:bundleRelease
else
  ./gradlew :app:assembleRelease
fi

rm -rf /src/apps/android/out/release
mkdir -p /src/apps/android/out/release

apk_dir=app/build/outputs/apk/release
if [ "$signed" = true ]; then
  suffix=
else
  suffix=-debugsigned
fi

for abi in arm64-v8a x86_64; do
  cp "$apk_dir/app-$abi-release.apk" "out/release/commitnote-android-$abi$suffix.apk"
done
if [ "$signed" = true ]; then
  cp app/build/outputs/bundle/release/app-release.aab out/release/commitnote-android.aab
fi

apksigner=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner)
for apk in out/release/*.apk; do
  "$apksigner" verify "$apk"
done

ls -l out/release
