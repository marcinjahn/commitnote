#!/bin/sh
set -eu

usage() {
  echo "usage: $0 <command...>" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage

. "$(dirname -- "$0")/lib/session.sh"

trap stop_session EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

start_session
"$@"
