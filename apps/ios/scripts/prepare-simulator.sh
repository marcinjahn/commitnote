#!/bin/sh
set -u

if [ "$#" -ne 2 ]; then
  echo "usage: prepare-simulator.sh <simulator-udid> <status-file>" >&2
  exit 2
fi

"$(dirname "$0")/disable-password-autofill.sh" "$1"
STATUS=$?
echo "$STATUS" > "$2"
exit "$STATUS"
