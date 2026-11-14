#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <bundle>" >&2
  exit 2
fi

tests_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
out_dir=/out

"$tests_dir/install.sh" "$1"

app_id=$(flatpak list --user --app --columns=application)
case "$app_id" in
"" | *"
"*)
  echo "expected exactly one installed app, found: ${app_id:-none}" >&2
  exit 1
  ;;
esac

. "$tests_dir/lib/session.sh"
. "$tests_dir/lib/app.sh"

stop() {
  app_stop
  stop_session
}
trap stop EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

start_session
app_start "$app_id" "$out_dir/app.log"
app_wait_for_window
ps -eo pid,user,args >"$out_dir/processes.txt"
app_capture_settled "$out_dir/launch.png"
app_quit
