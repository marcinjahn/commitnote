#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <commitnote AppImage built with --mode desktop-fake> [output dir]" >&2
  exit 2
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
appimage=$(realpath -- "$1")
out_dir=${2:-$repo_root/dist-appimage/smoke}
[ -f "$appimage" ] || {
  echo "no AppImage at $appimage" >&2
  exit 2
}

missing=
for command in Xvfb xdotool import compare dbus-run-session xprop xdpyinfo xclip; do
  command -v "$command" >/dev/null 2>&1 || missing=1
done
if [ -n "$missing" ]; then
  export DEBIAN_FRONTEND=noninteractive
  # Rootless docker usually cannot switch to the _apt sandbox user.
  apt-get -qq -o APT::Sandbox::User=root update
  apt-get -qq -o APT::Sandbox::User=root install -y --no-install-recommends \
    xvfb xdotool imagemagick dbus-x11 x11-utils xclip >/dev/null
fi

if [ -z "${COMMITNOTE_SMOKE_IN_DBUS:-}" ]; then
  COMMITNOTE_SMOKE_IN_DBUS=1 exec dbus-run-session -- bash "$0" "$appimage" "$out_dir"
fi

mkdir -p "$out_dir/logs"
out_dir=$(cd -- "$out_dir" && pwd)
log_dir=$out_dir/logs
run_dir=$(mktemp -d)
extract_dir=$run_dir/extract
mkdir -p "$extract_dir"

app_id=io.github.marcinjahn.commitnote
token=smoke-token
repository=sample/notes
passphrase="sample notes repo passphrase"
login_timeout=${COMMITNOTE_SMOKE_LOGIN_TIMEOUT:-90}
# Caret blinks and hover fades change a few hundred pixels; any zoom step rescales most of the screen.
zoom_tolerance=2000

failures=0
app_pid=
xvfb_pid=
window=

pass() { echo "PASS  $*"; }
fail() {
  echo "FAIL  $*"
  failures=$((failures + 1))
}

stop_app() {
  [ -n "$app_pid" ] || return 0
  kill -TERM -- "-$app_pid" 2>/dev/null || true
  for _ in $(seq 50); do
    kill -0 "$app_pid" 2>/dev/null || break
    sleep 0.2
  done
  kill -KILL -- "-$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  app_pid=
  window=
}

cleanup() {
  stop_app
  if [ -n "$xvfb_pid" ]; then
    kill "$xvfb_pid" 2>/dev/null || true
    wait "$xvfb_pid" 2>/dev/null || true
  fi
  rm -rf -- "$run_dir"
}
trap cleanup EXIT

export DISPLAY=:99
Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp >"$log_dir/xvfb.log" 2>&1 &
xvfb_pid=$!
for _ in $(seq 50); do
  xdpyinfo >/dev/null 2>&1 && break
  sleep 0.2
done
xdpyinfo >/dev/null 2>&1 || {
  echo "Xvfb did not start" >&2
  exit 1
}

use_profile() {
  local profile=$run_dir/profiles/$1 color_scheme=$2
  mkdir -p "$profile/home" "$profile/data" "$profile/config/gtk-3.0" "$profile/cache"
  export HOME=$profile/home
  export XDG_DATA_HOME=$profile/data
  export XDG_CONFIG_HOME=$profile/config
  export XDG_CACHE_HOME=$profile/cache
  if [ "$color_scheme" = dark ]; then
    printf '[Settings]\ngtk-application-prefer-dark-theme=1\n' >"$XDG_CONFIG_HOME/gtk-3.0/settings.ini"
  else
    rm -f -- "$XDG_CONFIG_HOME/gtk-3.0/settings.ini"
  fi
}

run_appimage() {
  TMPDIR=$extract_dir NO_CLEANUP=1 exec setsid "$appimage" --appimage-extract-and-run "$@"
}

# Right after a restart the killed instance's window can still be listed for a moment.
main_window() {
  local candidate width
  for _ in $(seq 60); do
    for candidate in $(xdotool search --onlyvisible --class commitnote 2>/dev/null); do
      width=$(xdotool getwindowgeometry --shell "$candidate" 2>/dev/null | sed -n 's/^WIDTH=//p')
      if [ -n "$width" ] && [ "$width" -ge 300 ]; then
        sleep 0.5
        if xdotool getwindowgeometry "$candidate" >/dev/null 2>&1; then
          echo "$candidate"
          return 0
        fi
      fi
    done
    sleep 0.5
  done
  return 1
}

