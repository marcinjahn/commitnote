#!/bin/sh
set -e
lock=/tmp/commitnote-e2e.lock
[ -e "$lock" ] || : >"$lock" || [ -e "$lock" ]
exec 9<"$lock"
if ! flock -n 9; then
  echo "Waiting for another e2e run to finish (it holds $lock)..." >&2
  flock 9
fi
playwright install chromium-headless-shell
exec playwright test "$@"
