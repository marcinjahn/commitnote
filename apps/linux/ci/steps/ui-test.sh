#!/bin/sh
set -eu

build_dir=target/meson/testing

if [ -d "$build_dir" ]; then
  meson setup --reconfigure "$build_dir" -Dprofile=development -Dtesting=true
else
  meson setup "$build_dir" -Dprofile=development -Dtesting=true
fi
meson compile -C "$build_dir"

rm -rf /src/apps/linux/out/screenshots
mkdir -p /src/apps/linux/out/screenshots /src/apps/linux/out/logs

schema_dir=$(mktemp -d)
glib-compile-schemas --strict --targetdir="$schema_dir" "$build_dir/data"
export GSETTINGS_SCHEMA_DIR="$schema_dir"
export GSETTINGS_BACKEND=memory

XDG_RUNTIME_DIR=$(mktemp -d)
chmod 0700 "$XDG_RUNTIME_DIR"
export XDG_RUNTIME_DIR

weston --backend=headless --socket=commitnote-ui --width=1280 --height=800 --idle-time=0 \
  >/src/apps/linux/out/logs/weston.log 2>&1 &
weston_pid=$!

stop_weston() {
  kill "$weston_pid" 2>/dev/null || true
  wait "$weston_pid" 2>/dev/null || true
}
trap stop_weston EXIT

waited=0
while [ ! -S "$XDG_RUNTIME_DIR/commitnote-ui" ]; do
  if [ "$waited" -ge 100 ] || ! kill -0 "$weston_pid" 2>/dev/null; then
    echo "weston did not start; see out/logs/weston.log" >&2
    exit 1
  fi
  sleep 0.1
  waited=$((waited + 1))
done

status=0
WAYLAND_DISPLAY=commitnote-ui \
  GDK_BACKEND=wayland \
  GSK_RENDERER=cairo \
  ADW_DISABLE_PORTAL=1 \
  COMMITNOTE_SCREENSHOT_DIR=/src/apps/linux/out/screenshots \
  dbus-run-session -- sh -c '
    set -eu
    echo "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
    gdbus wait --session --timeout 10 org.freedesktop.secrets
    meson test -C target/meson/testing --suite ui --print-errorlogs
  ' || status=$?

cp "$build_dir/meson-logs/testlog.txt" /src/apps/linux/out/logs/ui-testlog.txt 2>/dev/null || true
exit "$status"
