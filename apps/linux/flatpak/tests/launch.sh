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

app_pid=
stop() {
  if [ -n "$app_pid" ]; then
    kill "$app_pid" 2>/dev/null || true
  fi
  stop_session
}
trap stop EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

app_running() {
  kill -0 "$app_pid" 2>/dev/null
}

window_geometry() {
  swaymsg -t get_tree | jq -r --arg app_id "$app_id" '
    first(.. | objects | select(.app_id? == $app_id and .visible == true))
    | .rect | "\(.x),\(.y) \(.width)x\(.height)"'
}

wait_for_window() {
  waited=0
  until geometry=$(window_geometry) && [ -n "$geometry" ]; do
    if ! app_running; then
      echo "$app_id exited before mapping a window; see app.log" >&2
      return 1
    fi
    if [ "$waited" -ge 120 ]; then
      echo "$app_id did not map a window within 60 s; see app.log" >&2
      return 1
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
}

# Captures the window until three consecutive frames match, so the screenshot shows it fully
# rendered; after 30 s it keeps the latest frame.
capture_settled_window() {
  frames_dir=$(mktemp -d)
  previous=
  matches=0
  attempts=0
  while [ "$matches" -lt 2 ] && [ "$attempts" -lt 60 ]; do
    sleep 0.5
    grim -g "$geometry" "$frames_dir/frame.png"
    current=$(sha256sum <"$frames_dir/frame.png")
    if [ "$current" = "$previous" ]; then
      matches=$((matches + 1))
    else
      matches=0
    fi
    previous=$current
    attempts=$((attempts + 1))
  done
  mv "$frames_dir/frame.png" "$1"
}

wait_for_app_exit() {
  waited=0
  while app_running; do
    if [ "$waited" -ge 40 ]; then
      echo "$app_id did not exit within 20 s of closing its window" >&2
      return 1
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
  app_status=0
  wait "$app_pid" || app_status=$?
  app_pid=
  if [ "$app_status" -ne 0 ]; then
    echo "$app_id exited with status $app_status; see app.log" >&2
    return 1
  fi
}

start_session

flatpak run "$app_id" >"$out_dir/app.log" 2>&1 &
app_pid=$!

wait_for_window
ps -eo pid,user,args >"$out_dir/processes.txt"
capture_settled_window "$out_dir/launch.png"

swaymsg "[app_id=\"^$app_id\$\"] kill" >/dev/null
wait_for_app_exit
