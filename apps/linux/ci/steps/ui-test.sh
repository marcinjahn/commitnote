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

status=0
WAYLAND_DISPLAY=commitnote-ui \
  GDK_BACKEND=wayland \
  GSK_RENDERER=cairo \
  ADW_DISABLE_PORTAL=1 \
  COMMITNOTE_SCREENSHOT_DIR=/src/apps/linux/out/screenshots \
  COMMITNOTE_READBACK_DIR=/src/apps/linux/out/read-back \
  dbus-run-session -- sh -c '
    set -eu
    env -u GSETTINGS_SCHEMA_DIR -u GSETTINGS_BACKEND -u WAYLAND_DISPLAY \
      mutter --headless --wayland --no-x11 --virtual-monitor 1920x1200 \
      --wayland-display=commitnote-ui >/src/apps/linux/out/logs/mutter.log 2>&1 &
    mutter_pid=$!
    stop_mutter() {
      kill "$mutter_pid" 2>/dev/null || true
      wait "$mutter_pid" 2>/dev/null || true
    }
    trap stop_mutter EXIT

    waited=0
    while [ ! -S "$XDG_RUNTIME_DIR/commitnote-ui" ]; do
      if [ "$waited" -ge 100 ] || ! kill -0 "$mutter_pid" 2>/dev/null; then
        echo "mutter did not start; see out/logs/mutter.log" >&2
        exit 1
      fi
      sleep 0.1
      waited=$((waited + 1))
    done
    gdbus wait --session --timeout 10 org.gnome.Mutter.RemoteDesktop

    if ! fc-list ":charset=1f600" | grep -q .; then
      echo "no color emoji font is installed (google-noto-color-emoji-fonts)" >&2
      exit 1
    fi

    echo "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
    gdbus wait --session --timeout 10 org.freedesktop.secrets
    meson test -C target/meson/testing --suite ui --print-errorlogs
  ' || status=$?

cp "$build_dir/meson-logs/testlog.txt" /src/apps/linux/out/logs/ui-testlog.txt 2>/dev/null || true
exit "$status"
