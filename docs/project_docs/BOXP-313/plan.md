# BOXP-313: Hermes 本体を v0.22.5 へ更新し Renovate で継続更新できるようにする

## 背景

- `docker/hermes-agent/Dockerfile` の base は 2026-07-08 から
  `nousresearch/hermes-agent@sha256:94f90d3c…`（Hermes 0.18.0、amd64 platform manifest digest、tag 無し）に固定されていた。
- tag が無いため Renovate の dockerfile manager は version lookup ができず、Dependency Dashboard（#18）で
  `Updates: undefined` と表示され、更新 PR が一度も作られなかった。
- BOXP-312 で、cron → Task Board 取次ぎコマンド中の日本語文末 `。`（U+3002）が ASCII 英字に隣接すると
  旧版同梱の tirith scanner（`confusable_text`）が誤検知し、承認者不在の cron では約 301s 後に BLOCKED になることを特定済み。
  上流 Hermes は v0.22.0 で tirith を core から削除している。

## 一次資料で確認した上流の現状（2026-10-26）

| 項目 | 値 |
|---|---|
| 最新安定版 | v0.22.5（GitHub release 2026-10-23、prerelease/draft でない） |
| Docker Hub `nousresearch/hermes-agent:v0.22.5` | index digest `sha256:9c5561579f3ffdf333401797094ac3a743738d6c25d40f4331c7bf77b694238d`、linux/amd64 + linux/arm64、`stable`/`latest` と同一 digest |
| 出自 | annotated tag `v0.22.5` のメッセージに `dockerManifestDigest` として同じ digest が記録されている（commit `bf0203a7`） |
| 公式 docs | docker ガイド: 「`X.Y.Z` は versioned stable image。正確な配備 pin には digest を使う」 |
| Docker Hub の他 tag | 旧い日付形式 `v2026.9.24` 等（0.18〜0.21 時代）、`rc.N-v0.22.x`、`*-desktop`、`main` |

## 方針

1. **FROM を「安定版 tag + multi-arch index digest」にする**
   `FROM docker.io/nousresearch/hermes-agent:v0.22.5@sha256:9c5561…`
   dockerfile manager が version（tag）と digest の両方を追える形。`latest` へ変える／digest を外すだけの対応はしない。
2. **Renovate packageRule を追加**（`renovate.json5`）
   - `allowedVersions: /^v?0\.[0-9]+\.[0-9]+$/` で `v0.MINOR.PATCH` 形式の安定版 tag だけを候補にする
     （docker versioning では `v2026.9.24` が major 2026 として「最新」に見えるため）。
   - `automerge: false` + `manual-review-required` ラベル（config 自動移行や起動方式変更を伴い得る）。
3. **独自 patch の棚卸し**
   - `add-webhook-mirror-to-session.py`（BOXP-270 backport）: 上流 `gateway/platforms/webhook.py` に `mirror_to_session` が取り込まれているため削除。Dockerfile で存在を grep で検証。
   - `fix-scheduler-network-unreachable.py`（BOXP-137）: 上流 v0.22.5 は ENETUNREACH を共有 classifier で timeout 扱い（通知文 "the AI model service did not respond in time"）にするため依然必要。
     `_summarize_cron_failure_for_delivery` の新 shape（provider 分類の直前）に適合して維持。
4. **Dockerfile のその他の追従**
   - PATH は上流順（shim → venv → pm 管理の node/python symlink）を保ち obsidian-headless だけ先頭に追加。venv が `/usr/local/bin` より前に無いと `python3` が依存なしの素の pm interpreter になる。
   - curl CVE-2026-92392 / emSign CA（BOXP-236/259）は新 base で解決済み。パッケージ更新はせず、退行したらビルドが落ちる検証のみ残す。
   - obsidian-headless / Babashka（version + sha256）は据え置き。ビルド内で `ob --version` / `bb --version` を確認。
5. **lolice 側の追従**（`argoproj/hermes-agent/deployment.yaml`）
   - init container の BOXP-270 config 追記スクリプトが `import yaml`（PyYAML）前提。v0.22.x の venv は ruamel.yaml（`hermes_yaml`）のみなので、PyYAML → ruamel の fallback を入れる。旧 image でも動く（先に merge して image 到着に備える）。
   - それ以外の env（`HERMES_UID/GID`、`HERMES_DASHBOARD*`、`API_SERVER_ENABLED`、`HERMES_WRITE_SAFE_ROOT`）は v0.22.5 でも有効。

## 新版での security / approval の変化

