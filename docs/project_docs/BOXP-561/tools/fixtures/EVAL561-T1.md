---
id: EVAL561-T1
type: task
status: in-progress
priority: medium
assignee: localllm-coder
reporter: boxp
project: EVAL561
repo: boxp/arch
created: 2026-11-16
tags:
  - ticket
---

# EVAL561-T1: ansible-apply-targets.sh の .yaml 対応を既存テストを残したまま修正する

## Summary

boxp/arch の `.github/scripts/ansible-apply-targets.sh` は `ansible/playbooks/*.yaml` を playbook として受け付けるが、拡張子が `.yaml` の playbook を正しくノードへ対応付けられない。例: 変更ファイル `ansible/playbooks/node-golyat-4.yaml` は `golyat-4` になるべきところ `(no node)` になる（`.yml` では `golyat-4`）。`control-plane.yaml` / `worker-image.yaml` も同様に対象ノードが空になる。`.yml` と `.yaml` で同じ結果になるよう修正する。


## Acceptance Criteria

- 既存の回帰テスト `.github/scripts/ansible-apply-targets.test.sh` に、`.yaml` 拡張子の 3 ケース（`ansible/playbooks/node-golyat-4.yaml` → `["golyat-4"]`、`ansible/playbooks/control-plane.yaml` → `$CP`、`ansible/playbooks/worker-image.yaml` → `$WORKER`）を **追加** し、修正前は fail、修正後は pass になる。
- **既存の `check` 行はすべてそのまま残す**（削除・改名・並べ替えをしない）。現在 45 件ある `check "..."` はすべて残り、追加後は 48 件になる（`grep -c '^check ' .github/scripts/ansible-apply-targets.test.sh` が 48）。
- `bash .github/scripts/ansible-apply-targets.test.sh` が修正後に 56/56 pass（既存 53 + 追加 3）。
- 変更は `.github/scripts/ansible-apply-targets.sh` と `.github/scripts/ansible-apply-targets.test.sh` の 2 ファイルだけ。push・commit・PR 作成はしない（runner が patch を run ディレクトリに隔離する）。
- 最後のメッセージは原因・変更点・修正前後のテスト結果（件数）をまとめ、`TASK_BOARD_RESULT: review` の 1 行で終える。


## Plan

1. `.github/scripts/ansible-apply-targets.sh` と `.github/scripts/ansible-apply-targets.test.sh` を読み、playbook 名からノードを決める処理（`nodes_for_playbook` の `case` にある `control-plane.yml` / `worker-image.yml` / `node-*.yml` と `basename ... .yml`）で `.yaml` が扱われていない箇所を特定する。
2. `grep -c '^check ' .github/scripts/ansible-apply-targets.test.sh` で既存の check 件数（45）を控える。
3. test の fixture に `control-plane.yaml` / `worker-image.yaml` / `node-golyat-4.yaml` を追加し、既存の `check` 行はそのまま残したうえで、末尾付近に `.yaml` の 3 ケースを **追加** する。`bash .github/scripts/ansible-apply-targets.test.sh` を実行し、追加した 3 ケースだけが fail することを確認する（53 pass / 3 fail）。
4. script を最小限修正し（`.yml|.yaml` の両方を受け付ける）、同じテストが 56/56 pass することを確認する。`grep -c '^check '` が 48 であることも確認する。
5. 2 ファイル以外は変更しない。`git checkout` で自分の編集を戻さない。結果（原因・変更点・修正前後の件数）を最後のメッセージにまとめ、`TASK_BOARD_RESULT: review` で終える。


## Notes

作業ログや判断メモを書く。
