# BOXP-273: Worker image build workflow の GPU 専用名称を一般 worker 名へ整理する

チケット: BOXP-273（Owner 承認済み。BOXP-269 で pipeline が全 golyat worker 共通になったため、GPU 専用の名前を一般 worker 名に揃える）。
設計・証拠の正本は Obsidian `Projects/BOXP-273/README.md`。本ファイルは実装計画と安全境界の記録。

## 範囲

変更するもの（表示名・ファイル名・説明文のみ）:

| 項目 | 旧 | 新 |
|---|---|---|
| Actions 表示名 (`name:`) | `Build GPU Worker Image` | `Build Worker Image` |
| workflow ファイル | `.github/workflows/build-gpu-worker-image.yml` | `.github/workflows/build-worker-image.yml` |
| `node_name` 入力の説明 | `GPU worker node name` | `Worker node name` |

変更しないもの（意味が正しい、または挙動に関わるため）:

- `install_gpu_host_tools` 入力（名前・choice・既定 `auto`）と GPU auto 条件
- 実行処理（steps / run の内容）、対象ノード、`runner` 入力と既定 `arc-runners-arch`、`timeout-minutes: 120`、`permissions`
- S3 bucket `arch-gpu-worker-images`、`images/<node>/latest.*` ポインタ、`images/artifacts/<node>/` の artifact 名
- IAM role `GitHubActions_GPUWorkerImage_Build`（trust は `repo:boxp/arch:*` で workflow パス非依存。権限変更不要）
- `scripts/images/build-gpu-worker-image.sh` / `verify-gpu-worker-image*.sh`、`gpu_worker_host_tools` role、terraform `gpu-worker-images` の名前
- step 名 `Build GPU worker image` と summary 見出し `## GPU Worker Image`（本票の対象外。残す理由: 表示専用で、変更範囲をチケット指定の 3 点に限定するため。必要なら別途）

## 参照の棚卸しと整合

現行コードで旧ファイル名を参照していた箇所（すべて更新）:

1. `ansible/tests/test_worker_nodes.py` の `BUILD_WORKFLOW` パス
2. `.github/scripts/ansible-apply-targets.test.sh` の BOXP-269 P0 ガード file set
3. `.github/workflows/actions.lock`（`gh actions-lock --no-interactive --no-narrow --no-migrate-local-actions` で再生成。差分はキー rename のみ）
4. `scripts/images/verify-gpu-worker-image-s3.sh` 先頭コメント
5. `docs/GPU_WORKER_IMAGE_DEPLOYMENT.md` の `gh workflow run` 例（新旧対応の注記を追加）

履歴として残すもの（改竄しない）:

- `docs/project_docs/BOXP-23-*/plan.md`、`docs/project_docs/BOXP-269/plan.md` の旧名（当時の記録）
- Obsidian の過去 run リンク・evidence（`Build GPU Worker Image` run 番号など）。現行入口（Projects/BOXP-269 migration-plan、Projects/BOXP-272 README、BOXP-235 README の onboard 表）には新旧対応の注記を添える。

## 推移的影響の確認

- `build-worker-image.yml` は `workflow_dispatch` のみ。rename の merge で image build / S3 更新は起きない。
- `ansible/tests/test_worker_nodes.py` と `.github/scripts/ansible-apply-targets.test.sh` の変更は `apply-ansible.yml` の `push` paths に該当するため、merge 後に `Apply Ansible` の `select-targets` job が起動する。`ansible-apply-targets.sh` の規則では `ansible/tests/**` と `ansible/` 外は「対象なし」に解決され、`apply` job は起動しない（`[]`）。merge 後に実際の run で確認する。
- `test.yaml` の path-filter で `test-ansible`（unittest）が PR で走る。`actionlint` / `actions-lock-verify` も paths 該当で走る。
- 旧名で GitHub 上の workflow を参照している自動化（Renovate、lolice、cron）は無いことを grep で確認（lolice 側は `arc-runners-arch` runner scale set を提供するだけで workflow 名に依存しない）。

## 検証

- `actionlint .github/workflows/build-worker-image.yml`
- `gh actions-lock --verify --no-interactive`
- `cd ansible && uv run python -m unittest discover -s tests -p 'test_*.py'`
- `.github/scripts/ansible-apply-targets.test.sh`
- `shellcheck scripts/images/verify-gpu-worker-image-s3.sh .github/scripts/ansible-apply-targets.test.sh`
- `git diff -M main -- .github/workflows/build-worker-image.yml` が rename + 2 行（`name:` と description）のみであること（jobs 以下は byte 単位で同一）
- `git grep build-gpu-worker-image.yml` の残存が履歴 docs（`docs/project_docs/BOXP-23-*`, `BOXP-269`）とこの plan の新旧対応のみであること

## 未実施（本票で意図的にやらないこと）

- image build の dispatch、S3 更新、実機 Apply / first boot / flash（BOXP-269 未承認事項）
- BOXP-272 の arc-runners-arch 実 job 観測（次の通常 build 待ちを維持）
- step 名・summary 見出し・script / bucket / role の rename
