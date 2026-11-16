# BOXP-535: kohako-studio の検証画像を Obsidian へ保存・同期しない運用に変更する

## 背景

- Obsidian Sync の 10GB 枠がほぼ上限。主因は kohako-studio の検証画像・動画が vault に置かれ、同期されていること。
- 2026-11-13 時点の vault 内の画像・動画: `Projects/kohako-openamika-ui` 約4.6GB/3,826件（うち `live2d/k8s-verify` 4.1GB、`boxp476-acting` 4.0GB）、`Projects/kohako-home` 約379MB/1,304件（`verify/` は 435MB で毎日増えている）。
- 生成元は `apps/kohako-studio/verify/*.mjs` などのスクリプト（出力先は引数で指定）。vault に置くかどうかはエージェントが決めていて、Task Board runner のプロンプトにある「Copy to the vault only the evidence that has to be kept.」が vault への保存を促していた。
- Hermes 側は BOXP-497 で `k8s-verify` だけを同期から除外済み。codex-workspace 側には除外設定がない。

## 方針

1. runner のプロンプトを変更する。検証メディアは vault に置かず `/home/boxp/verification-artifacts/<TICKET>/<label>/` に残し、vault には要約とパスだけを書く。チケットが成果物として求める画像は対象外とする。
2. `apps/kohako-studio/verify/README.md` に同じルールを書く。
3. 予防策（runtime 設定、PR 外）: codex-workspace の `ob` 同期設定の `ignoreFolders` に `Projects/kohako-home/verify` と `Projects/kohako-openamika-ui/live2d/k8s-verify` を追加する。既存ファイルは削除しない。BOXP-497 で、除外しても削除は伝播しないことを実証済み。設定は obsidian-sync コンテナの次回起動時に反映される。
4. 既存の画像は削除しない。容量を集計し、安全な整理案を Owner に報告する（削除は別途承認が必要）。

## 確認

- runner のテスト（`test_workspace_reuse` / `test_workspace_reuse_bff_dist`）が通ること。
- 配備後: runner のプロンプトに新しい文言が含まれる。obsidian-sync の起動ログに除外フォルダが表示される。除外フォルダに置いた試験ファイルがリモートへ上がらない。通常のノートは同期される。
