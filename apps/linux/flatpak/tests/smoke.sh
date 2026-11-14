#!/bin/sh
# The Flatpak smoke test, in a headless sway session with no Secret Service and no GNOME session.
# The release Flatpak bundle shows its login page and quits; the testing Flatpak bundle, whose fake
# forge accepts any token, also logs in and saves an edit to a note.
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <release bundle> [<testing bundle>]" >&2
  exit 2
fi

tests_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
out_dir=/out
release_id=io.github.marcinjahn.commitnote
testing_id=$release_id.Devel

. "$tests_dir/lib/session.sh"
. "$tests_dir/lib/app.sh"

keyboard_pid=
monitor_pid=
cleanup() {
  app_stop
  for pid in $keyboard_pid $monitor_pid; do
    kill "$pid" 2>/dev/null || true
  done
  stop_session
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ok() {
  echo "ok: $*"
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

install_bundle() {
  "$tests_dir/install.sh" "$1" >"$run_dir/install.log" 2>&1 || fail "install $1; see install.log"
  installed=$(flatpak list --user --app --columns=application)
  [ "$installed" = "$2" ] || fail "expected $2 to be the only installed app, found: ${installed:-none}"
  ok "installed $2 with its runtime from Flathub"
}

check_no_gnome_session() {
  ps -eo pid,user,args >"$run_dir/processes.txt"
  if gnome=$(pgrep -l '^(gnome-|gsd-|mutter|org\.gnome\.)'); then
    fail "GNOME session processes are running: $gnome"
  fi
  ok "no GNOME session processes"
}

check_app_log() {
  if grep -nE 'panicked at|CRITICAL|bundled note fonts unavailable' "$app_log" >&2; then
    fail "$app_id logged a failure; see app.log"
  fi
  ok "app.log has no panic, CRITICAL message or font failure"
}

uninstall() {
  flatpak uninstall --user -y --noninteractive --delete-data "$app_id" >"$run_dir/uninstall.log" 2>&1 ||
    fail "uninstall $app_id; see uninstall.log"
  if flatpak info --user "$app_id" >/dev/null 2>&1 || [ -e "$HOME/.var/app/$app_id" ]; then
    fail "$app_id or its data is still installed"
  fi
  ok "uninstalled $app_id with its data"
}

# step <file name> <wtype arguments...>: sends input, then saves the window once the input has
# changed it and it has settled.
step() {
  shot=$run_dir/$1
  shift
  wtype "$@"
  app_capture_settled "$shot" "$previous_shot"
  previous_shot=$shot
}

portal_calls() {
  grep -c "interface=org.freedesktop.portal.$1; member=$2\$" "$run_dir/portal-calls.log" || true
}

notes_unsaved() {
  [ "$(portal_calls Inhibit Inhibit)" -gt 0 ]
}

notes_saved() {
  inhibits=$(portal_calls Inhibit Inhibit)
  [ "$inhibits" -gt 0 ] && [ "$(portal_calls Request Close)" -eq "$inhibits" ]
}

release_flatpak() {
  run_dir=$out_dir/release
  mkdir "$run_dir"
  install_bundle "$1" "$release_id"

  flatpak info --user --show-permissions "$release_id" >"$run_dir/permissions.ini"
  if [ "$(cat "$run_dir/permissions.ini")" != "$(cat "$tests_dir/expected-permissions.ini")" ]; then
    cat "$run_dir/permissions.ini" >&2
    fail "the permissions above differ from expected-permissions.ini"
  fi
  ok "permissions are exactly IPC, Wayland, fallback X11, DRI and network"

  app_start "$release_id" "$run_dir/app.log"
  app_wait_for_window
  ok "window mapped with app ID $release_id"
  app_capture_settled "$run_dir/login.png"
  colours=$(magick "$run_dir/login.png" -format %k info:)
  [ "$colours" -gt 200 ] || fail "login.png looks blank ($colours colours)"
  ok "login page rendered ($colours colours in login.png)"
  check_no_gnome_session
  app_quit
  ok "quit with status 0"
  check_app_log
  uninstall
}

# Input comes from wtype, but each wtype run adds a virtual keyboard and removes it on exit, and a
# seat left without a keyboard drops focus and the first keys of the next run. A long-lived wtype
# keeps one keyboard on the seat for the whole run.
#
# The proof of the save is the app's logout inhibitor: the app holds one while any note is unsaved
# and releases it once the note is saved. Through the portal these are an Inhibit call and a Close
# call on its request, which a session bus monitor sees from outside the sandbox.
testing_flatpak() {
  run_dir=$out_dir/testing
  mkdir "$run_dir"
  install_bundle "$1" "$testing_id"

  wtype -s 3600000 &
  keyboard_pid=$!
  dbus-monitor --session \
    "type='method_call',interface='org.freedesktop.portal.Inhibit',member='Inhibit'" \
    "type='method_call',interface='org.freedesktop.portal.Request',member='Close'" \
    >"$run_dir/portal-calls.log" 2>&1 &
  monitor_pid=$!

  app_start "$testing_id" "$run_dir/app.log"
  app_wait_for_window
  ok "window mapped with app ID $testing_id"
  previous_shot=$run_dir/01-start.png
  app_capture_settled "$previous_shot"

  step 02-token.png fake-forge-token
  step 03-repositories.png -k Return
  step 04-notes-repository.png -k Tab -k Tab -k Down -k Down -k Down -k Down -k Down -k Down
  step 05-unlock.png -k Return
  step 06-passphrase.png "sample notes repo passphrase" -k Tab -k Tab -k space
  step 07-logged-in.png -k Tab -k Return
  ok "logged in to the fake forge without remembering the session"
  check_no_gnome_session

  step 08-search.png -M ctrl -k f -m ctrl
  step 09-search-results.png Welcome
  step 10-note-open.png -k Return
  ok "opened the Welcome note"
  if notes_unsaved; then
    fail "a note was unsaved before the edit"
  fi

  # F9 hides the sidebar and focuses its toggle, which is followed by the sync status, the note
  # menu, the note title and the note body.
  step 11-sidebar-hidden.png -k F9
  step 12-body-focused.png -k Tab -k Tab -k Tab -k Tab -M ctrl -k End -m ctrl
  wtype -k Return "Edited by the Flatpak smoke test."
  wait_for 10 notes_unsaved || fail "the edit did not leave the note unsaved"
  app_capture_change "$run_dir/13-edited.png" "$previous_shot"
  ok "edited the note"
  wtype -M ctrl s -m ctrl
  wait_for 20 notes_saved || fail "the note was not saved within 20 s of Ctrl+S"
  app_capture_settled "$run_dir/14-saved.png"
  ok "saved the note"

  app_quit
  ok "quit with status 0"
  check_app_log
  uninstall
}

start_session
release_flatpak "$1"
if [ "$#" -eq 2 ]; then
  testing_flatpak "$2"
fi
echo "Flatpak smoke test passed"
