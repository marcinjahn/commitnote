#!/bin/bash
set -u

if [ "$#" -lt 2 ]; then
  echo "usage: stop-when-silent.sh <seconds> <command> [args...]" >&2
  exit 2
fi
limit=$1
shift

# After a failed app launch xcodebuild can wait on the simulator without a word until the job
# times out, so a command that stays silent too long is stopped instead.
log=$(mktemp)
"$@" > >(tee "$log") 2>&1 &
pid=$!
while kill -0 "$pid" 2>/dev/null; do
  sleep 10
  silent=$(($(date +%s) - $(stat -f %m "$log")))
  if [ "$silent" -ge "$limit" ]; then
    echo "::error::No output for ${silent}s, stopping $1"
    kill -INT "$pid" 2>/dev/null
    for _ in $(seq 60); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$pid" 2>/dev/null
    wait "$pid"
    exit 124
  fi
done
wait "$pid"
