# One running app in the test session: start it, wait for its window, capture it and quit it.
# Sourced after lib/session.sh by scripts running as the test user; they trap app_stop.

app_pid=

# wait_for <seconds> <command...>: runs the command every 0.25 s until it succeeds, failing once
# the time is up.
wait_for() {
  wait_deadline=$(($(date +%s) + $1))
  shift
  until "$@"; do
    [ "$(date +%s)" -lt "$wait_deadline" ] || return 1
    sleep 0.25
  done
}

# app_start <app id> <log> [<flatpak run option>...]
app_start() {
  app_id=$1
  app_log=$2
  shift 2
  flatpak run "$@" "$app_id" >"$app_log" 2>&1 &
  app_pid=$!
}

app_stop() {
  if [ -n "$app_pid" ]; then
    kill "$app_pid" 2>/dev/null || true
  fi
}

app_running() {
  kill -0 "$app_pid" 2>/dev/null
}

app_window_geometry() {
  swaymsg -t get_tree | jq -r --arg app_id "$app_id" '
    first(.. | objects | select(.app_id? == $app_id and .visible == true))
    | .rect | "\(.x),\(.y) \(.width)x\(.height)"'
}

app_window_mapped() {
  app_running || return 0
  app_geometry=$(app_window_geometry) && [ -n "$app_geometry" ]
}

# Waits up to 60 s for a window with the app ID, so finding one also proves the ID is right.
app_wait_for_window() {
  app_geometry=
  if ! wait_for 60 app_window_mapped; then
    echo "$app_id did not map a window within 60 s; see $app_log" >&2
    return 1
  fi
  if ! app_running; then
    echo "$app_id exited before mapping a window; see $app_log" >&2
    return 1
  fi
}

app_capture() {
  grim -g "$app_geometry" "$1"
}

# app_frames_differ <a> <b>: true when more pixels differ than a blinking text caret covers, or the
# frames cannot be compared.
app_frames_differ() {
  differing=$(compare -metric AE "$1" "$2" null: 2>&1) || true
  differing=${differing%%[!0-9]*}
  [ -z "$differing" ] || [ "$differing" -gt 40 ]
}

app_capture_changed() {
  app_capture "$app_frames_dir/frame.png" &&
    app_frames_differ "$app_frames_dir/previous.png" "$app_frames_dir/frame.png"
}

app_capture_unchanged() {
  sleep 0.5
  mv "$app_frames_dir/frame.png" "$app_frames_dir/previous.png"
  app_capture "$app_frames_dir/frame.png"
  if app_frames_differ "$app_frames_dir/previous.png" "$app_frames_dir/frame.png"; then
    app_unchanged_frames=0
  else
    app_unchanged_frames=$((app_unchanged_frames + 1))
  fi
  [ "$app_unchanged_frames" -ge 2 ]
}

# app_finish_capture <file> <condition> <what>: waits up to 30 s for the condition on captured
# frames, then saves the latest frame.
app_finish_capture() {
  capture_status=0
  wait_for 30 "$2" || capture_status=$?
  mv "$app_frames_dir/frame.png" "$1"
  rm -rf "$app_frames_dir"
  if [ "$capture_status" -ne 0 ]; then
    echo "the $app_id window did not $3 within 30 s; latest frame in $1" >&2
    return 1
  fi
}

# app_capture_change <file> <frame before an action>: saves the first frame that shows the action
# changed the window.
app_capture_change() {
  app_frames_dir=$(mktemp -d)
  cp "$2" "$app_frames_dir/previous.png"
  app_finish_capture "$1" app_capture_changed change
}

# app_capture_settled <file> [<frame before an action>]: saves the window once it has stayed the
# same for a second, so the screenshot shows it fully rendered. Given the frame from before an
# action, it first waits for the window to change from it, so the result of the action is captured
# rather than the screen before it.
app_capture_settled() {
  if [ "$#" -ge 2 ]; then
    app_capture_change "$1" "$2" || return 1
  else
    app_capture "$1"
  fi
  app_frames_dir=$(mktemp -d)
  cp "$1" "$app_frames_dir/frame.png"
  app_unchanged_frames=0
  app_finish_capture "$1" app_capture_unchanged settle
}

app_exited() {
  ! app_running
}

# Closes the window through sway and requires the app to exit with status 0 within 20 s.
app_quit() {
  swaymsg "[app_id=\"^$app_id\$\"] kill" >/dev/null
  if ! wait_for 20 app_exited; then
    echo "$app_id did not exit within 20 s of closing its window" >&2
    return 1
  fi
  app_status=0
  wait "$app_pid" || app_status=$?
  app_pid=
  if [ "$app_status" -ne 0 ]; then
    echo "$app_id exited with status $app_status; see $app_log" >&2
    return 1
  fi
}
