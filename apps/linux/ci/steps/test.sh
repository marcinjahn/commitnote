#!/bin/sh
set -eu

dbus-run-session -- sh -c '
  set -eu
  sh ci/steps/start-keyring.sh
  cargo test --workspace --exclude commitnote --locked
'
DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent cargo test -p commitnote-core-runtime --locked --test remembered_session_no_service -- --ignored
dbus-run-session -- cargo test -p commitnote-core-runtime --locked --test remembered_session_unresponsive_service -- --ignored

build_dir=target/meson/testing
logs_dir=/src/apps/linux/out/logs
testlog="$build_dir/meson-logs/testlog.txt"

if [ -d "$build_dir" ]; then
  meson setup --reconfigure "$build_dir" -Dprofile=development -Dtesting=true
else
  meson setup "$build_dir" -Dprofile=development -Dtesting=true
fi

status=0
meson test -C "$build_dir" --suite cargo --print-errorlogs || status=$?
mkdir -p "$logs_dir"
cp "$testlog" "$logs_dir/cargo-testlog.txt" 2>/dev/null || true
if [ "$status" -ne 0 ]; then
  # meson shows only the tail of a failed test's stderr; libtest names the failed tests and their
  # panics on stdout, which only the test log holds.
  sed -n '/^failures:$/,/^test result: FAILED/p' "$testlog" >&2
  exit "$status"
fi

sh ci/steps/ui-test.sh
