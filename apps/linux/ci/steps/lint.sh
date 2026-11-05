#!/bin/sh
set -eu

sh scripts/check-package-lists.sh
cargo fmt --all --check
cargo clippy --workspace --exclude commitnote --all-targets --locked -- -D warnings

if [ -d target/meson/testing ]; then
  meson setup --reconfigure target/meson/testing -Dprofile=development -Dtesting=true
else
  meson setup target/meson/testing -Dprofile=development -Dtesting=true
fi
meson compile -C target/meson/testing cargo-clippy

if [ -d target/meson/plain ]; then
  meson setup --reconfigure target/meson/plain -Dprofile=development -Dtesting=false
else
  meson setup target/meson/plain -Dprofile=development -Dtesting=false
fi
meson compile -C target/meson/plain cargo-clippy
meson test -C target/meson/testing --suite static
