# IS01 (Sharp, ARMv7, Debian bookworm / glibc 2.36) 向けクロスビルド用イメージ。
#
# 🚨 cross の既定イメージは glibc の板挟みになる:
#      main (Ubuntu 24.04 / glibc 2.39)  -> 実機で "GLIBC_2.38 not found"
#      0.2.5 (Ubuntu 16.04 / glibc 2.23) -> ホストが古すぎて aws-lc-sys 等の
#                                           build script (x86_64) が動かない
#    Debian bookworm は実機と同じ glibc 2.36 で、ホスト側も十分新しい。
#
# 🚨 code-mode (codex-code-mode-host) は rusty_v8 を要する。rusty_v8 は armv7 の
#    プリビルドを配布していない (404) が、V8 のソースは crate に同梱されており
#    V8_FROM_SOURCE=1 でビルドできる。そのため python3/clang/ninja も入れる。
#    (musl は rusty_v8 が明示的に拒否するので使えない:
#     "musl builds are only supported for x86_64 and aarch64")
#
# 🚨 壁 12: Renovate が Ubuntu 20.04 を 26.04 (resolute) へ更新して glibc と
#    armhf source を壊したため、20.04 の tag/digest 固定を試した。しかし同じ
#    resolute armhf index の 404 が再発し、ベースの版固定だけでは解消しなかった。
#
# 🚨 壁 13: Ubuntu は amd64 と armhf で archive が分かれるため、ベース側の
#    sources.list に別 release が残ると dpkg --add-architecture 後にその armhf
#    index まで取得して 404 になる。既存 source の sed 修正は再発したので廃止し、
#    amd64/armhf を同じ repository から配る Debian bookworm を母体にする。
#    実機と同じ glibc 2.36 なので、壁 3 の実行時互換性も維持できる。
FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
ENV DEBIAN_FRONTEND=noninteractive

RUN dpkg --add-architecture armhf && \
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
