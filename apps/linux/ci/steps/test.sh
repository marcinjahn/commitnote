#!/bin/sh
set -eu

dbus-run-session -- sh -c '
  set -eu
  sh ci/steps/start-keyring.sh
  cargo test --workspace --exclude commitnote --locked
'
DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent cargo test -p commitnote-core-runtime --locked --test remembered_session_no_service -- --ignored
dbus-run-session -- cargo test -p commitnote-core-runtime --locked --test remembered_session_unresponsive_service -- --ignored

if [ -d target/meson/testing ]; then
  meson setup --reconfigure target/meson/testing -Dprofile=development -Dtesting=true
else
  meson setup target/meson/testing -Dprofile=development -Dtesting=true
fi
meson test -C target/meson/testing --suite cargo --print-errorlogs
sh ci/steps/ui-test.sh