- tirith は削除（config v50 で `security.tirith_*` を自動削除、代替設定なし）。PVC 上の `/opt/data/bin/tirith` は呼ばれなくなる（残置、害なし）。
- core の `tools/approval_detection.py` が command 文字列を検査: 危険 command パターンに加えて
  **invisible / bidirectional Unicode 制御文字**（U+200B/200C/200E/200F/202A–202E/2060–2064/2066–2069/FEFF 等）と
  **credential upload**（秘密ファイル／秘密変数を `curl -d`/`--data`/`-F` 等で送る、秘密ファイルを `curl|wget` に pipe）を承認対象にする。
- Cyrillic/Greek/数学英数字などの homoglyph 検出は core に無い（上流 docs 明記）。tirith 時代より検出範囲は狭くなる。
- approvals 既定（manual、cron deny）は変更しない。YOLO / allowlist 拡大 / cron autoapprove は使わない。

## 検証

- ローカル build（legacy builder）: `boxp313-hermes-agent:test`。entrypoint（s6-overlay /init、HERMES_UID=1000/GID=10000 remap）で `hermes --version` → `Hermes Agent v0.22.5 (2026.9.24) · upstream bf0203a7`。
- patch 単体: ENETUNREACH 文字列 → 「network unreachable (ENETUNREACH)」、ReadTimeout → 既定の provider 文面、Script timed out → 既定の script 文面。
- BOXP-312 fixture 110 件を `detect_dangerous_command` に**文字列として**通す（実行しない）: ASCII 0/7、日中韓 1/93（唯一の 1 件は `python3 -c` の "-e/-c flag" ルールで `。` とは無関係）、真正脅威対照 4/10（bidi/zero-width/curl|sh は検出、homoglyph 4 件は仕様どおり未検出）。BOXP-310 の実 command（U+3002 含む 1069 文字）は `(False, None, None)`。
- Renovate（44.181.11、`--platform=local`、dockerfile manager 限定）:
  - 変更前: `currentDigest` のみ、`currentValue` 無し。lookup は `latest` の amd64 digest への "digest" 更新を提案し、release timestamp 不明で pending 扱い → 版は追えない。
  - 変更後: `currentValue: v0.22.5`、`currentDigest: sha256:9c5561…`、`versioning: docker`、`updates: []`（最新）。`v2026.x` は skip。
  - 候補注入（別 copy で v0.22.4@digest に下げる）: v0.22.5 への更新 branch 生成を確認（evidence 参照）。

## ロールアウト

1. lolice PR（init container fallback）→ merge → Argo sync（Pod 再作成は不要、次回起動から有効）。
2. arch PR → CI（image build / renovate-config-validator）→ merge → `Build Hermes Agent Image` が `ghcr.io/boxp/arch/hermes-agent:sha-<short>` を push → argocd-image-updater（newest-build）が lolice `.argocd-source-hermes-agent.yaml` を書き戻し → Argo sync → Pod Recreate（短い gateway 再起動）。
3. 起動時に `docker_config_migrate.py` が `config.yaml` を v33 → v51 へ自動移行（`backups/config/` に pre-docker-migrate backup）。state.db は schema 追加のみで `sessions.auto_prune` 既定 false（履歴削除なし）。
4. 事前に PVC 内 `backups/pre-v0.22.5-<ts>/` へ config.yaml / .env / auth.json / cron/jobs.json / webhook_subscriptions.json / SOUL.md / state.db（sqlite online backup）を退避し、integrity_check で restore 可能性を確認。

## ロールバック

- image: lolice `.argocd-source-hermes-agent.yaml` を旧 `sha-3142bf4` に戻す（または arch の FROM を戻して再 build）。
- config: 旧 0.18.0 は `_config_version: 51` の config を読めるが未知キーは無視し、移行で削除された `security.tirith_*` は既定（tirith 有効）に戻る。確実には `backups/pre-v0.22.5-<ts>/config.yaml`（または `backups/config/` の pre-docker-migrate）を戻す。
- state.db: 新版が追加した table/column は旧版に無害だが、新版で作られたセッション行の互換は保証されない。問題時は `backups/pre-v0.22.5-<ts>/state.db` を戻す（新版稼働中に書かれた会話/cron 履歴は失われる）。
- lolice init container の fallback は旧 image でも動くため戻す必要なし。

## スコープ外

- 全体 Renovate 監視漏れの定期棚卸し、広範パッケージ更新、automerge 方針変更、認証再発行、他サービス更新。
