#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: warm-up-app.sh <simulator-udid> <app-path>" >&2
  exit 2
fi

BUNDLE_ID="io.github.marcinjahn.commitnote"
# Posted by the Testing build once its core has loaded and it shows the login or notes screen.
READY="io.github.marcinjahn.commitnote.testing.ready"
TIMEOUT=90

xcrun simctl bootstatus "$1" -b >/dev/null
xcrun simctl install "$1" "$2"

# The first launch after an install is the slow one, so the tests start after it has finished.
xcrun simctl spawn "$1" notifyutil -1 "$READY" >/dev/null &
WAITER=$!
xcrun simctl launch "$1" "$BUNDLE_ID"

START=$(date +%s)
while kill -0 "$WAITER" 2>/dev/null && [ $(($(date +%s) - START)) -lt "$TIMEOUT" ]; do
  sleep 1
done
if kill -0 "$WAITER" 2>/dev/null; then
  kill "$WAITER"
  echo "warning: the app did not report ready within $TIMEOUT s" >&2
elif ! wait "$WAITER"; then
  echo "warning: could not wait for the app to report ready, waiting 30 s instead" >&2
  sleep 30
else
  echo "app ready after $(($(date +%s) - START)) s"
fi

xcrun simctl terminate "$1" "$BUNDLE_ID"
