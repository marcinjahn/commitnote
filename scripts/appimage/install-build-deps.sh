#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <path to rust-toolchain.toml>" >&2
  exit 2
fi

toolchain_file=$1
node_version=v26.10.0

rust_channel=$(sed -n 's/^channel *= *"\([^"]*\)".*/\1/p' "$toolchain_file")
if [ -z "$rust_channel" ]; then
  echo "no channel found in $toolchain_file" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
# Rootless docker usually cannot switch to the _apt sandbox user.
apt_options="-o APT::Sandbox::User=root"
# shellcheck disable=SC2086
apt-get $apt_options update
# shellcheck disable=SC2086
apt-get $apt_options install -y --no-install-recommends \
  build-essential curl wget file git ca-certificates pkg-config xz-utils \
  libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev libxdo-dev \
  patchelf desktop-file-utils appstream zsync
rm -rf /var/lib/apt/lists/*

work_dir=$(mktemp -d)
node_archive="node-$node_version-linux-x64.tar.xz"
curl -fsSLo "$work_dir/$node_archive" "https://nodejs.org/dist/$node_version/$node_archive"
curl -fsSLo "$work_dir/SHASUMS256.txt" "https://nodejs.org/dist/$node_version/SHASUMS256.txt"
(cd "$work_dir" && grep " $node_archive\$" SHASUMS256.txt | sha256sum -c -)
tar -xJf "$work_dir/$node_archive" -C /usr/local --strip-components=1 --no-same-owner \
  --exclude CHANGELOG.md --exclude LICENSE --exclude README.md
rm -rf "$work_dir"

export RUSTUP_HOME=/usr/local/rustup
export CARGO_HOME=/usr/local/cargo
curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs |
  sh -s -- -y --no-modify-path --profile minimal --default-toolchain none
"$CARGO_HOME/bin/rustup" toolchain install "$rust_channel" --profile minimal --component clippy
"$CARGO_HOME/bin/rustup" default "$rust_channel"
chmod -R a+rwX "$RUSTUP_HOME" "$CARGO_HOME"

node --version
"$CARGO_HOME/bin/cargo" --version
