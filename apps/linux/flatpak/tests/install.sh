#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <bundle>" >&2
  exit 2
fi

flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y --noninteractive --bundle "$1"
