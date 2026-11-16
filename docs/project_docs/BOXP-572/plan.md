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

## 追記 (2026-11-16, main 6d4fd04c7d へ rebase 後)

- rebase 後の対象は 143 ファイル (`kohako-studio` の rig 78 本などが追加されていた)。shfmt の差分は 122 ファイル、ShellCheck の指摘は 426 件 (SC2086 297 / SC1010 60 ほか)。
- 拡張子なしの shell shebang ファイル (`ansible/tests/fixtures/pre_check_ready/{fake-sudo,kubectl}`) には `.editorconfig` の glob が当たらない。このため `scripts/lint-shell.sh` で `shfmt -i 2 -ci` を明示している (値は `.editorconfig` と同じ)。
- 除外: `docker/codex-workspace/task-board/harness-eval-tasks/`。評価課題の固定入力で、base には意図的な不具合がある (T02 はクォート漏れを直す課題)。また `harness_eval.bb` は配下の全ファイルの内容から課題の版を計算するため、ここを変更すると過去の評価結果と比較できなくなる。
- 是正の方針:
  - SC2086: 値が単一トークンかパスのものは ShellCheck の自動修正でクォートした。意図的に word splitting させている `LAB_RUN_ARGS` と `ARM_CFLAGS` は、理由付きの行単位 disable にした。
  - SC1010: 引数として渡している `done` をクォートした。
  - SC2100: `reason=nested-checkout` を引き算と誤読する誤検知なので、値をクォートした。
  - SC2015: `A && ok || fail` の形を if/else に書き換えた。
  - SC2251: `! grep -q` は set -e では失敗にならず、検査として働いていなかった。if で FAIL として exit するように直した。
  - SC2329: `task-board-runner-test.sh` で同名関数が二重に定義され、先の定義が死にコードになっていた。後の定義だけを残した。
  - SC2094: 同じファイルを読みながら追記していた箇所を、読んでから追記する形に変えた。
  - SC2143: grep -q に変えると pipefail 下で SIGPIPE による偽の合格が起こりうるため、理由付きの disable にした。
  - SC2016 / SC2012 / SC2088 / SC2319 / SC2043 は、意図を確認したうえで理由付きの行単位 disable にした。