launch() {
  local name=$1
  shift
  run_appimage "$@" >"$log_dir/$name.log" 2>&1 &
  app_pid=$!
  window=
  if timeout 60 xdotool search --sync --onlyvisible --class commitnote >/dev/null; then
    window=$(main_window)
  fi
  [ -n "$window" ] || {
    echo "the commitnote window did not appear; see $log_dir/$name.log" >&2
    exit 1
  }
  xdotool windowmove --sync "$window" 0 0 || true
  xdotool windowsize --sync "$window" 1280 800 || true
  xdotool windowfocus --sync "$window" || true
  xdotool mousemove 1279 799
}

shot() {
  import -window root "$out_dir/$1.png"
}

pixel_diff() {
  local value
  value=$(compare -metric AE -fuzz 2% "$1" "$2" null: 2>&1 | cut -d' ' -f1 || true)
  if [[ "$value" =~ ^[0-9.e+]+$ ]]; then
    printf '%.0f\n' "$value"
  else
    echo 999999999
  fi
}

same_image() {
  [ "$(pixel_diff "$1" "$2")" = "0" ]
}

wait_until_stable() {
  local timeout=$1 previous=$run_dir/stable-a.png current=$run_dir/stable-b.png
  import -window root "$previous"
  for _ in $(seq "$timeout"); do
    sleep 1
    import -window root "$current"
    same_image "$previous" "$current" && return 0
    cp "$current" "$previous"
  done
  return 1
}

wait_for_change() {
  local reference=$1 timeout=$2 candidate=$run_dir/candidate.png
  for _ in $(seq "$timeout"); do
    sleep 1
    import -window root "$candidate"
    same_image "$reference" "$candidate" || return 0
  done
  return 1
}

log_in() {
  local before=$out_dir/$1.png
  xdotool key Tab Tab
  xdotool type --delay 20 "$token"
  xdotool key Return
  sleep 3
  xdotool type --delay 50 "$repository"
  sleep 3
  xdotool type --delay 20 "$passphrase"
  xdotool key Tab
  sleep 1
  import -window root "$before"
  xdotool key Return
  wait_for_change "$before" 10 && wait_until_stable "$login_timeout"
}

blur() {
  xdotool mousemove 900 600 click 1
  xdotool mousemove 1279 799
  sleep 1
}

open_welcome_note() {
  xdotool mousemove 60 303 click 1
  xdotool mousemove 1279 799
  wait_until_stable 20 || true
}

echo "== Login screen (light)"
use_profile light light
launch light-first
wait_until_stable 20 || true
shot login-light

window_name=$(xdotool getwindowname "$window")
wm_class=$(xprop -id "$window" WM_CLASS)
desktop_wm_class=$(sed -n 's/^StartupWMClass=//p' "$repo_root/src-tauri/linux/$app_id.desktop")
echo "window title: $window_name"
echo "$wm_class"
if [ "$window_name" = commitnote ]; then pass "window title is commitnote"; else fail "window title is '$window_name'"; fi
case "$wm_class" in
*"\"$desktop_wm_class\""*) pass "WM_CLASS matches StartupWMClass=$desktop_wm_class" ;;
*) fail "WM_CLASS does not match StartupWMClass=$desktop_wm_class" ;;
esac

echo "== Fake-forge login (Argon2 in its worker, WebCrypto)"
echo "review passphrase-light.png: no Remember me checkbox, the stay-logged-in hint is shown"
if log_in passphrase-light; then
  shot logged-in-light
  pass "login settled; review logged-in-light.png"
else
  shot logged-in-light
  fail "login did not settle within ${login_timeout}s"
fi
if [ "$(pixel_diff "$out_dir/login-light.png" "$out_dir/logged-in-light.png")" -lt 50000 ]; then
  fail "the screen barely changed after logging in"
fi

echo "== Zoom keys and Ctrl+scroll"
blur
zoom_reference=$run_dir/zoom-reference.png
import -window root "$zoom_reference"
check_no_zoom() {
  local label=$1 name=$2 diff
  sleep 1
  shot "$name"
  diff=$(pixel_diff "$zoom_reference" "$out_dir/$name.png")
  if [ "$diff" -le "$zoom_tolerance" ]; then
    pass "$label does not zoom ($diff px differ)"
  else
    fail "$label changed $diff px; review $name.png"
  fi
}
xdotool key ctrl+plus
check_no_zoom "Ctrl+plus" zoom-ctrl-plus
xdotool key ctrl+equal
check_no_zoom "Ctrl+equal" zoom-ctrl-equal
xdotool key ctrl+minus
check_no_zoom "Ctrl+minus" zoom-ctrl-minus
xdotool key ctrl+0
check_no_zoom "Ctrl+0" zoom-ctrl-0
xdotool mousemove 900 600 keydown ctrl click 4 click 4 click 4 keyup ctrl mousemove 1279 799
check_no_zoom "Ctrl+scroll up" zoom-ctrl-scroll-up
xdotool mousemove 900 600 keydown ctrl click 5 click 5 click 5 keyup ctrl mousemove 1279 799
check_no_zoom "Ctrl+scroll down" zoom-ctrl-scroll-down

