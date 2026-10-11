FROM ubuntu:22.04@sha256:5ec03bb3441e8b0bf3b4f9cd4629a1ae763010dc3035bb8da3ae6cf026486401

COPY install-build-deps.sh rust-toolchain.toml /tmp/build-deps/
RUN sh /tmp/build-deps/install-build-deps.sh /tmp/build-deps/rust-toolchain.toml && rm -rf /tmp/build-deps

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
