#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
linux_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

testing_args=-Dtesting=false
case "${1:-}" in
  "")
    ;;
  --testing)
    testing_args=-Dtesting=true
    ;;
  *)
    echo "usage: $0 [--testing]" >&2
    exit 2
    ;;
esac

build_dir=$linux_dir/_build
prefix=$linux_dir/out/host-prefix

# shellcheck disable=SC2086
if [ -d "$build_dir" ]; then
  meson setup --reconfigure "$build_dir" "$linux_dir" --prefix=/usr -Dprofile=development $testing_args
else
  meson setup "$build_dir" "$linux_dir" --prefix=/usr -Dprofile=development $testing_args
fi
meson compile -C "$build_dir"
rm -rf "$linux_dir/out/host-prefix"
mkdir -p "$prefix"
meson install -C "$build_dir" --destdir "$prefix"
glib-compile-schemas "$prefix/usr/share/glib-2.0/schemas"

exec "$script_dir/run-installed.sh" "$prefix"
