FROM fedora:43@sha256:a651ddf48ea28a06ed4e1e6519f51c9f47e7a5a138722ade87369b8fbb7e5b42

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
