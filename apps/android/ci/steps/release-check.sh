#!/bin/sh
set -eu

release_dir=/src/apps/android/out/release
production_core=/src/dist-native-core/commitnote-core.js
fake_core=/src/dist-native-core-fake/commitnote-core.js
package=io.github.marcinjahn.commitnote
expected_permissions="android.permission.ACCESS_NETWORK_STATE
android.permission.INTERNET
$package.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"

aapt2=$(find "$ANDROID_HOME/build-tools" -name aapt2 | LC_ALL=C sort | tail -n 1)

fail() {
  echo "$1" >&2
  exit 1
}

fake_names=$(sed -n '/^export const FAKE_CORE_COMMAND_NAMES = \[/,/^\]/p' /src/src/native-core/api.ts | grep -o '"fake\.[A-Za-z0-9_]*"' | tr -d '"')
name_count=$(printf '%s\n' "$fake_names" | grep -c .)
if [ "$name_count" -lt 10 ]; then
  fail "found only $name_count fake command names"
fi

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

check_core_bundle() {
  if ! cmp -s "$1" "$production_core"; then
    fail "$2: core bundle differs from dist-native-core"
  fi
  if cmp -s "$1" "$fake_core"; then
    fail "$2: core bundle is identical to the fake core bundle"
  fi
}

check_apk() {
  apk=$1
  name=$(basename "$apk")
  extracted="$work_dir/$name"
  mkdir "$extracted"
  (cd "$extracted" && jar xf "$apk")

  check_core_bundle "$extracted/assets/commitnote-core.js" "$name"

  dex_files=$(find "$extracted" -maxdepth 1 -name 'classes*.dex')
  if [ -z "$dex_files" ]; then
    fail "$name: no classes*.dex"
  fi
  for fake_name in $fake_names; do
    # shellcheck disable=SC2086
    if grep -r -a -F -q "$fake_name" $dex_files "$extracted/assets"; then
      fail "$name: contains fake command $fake_name"
    fi
  done

  manifest=$("$aapt2" dump xmltree --file AndroidManifest.xml "$apk")
  if printf '%s\n' "$manifest" | grep -q -F 'androidx.activity.ComponentActivity'; then
    fail "$name: manifest declares androidx.activity.ComponentActivity"
  fi
  if ! printf '%s\n' "$manifest" | grep -q -E 'android:allowBackup\(0x[0-9a-f]+\)=(false|\(type 0x12\)0x0)'; then
    fail "$name: android:allowBackup is not false"
  fi

  badging=$("$aapt2" dump badging "$apk")
  actual_package=$(printf '%s\n' "$badging" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
  if [ "$actual_package" != "$package" ]; then
    fail "$name: package name is '$actual_package', expected '$package'"
  fi
  if printf '%s\n' "$badging" | grep -q '^application-debuggable'; then
    fail "$name: application is debuggable"
  fi

  actual_permissions=$("$aapt2" dump permissions "$apk" | sed -n "s/^uses-permission[a-z0-9-]*: name='\([^']*\)'.*/\1/p" | LC_ALL=C sort)
  if [ "$actual_permissions" != "$expected_permissions" ]; then
    unexpected=$(printf '%s\n' "$actual_permissions" | grep -v -x -F "$expected_permissions" || true)
    missing=$(printf '%s\n' "$expected_permissions" | grep -v -x -F "$actual_permissions" || true)
    fail "$name: permissions differ; unexpected: ${unexpected:-none}; missing: ${missing:-none}"
  fi

  abi=${name#commitnote-android-}
  abi=${abi%.apk}
  abi=${abi%-debugsigned}
  case "$abi" in
    arm64-v8a | x86_64) ;;
    *) fail "$name: unexpected ABI '$abi' in the file name" ;;
  esac
  actual_abis=$(jar tf "$apk" | sed -n 's#^lib/\([^/]*\)/.*#\1#p' | LC_ALL=C sort -u)
  if [ "$actual_abis" != "$abi" ]; then
    fail "$name: lib/ holds '$(printf '%s' "$actual_abis" | tr '\n' ' ')', expected only $abi"
  fi
  seen_abis="$seen_abis $abi"
}

check_aab() {
  aab=$1
  extracted="$work_dir/aab"
  mkdir "$extracted"
  (cd "$extracted" && jar xf "$aab")

  check_core_bundle "$extracted/base/assets/commitnote-core.js" "$(basename "$aab")"

  actual_abis=$(jar tf "$aab" | sed -n 's#^base/lib/\([^/]*\)/.*#\1#p' | LC_ALL=C sort -u)
  if [ "$actual_abis" != "arm64-v8a
x86_64" ]; then
    fail "$(basename "$aab"): base/lib/ holds '$(printf '%s' "$actual_abis" | tr '\n' ' ')', expected arm64-v8a and x86_64"
  fi
}

apks=$(find "$release_dir" -maxdepth 1 -name '*.apk' | LC_ALL=C sort)
apk_count=$(printf '%s\n' "$apks" | grep -c . || true)
if [ "$apk_count" -ne 2 ]; then
  fail "expected exactly 2 APKs in $release_dir, found $apk_count"
fi

seen_abis=
for apk in $apks; do
  check_apk "$apk"
done
case " $seen_abis " in
  *" arm64-v8a "* ) ;;
  * ) fail "no arm64-v8a APK in $release_dir" ;;
esac
case " $seen_abis " in
  *" x86_64 "* ) ;;
  * ) fail "no x86_64 APK in $release_dir" ;;
esac

if [ -e "$release_dir/commitnote-android.aab" ]; then
  check_aab "$release_dir/commitnote-android.aab"
fi

echo "release check passed"
