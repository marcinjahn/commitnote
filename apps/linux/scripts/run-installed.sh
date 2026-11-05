#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ "$#" -gt 0 ] && [ -d "$1" ]; then
  prefix=$(CDPATH= cd -- "$1" && pwd)
  shift
else
  prefix=$(CDPATH= cd -- "$script_dir/.." && pwd)/out/prefix
fi

binary=$prefix/usr/bin/commitnote
if [ ! -x "$binary" ]; then
  echo "run install-prefix.sh first" >&2
  exit 1
fi

GSETTINGS_SCHEMA_DIR=$prefix/usr/share/glib-2.0/schemas \
XDG_DATA_DIRS=$prefix/usr/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share} \
  exec "$binary" "$@"
