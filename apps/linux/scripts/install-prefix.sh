#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
linux_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

profile_dir=dev
profile_args="-Dprofile=development -Dtesting=false"
case "${1:-}" in
  "")
    ;;
  --release)
    profile_dir=release
    profile_args="-Dprofile=release -Dtesting=false"
    ;;
  --testing)
    profile_dir=testing
    profile_args="-Dprofile=development -Dtesting=true"
    ;;
  *)
    echo "usage: $0 [--release | --testing]" >&2
    exit 2
    ;;
esac

"$script_dir/container.sh" sh -eu -c '
  build_dir=target/meson/$1
  if [ -d "$build_dir" ]; then
    meson setup --reconfigure "$build_dir" --prefix=/usr $2
  else
    meson setup "$build_dir" --prefix=/usr $2
  fi
  meson compile -C "$build_dir"
  rm -rf /src/apps/linux/out/prefix
  mkdir -p /src/apps/linux/out/prefix
  meson install -C "$build_dir" --destdir /src/apps/linux/out/prefix
  glib-compile-schemas /src/apps/linux/out/prefix/usr/share/glib-2.0/schemas
' sh "$profile_dir" "$profile_args"

echo "installed: $linux_dir/out/prefix/usr/bin/commitnote"
