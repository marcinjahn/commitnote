#!/bin/sh
set -eu

# gnome-keyring-daemon does not create missing parent directories, so it gets existing ones for its
# control socket and its login keyring.
keyring_home=$(mktemp -d)
mkdir -m 0700 "$keyring_home/runtime" "$keyring_home/data"
echo "" | XDG_RUNTIME_DIR="$keyring_home/runtime" XDG_DATA_HOME="$keyring_home/data" \
  gnome-keyring-daemon --unlock --components=secrets >/dev/null
# The daemon claims its bus name after it returns; a client arriving earlier would
# make D-Bus activate a second, locked keyring daemon.
gdbus wait --session --timeout 10 org.freedesktop.secrets
