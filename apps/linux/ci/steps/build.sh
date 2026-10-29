#!/bin/sh
set -eu

cargo build --workspace --exclude commitnote --all-targets --locked

if [ -d target/meson/testing ]; then
  meson setup --reconfigure target/meson/testing -Dprofile=development -Dtesting=true
else
  meson setup target/meson/testing -Dprofile=development -Dtesting=true
fi
meson compile -C target/meson/testing
