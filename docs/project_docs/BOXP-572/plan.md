# BOXP-572: boxp/arch 全体の shell script に shfmt / ShellCheck の CI を導入する

## 棚卸し (2026-11-16, main e53ce4e8ff)

- 対象: `git ls-files` 上の `*.sh` / `*.bash` 12 ファイル (全て bash shebang)。拡張子なしで shell shebang を持つファイルは無し (他の shebang は `bb` / `python3` のみ)。
- 既存スタイル: 2 スペースインデント。`shfmt -i 2 -ci` で 9 ファイル / 約 145 行の差分。
- ShellCheck v0.11.0 (aqua 管理済み、actionlint 経由で workflow の `run:` を既に検査) で 6 件 (SC2329, SC1091, SC2034, SC2010 x2, SC2086)。
- 範囲外 (理由付き):
  - GitHub Actions の `run:` ブロック: 既存 `actionlint` workflow が ShellCheck を適用済み。
  - Dockerfile の `RUN`: shell script ファイルではなく hadolint 等の別ツールの領域。
  - Ansible の `shell:` / `command:` タスク: 既存 `ansible-lint` の領域。
  - `.bb` / `.py`: 別言語のため対象外。

## 方針

- ツール: shfmt は `mvdan/sh` を aqua (`aqua/imports/shfmt.yaml`) で追加、ShellCheck は既存 `koalaman/shellcheck@v0.11.0` を共用。Renovate は既存の aqua-renovate-config で両方追従。
- 設定共通化:
  - `.editorconfig` の `[*.{sh,bash}]` に `indent_size = 2` / `switch_case_indent = true` を置き、shfmt はこれを読む。
  - `.shellcheckrc` はリポジトリ直下に置き、dialect は shebang に従う。
- 実行スクリプト: `scripts/lint-shell.sh` (ローカル/CI 共通)。`git ls-files` の `*.sh`/`*.bash` と、shell shebang を持つ拡張子なしファイルを対象に `shfmt -d` と `shellcheck` を実行し、どちらかが違反すれば非ゼロ終了。
- CI: `.github/workflows/lint-shell.yaml` を `pull_request` (path filter なし) と main push で実行。permissions は `contents: read` のみ、secrets 不要。
- 既存違反: shfmt で整形し、ShellCheck は意味を理解した最小修正。抑制が必要な場合は行単位の `# shellcheck disable=` / `source=` に理由コメントを付ける。全面 disable はしない。
- 変更所有: BOXP-571 / PR #15170 は `tests/terraform-emulator/**` を追加中。main 未マージのため本 PR では触らず、マージ後は本 CI の対象となる (必要なら追従修正は別 PR)。

## 検証

- RedGreen: 整形崩れ / ShellCheck 違反を一時的に入れて `scripts/lint-shell.sh` が失敗することを確認し、戻して成功することを確認。
- 対象固有テスト: `tests/codex-workspace/*-test.sh` を実行し既存挙動が変わらないことを確認。`bash -n` で全対象の構文確認。
- 実 CI 通過 → 通常 merge → main での workflow 成功と所要時間を報告。
