# codex armv7 Ubuntu 20.04 固定の修正計画

## 背景

`docker/codex-armv7/Dockerfile` は IS01 の glibc 2.36 との互換性を保つため Ubuntu 20.04 (glibc 2.31) を前提にしている。しかし Renovate が base image の tag を Ubuntu 26.04 (resolute) へ更新し、focal armhf 用 apt source と混在した。結果、存在しない resolute armhf index を `archive.ubuntu.com` と `security.ubuntu.com` から取得しようとして `apt-get update` が 404 で失敗した。

## 方針

- Dockerfile の base image を、Ubuntu 20.04 を導入した既存 commit で pin 済みの digest に戻す。
- Renovate は当該 Dockerfile の `ubuntu` tag を `20.04` のみに制限し、glibc と apt source の前提を維持する。
- Ubuntu 20.04 の digest 更新は許可し、同一 tag 内の image 更新を妨げない。
- code-mode、`codex-code-mode-host`、`V8_FROM_SOURCE=1`、および既存の壁 1〜11 の対処には変更を加えない。

## 検証

1. Docker image をビルドし、native/armhf の apt source が混在せず必要な cross toolchain を導入できることを確認する。
2. Docker image 内の glibc が 2.31 であることを確認する。
3. actionlint（shellcheck 有効）と ghalint を実行する。
4. V8 全体のクロスビルドや GitHub Actions run の監視は行わない。
