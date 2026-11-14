# Desktop session for Flatpak tests: a private session bus that can activate only the portals,
# and headless sway. There is no Secret Service, so the Secret portal has no backend.
# Sourced by scripts running as the test user; they call start_session and trap stop_session.

session_logs_dir=/out/logs

# Everything the session bus may activate.
session_bus_services="
org.freedesktop.portal.Desktop
org.freedesktop.portal.Documents
org.freedesktop.impl.portal.PermissionStore
org.freedesktop.impl.portal.desktop.gtk
org.freedesktop.portal.Flatpak
ca.desrt.dconf
"

start_session() {
  mkdir -p "$session_logs_dir"
  XDG_RUNTIME_DIR=$(mktemp -d)
  chmod 0700 "$XDG_RUNTIME_DIR"
  export XDG_RUNTIME_DIR
  export XDG_CURRENT_DESKTOP=sway
  session_config_dir=$(mktemp -d)

  session_write_portals_config
  session_start_bus
  if [ "$(session_name_has_owner org.freedesktop.secrets)" != "(false,)" ]; then
    echo "org.freedesktop.secrets must have no owner in a session without a Secret Service" >&2
    return 1
  fi
  session_start_sway
  dbus-update-activation-environment WAYLAND_DISPLAY SWAYSOCK
}

stop_session() {
  for pid in ${session_sway_pid:-} ${session_bus_pid:-}; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
}

session_name_has_owner() {
  gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
    --method org.freedesktop.DBus.NameHasOwner "$1"
}

session_write_portals_config() {
  mkdir -p "$HOME/.config/xdg-desktop-portal"
  cat >"$HOME/.config/xdg-desktop-portal/portals.conf" <<CONFIG
[preferred]
default=gtk
org.freedesktop.impl.portal.Secret=none
CONFIG
}

session_start_bus() {
  services_dir=$session_config_dir/dbus-services
  mkdir "$services_dir"
  for service in $session_bus_services; do
    cp "/usr/share/dbus-1/services/$service.service" "$services_dir/"
  done

  bus_socket=$XDG_RUNTIME_DIR/bus
  cat >"$session_config_dir/session-bus.conf" <<CONFIG
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:path=$bus_socket</listen>
  <auth>EXTERNAL</auth>
  <servicedir>$services_dir</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
CONFIG

  # Services the bus activates inherit its output, so this log also holds the portals' output.
  dbus-daemon --nofork --config-file="$session_config_dir/session-bus.conf" \
    >"$session_logs_dir/session-bus.log" 2>&1 &
  session_bus_pid=$!
  session_wait_until session_bus_ready "$session_bus_pid" "the session bus" session-bus.log
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$bus_socket"
}

session_start_sway() {
  cat >"$session_config_dir/sway.conf" <<'CONFIG'
xwayland disable
output * resolution 1920x1200
# sway never marks a tiled view as client-side decorated; a floating one is
for_window [app_id="io.github.marcinjahn.commitnote"] floating enable
for_window [app_id="io.github.marcinjahn.commitnote.Devel"] floating enable
CONFIG

  WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
    sway --config "$session_config_dir/sway.conf" >"$session_logs_dir/sway.log" 2>&1 &
  session_sway_pid=$!
  session_wait_until session_sway_sockets_ready "$session_sway_pid" sway sway.log
  export WAYLAND_DISPLAY SWAYSOCK
}

session_bus_ready() {
  [ -S "$XDG_RUNTIME_DIR/bus" ]
}

session_sway_sockets_ready() {
  SWAYSOCK="$XDG_RUNTIME_DIR/sway-ipc.$(id -u).$session_sway_pid.sock"
  [ -S "$SWAYSOCK" ] || return 1
  for candidate in "$XDG_RUNTIME_DIR"/wayland-*; do
    case "$candidate" in
    *.lock) ;;
    *)
      if [ -S "$candidate" ]; then
        WAYLAND_DISPLAY=${candidate##*/}
        return 0
      fi
      ;;
    esac
  done
  return 1
}

# session_wait_until <check function> <pid> <name> <log>: polls the check for up to 10 s while the
# process is alive.
session_wait_until() {
  waited=0
  until "$1"; do
    if [ "$waited" -ge 100 ] || ! kill -0 "$2" 2>/dev/null; then
      echo "$3 did not start; see logs/$4" >&2
      return 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
}
