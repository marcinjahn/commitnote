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

fonts_root=$(mktemp -d)
meson install -C "$build_dir" --tags fonts --destdir "$fonts_root" --no-rebuild --quiet
data_dir=$(meson introspect --buildoptions "$build_dir" \
  | python3 -c 'import json, os, sys; o = {x["name"]: x["value"] for x in json.load(sys.stdin)}; print(os.path.join(o["prefix"], o["datadir"]))')
export XDG_DATA_DIRS="$fonts_root$data_dir:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"

# The build container cannot create the namespaces WebKit's bubblewrap sandbox needs.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1

logs_dir=/src/apps/linux/out/logs
testlog="$build_dir/meson-logs/testlog.txt"

new_runtime_dir() {
  XDG_RUNTIME_DIR=$(mktemp -d)
  chmod 0700 "$XDG_RUNTIME_DIR"
  export XDG_RUNTIME_DIR
}

run_mutter_suite() {
  new_runtime_dir
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
    '
}

run_sway_smoke() {
  new_runtime_dir

  sway_config=$(mktemp)
  cat >"$sway_config" <<'CONFIG'
xwayland disable
output * resolution 1920x1200
# sway never marks a tiled view as client-side decorated; a floating one is
for_window [app_id="io.github.marcinjahn.commitnote.Devel"] floating enable
CONFIG

  # No service activation on the bus: gnome-keyring is installed for the mutter run and would
  # otherwise start itself on the first Secret Service call.
  bus_config=$(mktemp)
  cat >"$bus_config" <<'CONFIG'
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:tmpdir=/tmp</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
CONFIG

  SWAY_CONFIG="$sway_config" \
    WLR_BACKENDS=headless \
    WLR_RENDERER=pixman \
    WLR_LIBINPUT_NO_DEVICES=1 \
    GDK_BACKEND=wayland \
    GSK_RENDERER=cairo \
    COMMITNOTE_SCREENSHOT_DIR=/src/apps/linux/out/screenshots \
    dbus-run-session --config-file="$bus_config" -- sh -c '
      set -eu
      env -u GSETTINGS_SCHEMA_DIR -u GSETTINGS_BACKEND -u WAYLAND_DISPLAY -u DISPLAY \
        sway --config "$SWAY_CONFIG" >/src/apps/linux/out/logs/sway.log 2>&1 &
      sway_pid=$!
      stop_sway() {
        kill "$sway_pid" 2>/dev/null || true
        wait "$sway_pid" 2>/dev/null || true
      }
      trap stop_sway EXIT

      ipc_socket="$XDG_RUNTIME_DIR/sway-ipc.$(id -u).$sway_pid.sock"
      wayland_display=
      waited=0
      while [ -z "$wayland_display" ] || [ ! -S "$ipc_socket" ]; do
        if [ "$waited" -ge 100 ] || ! kill -0 "$sway_pid" 2>/dev/null; then
          echo "sway did not start; see out/logs/sway.log" >&2
          exit 1
        fi
        for candidate in "$XDG_RUNTIME_DIR"/wayland-*; do
          case "$candidate" in
            *.lock) ;;
            *) [ ! -S "$candidate" ] || wayland_display=${candidate##*/} ;;
          esac
        done
        sleep 0.1
        waited=$((waited + 1))
      done
      export WAYLAND_DISPLAY="$wayland_display"
      export SWAYSOCK="$ipc_socket"

      owner=$(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner org.freedesktop.secrets)
      if [ "$owner" != "(false,)" ]; then
        echo "a Secret Service owns org.freedesktop.secrets in the smoke session: $owner" >&2
        exit 1
      fi

      meson test -C target/meson/testing --suite ui-smoke --print-errorlogs
    '
}

filter=${COMMITNOTE_UI_FILTER:-}
status=0

case "$filter" in
smoke*) ;;
*)
  run_mutter_suite || status=$?
  cp "$testlog" "$logs_dir/ui-testlog.txt" 2>/dev/null || true
  ;;
esac

case "$filter" in
"" | smoke*)
  smoke_status=0
  run_sway_smoke || smoke_status=$?
  cp "$testlog" "$logs_dir/ui-smoke-testlog.txt" 2>/dev/null || true
  [ "$smoke_status" -eq 0 ] || status=$smoke_status
  ;;
esac

exit "$status"
