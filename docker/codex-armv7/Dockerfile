# IS01 (Sharp, ARMv7, Debian bookworm / glibc 2.36) 向けクロスビルド用イメージ。
#
# 🚨 cross の既定イメージは glibc の板挟みになる:
#      main (Ubuntu 24.04 / glibc 2.39)  -> 実機で "GLIBC_2.38 not found"
#      0.2.5 (Ubuntu 16.04 / glibc 2.23) -> ホストが古すぎて aws-lc-sys 等の
#                                           build script (x86_64) が動かない
#    Ubuntu 20.04 は glibc 2.31。実機の 2.36 に載りつつ、ホスト側も十分新しい。
#
# 🚨 Ubuntu の armhf パッケージは archive.ubuntu.com ではなく ports.ubuntu.com
#    にある。素の sources.list のままだと 404 になるので向け直す。
#
# 🚨 code-mode (codex-code-mode-host) は rusty_v8 を要する。rusty_v8 は armv7 の
#    プリビルドを配布していない (404) が、V8 のソースは crate に同梱されており
#    V8_FROM_SOURCE=1 でビルドできる。そのため python3/clang/ninja も入れる。
#    (musl は rusty_v8 が明示的に拒否するので使えない:
#     "musl builds are only supported for x86_64 and aarch64")
#
# 🚨 壁 12: Renovate が 20.04 を 26.04 (resolute) へ更新すると、glibc 2.43
#    になって壁 3 の実機互換性を壊すうえ、focal armhf 用 sources.list と混在して
#    resolute の armhf index を archive/security.ubuntu.com へ取りに行き 404 になる。
#    20.04 の digest に固定し、Renovate 側でもこの Dockerfile だけ tag を制限する。
FROM ubuntu:20.04@sha256:8feb4d8ca5354def3d8fce243717141ce31e2c428701f6682bd2fafe15388214
ENV DEBIAN_FRONTEND=noninteractive

RUN sed -i 's|^deb http|deb [arch=amd64] http|' /etc/apt/sources.list && \
    printf '%s\n' \
      'deb [arch=armhf] http://ports.ubuntu.com/ubuntu-ports focal main universe' \
      'deb [arch=armhf] http://ports.ubuntu.com/ubuntu-ports focal-updates main universe' \
      > /etc/apt/sources.list.d/armhf.list && \
    dpkg --add-architecture armhf && \
    apt-get update && \
    apt-get install --assume-yes --no-install-recommends \
      gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf libc6-dev-armhf-cross \
      libssl-dev:armhf pkg-config \
      build-essential ca-certificates curl xz-utils git \
      python3 clang lld ninja-build cmake && \
    rm -rf /var/lib/apt/lists/*

ENV CARGO_TARGET_ARMV7_UNKNOWN_LINUX_GNUEABIHF_LINKER=arm-linux-gnueabihf-gcc \
    CC_armv7_unknown_linux_gnueabihf=arm-linux-gnueabihf-gcc \
    CXX_armv7_unknown_linux_gnueabihf=arm-linux-gnueabihf-g++ \
    PKG_CONFIG_ALLOW_CROSS=1 \
    PKG_CONFIG_PATH=/usr/lib/arm-linux-gnueabihf/pkgconfig
