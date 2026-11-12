FROM fedora:45@sha256:a7d72ba2745b100a3351087472e5ee7b2450af7cf331e7673007e3817612839c

COPY build-packages.txt run-packages.txt test-packages.txt /tmp/ci/
RUN dnf install -y --setopt=install_weak_deps=False \
      $(cat /tmp/ci/build-packages.txt /tmp/ci/run-packages.txt /tmp/ci/test-packages.txt) rustup \
    && dnf clean all \
    && rm -rf /tmp/ci

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

COPY rust-toolchain.toml /tmp/toolchain/rust-toolchain.toml
RUN rustup-init -y --no-modify-path --default-toolchain none \
    && channel=$(sed -n 's/^channel = "\(.*\)"/\1/p' /tmp/toolchain/rust-toolchain.toml) \
    && rustup toolchain install "$channel" --profile minimal --component clippy,rustfmt \
    && rustup default "$channel" \
    && rm -rf /tmp/toolchain
