# Vendored libwebp

WebP codec library (`webmproject/libwebp`), release tag `v1.6.0`.

Source tarball: `https://github.com/webmproject/libwebp/archive/refs/tags/v1.6.0.tar.gz`
SHA-256 of the tarball: `93a852c2b3efafee3723efd4636de855b46f9fe1efddd607e1f42f60fc8f2136`

Only the files needed for encoding and decoding are copied, unmodified:
all `.c` and `.h` files of `src/enc/`, `src/dec/`, `src/dsp/`, `src/utils/` and `sharpyuv/`;
`src/webp/decode.h`, `src/webp/encode.h`, `src/webp/format_constants.h`, `src/webp/mux_types.h`,
`src/webp/types.h`; and `COPYING` and `PATENTS`.

`mux`, `demux`, `extras`, examples and build files are not included. `HAVE_CONFIG_H` is left
undefined, so `src/webp/config.h` is not needed. `sharpyuv/sharpyuv_cpu.c` includes `src/dsp/cpu.c`,
as upstream does.
