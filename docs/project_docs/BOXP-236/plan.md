# BOXP-236: curl/libcurl CVE-2026-92392 の影響棚卸しと修正版反映

作成日: 2026-10-15（claude-fable、Task Board run `20261015T161208Z-742a4999`）。
調査結果・資産別台帳・rollback は Obsidian `Projects/BOXP-236/` が正本。この文書は arch 側の実装範囲だけを記す。

## 脆弱性の要点（vendor 情報）

- 上流 advisory: https://curl.se/docs/CVE-2026-92392.html — HTTP/2 upload 中に server が `RST_STREAM`
  (`HTTP_1_1_REQUIRED` / `REFUSED_STREAM`) を返すと `struct Curl_easy` の use-after-free。影響 8.12.0〜8.22.0、修正 8.23.0（2026-10-14）。
- Debian: https://security-tracker.debian.org/tracker/CVE-2026-92392 — trixie は 8.14.1-2+deb13u7 (DSA-6558-1) で修正。bookworm は該当コードなし。
- Ubuntu: https://ubuntu.com/security/CVE-2026-92392 — 26.04 resolute は 8.18.0-1ubuntu2.8 (USN-8927-1) で修正。24.04 noble (8.5.0) / 22.04 jammy (7.81.0) は not affected。
- 判定は distro の修正版 package 文字列で行い、上流 version 文字列だけでは判定しない。

## 実測で修正が必要になった arch 管理 image

| image | 稼働先 | 実測（before） | 原因 |
|---|---|---|---|
| `ghcr.io/boxp/arch/hermes-agent` | lolice `hermes-agent`（hermes-agent / obsidian-sync の 2 container） | Debian trixie、curl/libcurl4t64/libcurl3t64-gnutls = 8.14.1-2+deb13u3 | 上流 `nousresearch/hermes-agent` の pinned digest に同梱。加えて main の Dockerfile は babashka 1.13.226 の SHA256 が誤りで build 自体が失敗中（run 38645655799） |
| `ghcr.io/boxp/arch/llama-sycl` | lolice `local-llm/llama-server`（digest 固定 `836a64…`） | Ubuntu 26.04、2026-08-02 build（revision 2919ce6）、curl 8.18.0-1ubuntu2.3（`docker pull` で実測）。`llama-server` は libcurl を動的リンク | 2026-10-01 の `latest` も USN 前の build。base digest が 2026-06 時点のまま |
| `ghcr.io/boxp/arch/llama-vulkan` | cluster 内消費者なし（publish のみ） | 同上（2026-10-01 build） | 同上。ただし **このPRでは更新しない**（下記） |
| `ghcr.io/boxp/arch/sdnext-ipex` | lolice `stable-diffusion`（replicas 0） | Ubuntu 26.04、2026-06-30 build | 同上。ただし **このPRでは更新しない**（下記） |

修正不要と実測で確認したもの（詳細は Obsidian 台帳）: 7 ホスト（jammy 7.81.0 / noble 8.5.0）、`codex-workspace`
（2026-10-14 22:09 build、8.18.0-1ubuntu2.8 済）、`arc-runner`（actions-runner 2.335.1 = jammy）、lolice の `curlimages/curl` initContainer
（lolice PR #831 で 8.23.0 済、稼働 pod も 8.23.0）、GPU worker image / Orange Pi image（noble）、codex-armv7 / yazi-armv7（bookworm、build 専用）。

## 変更内容（このPR）

1. `docker/hermes-agent/Dockerfile`
   - `BABASHKA_SHA256` を 1.13.226 の実 tarball の値 `bf89e909…` に修正（main の build 失敗を解消。GitHub release の `.sha256` と一致確認済み）。
   - upstream digest は据え置き（Hermes 本体の更新は本票の範囲外）、代わりに Debian archive から curl / libcurl4t64 / libcurl3t64-gnutls だけを
     `--only-upgrade` し、`dpkg --compare-versions ... ge 8.14.1-2+deb13u7` で修正版が入らなければ build を失敗させる。
2. `docker/llama-sycl/Dockerfile`
   - `ubuntu:26.04` / `ubuntu:resolute` の base digest を現行 `sha256:f144425f…`（2026-10-04）に更新。これにより main merge で再 build が走り、
     runtime stage の `apt-get install curl` が USN-8927-1 の 8.18.0-1ubuntu2.8 を取り込む。
   - llama.cpp の ref、build flag、依存 package は変更しない。
3. `docker/llama-vulkan/Dockerfile` は **変更しない**（更新不能）。PR 内で digest 更新を試したが、builder stage で `libggml-vulkan.so` の link が
   `undefined reference to matmul_id_subgroup_*` で失敗する（run 38769600111）。pinned fork ref `a33ef00b`（TheTom/llama-cpp-turboquant）と
   現行 resolute archive の shader toolchain の不整合とみられ、修正には llama.cpp ref / toolchain の変更が必要で本票の範囲外。cluster 内に消費者はない。
4. `docker/sdnext-ipex/Dockerfile` は **変更しない**（更新不能）。PR 内で digest 更新を試したが、SD.Next の installer が
   Ubuntu 26.04 の Python 3.14.4 を拒否して build が失敗する（`Python: version=3.14.4 required=3.[10, 11, 12, 13]`）。これは 2026-10-01 以降の
   main の build も同じ理由で失敗しており本票以前からの既存破損。修正には SD.Next ref / Python 版の変更が必要で本票の範囲外。
   消費者 `stable-diffusion` は replicas 0 で稼働していないため、暫定策は「build を直すまで scale up しない」。

## 反映経路と検証

- PR の CI: 各 `build-*-image.yml` が pull_request で build（push なし）。merge 後に main で build + push（tag: `sha-<short>` / `latest` / 日時）。
- hermes-agent: lolice の ImageUpdater（`newest-build`）が `sha-` tag を write-back → pod 置換。置換後に `kubectl exec` で
  `dpkg-query -W curl libcurl4t64 libcurl3t64-gnutls` が `8.14.1-2+deb13u7` 以上であることを確認。Hermes 置換前に Obsidian へ結果を永続化する。
- llama-sycl: lolice は `.argocd-source-local-llm.yaml` で digest 固定（BOXP-183 の SIGILL 回帰で rollback 済み、ImageUpdater なし）。
  新 digest は lolice 側の別 PR で明示 pin し、起動 / `/health` / 推論 1 件で確認。失敗時は同ファイルを revert して `836a64…` に戻す。
- sdnext-ipex / llama-vulkan: 更新不能（上記）。sdnext は replicas 0 を維持、llama-vulkan は消費者なし。publish 済み旧 image を使わないこと。
- 検証は `docker pull` した publish 済み image の `dpkg-query` と、稼働 pod の `imageID` 照合で行う。PoC / 悪意ある RST の再現はしない。

## やらないこと

- Hermes 上流 image の version 更新、OS major 更新、無関係 package の全体 upgrade、hosts の apt upgrade（not affected のため）。
- codex-workspace image の再 build（稼働 image が修正済み。次回の通常 build で base digest も追従する）。
- 全台同時再起動、他 run の停止、Secret の参照。