echo "== No service worker"
if find "$XDG_DATA_HOME/$app_id" -iname '*serviceworker*' | grep -q .; then
  fail "service worker storage exists under $XDG_DATA_HOME/$app_id"
else
  pass "no service worker storage under \$XDG_DATA_HOME/$app_id"
fi

echo "== App menu"
xdotool mousemove 277 57 click 1
xdotool mousemove 1279 799
sleep 1
shot app-menu
echo "review app-menu.png: no Install app command; logged-in-light.png: no install bar"

echo "== Mouse wheel reaches the webview"
xdotool mousemove 170 110 click 1
xdotool mousemove 640 400
wait_until_stable 10 || true
shot settings
for _ in 1 2 3 4 5; do
  xdotool click 5
  sleep 0.2
done
xdotool mousemove 1279 799
sleep 1
shot settings-scrolled
if [ "$(pixel_diff "$out_dir/settings.png" "$out_dir/settings-scrolled.png")" -gt "$zoom_tolerance" ]; then
  pass "the wheel scrolls the settings dialog, so the Ctrl+scroll checks are meaningful"
else
  fail "the wheel did not scroll the settings dialog"
fi
xdotool key Escape
sleep 1

echo "== Open a note"
open_welcome_note
shot notes-light
if [ "$(pixel_diff "$zoom_reference" "$out_dir/notes-light.png")" -gt "$zoom_tolerance" ]; then
  pass "a note opened; review notes-light.png"
else
  fail "clicking the Welcome note changed nothing"
fi

echo "== Second launch with --action search"
second_log=$log_dir/second-launch.log
run_appimage --action search >"$second_log" 2>&1 &
second_pid=$!
second_exited=
for _ in $(seq 60); do
  if ! kill -0 "$second_pid" 2>/dev/null; then
    second_exited=1
    break
  fi
  sleep 0.5
done
wait_until_stable 10 || true
shot second-launch-search
if [ -n "$second_exited" ]; then
  pass "the second process exited"
else
  fail "the second process is still running"
  kill -TERM -- "-$second_pid" 2>/dev/null || true
fi
wait "$second_pid" 2>/dev/null || true
windows=$(xdotool search --onlyvisible --class commitnote | wc -l)
if [ "$windows" -eq 1 ]; then pass "one commitnote window"; else fail "$windows commitnote windows"; fi
if [ "$(pixel_diff "$out_dir/notes-light.png" "$out_dir/second-launch-search.png")" -gt "$zoom_tolerance" ]; then
  pass "the first window reacted; review second-launch-search.png for the search dialog"
else
  fail "the first window did not change after the second launch"
fi

echo "== Restart keeps the session"
stop_app
if xdotool search --onlyvisible --class commitnote >/dev/null 2>&1; then
  fail "a commitnote window survived the quit"
fi
find "$XDG_DATA_HOME/$app_id" -type d -iname 'indexeddb' | sed 's/^/IndexedDB: /'
launch light-relaunch
wait_until_stable 30 || true
shot relaunch-light
to_login=$(pixel_diff "$out_dir/login-light.png" "$out_dir/relaunch-light.png")
to_notes=$(pixel_diff "$out_dir/notes-light.png" "$out_dir/relaunch-light.png")
echo "relaunch differs from the login screen by $to_login px and from the notes by $to_notes px"
if [ "$to_notes" -lt "$to_login" ]; then
  pass "relaunch restored the notes without logging in; review relaunch-light.png"
else
  fail "relaunch did not restore the session; review relaunch-light.png"
fi
stop_app

echo "== Dark color scheme from the GTK prefer-dark setting"
use_profile dark dark
launch dark-first
wait_until_stable 20 || true
shot login-dark
if [ "$(pixel_diff "$out_dir/login-light.png" "$out_dir/login-dark.png")" -gt 100000 ]; then
  pass "the login screen follows the dark preference; review login-dark.png"
else
  fail "the login screen ignored the dark preference"
fi
if log_in passphrase-dark; then
  open_welcome_note
  shot notes-dark
  pass "dark login settled; review notes-dark.png"
else
  shot notes-dark
  fail "dark login did not settle within ${login_timeout}s"
fi
stop_app

echo
echo "Screenshots and logs: $out_dir"
if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "All automated checks passed"
