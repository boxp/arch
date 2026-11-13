# kohako-studio verify scripts

これらのスクリプトは出力先ディレクトリを引数か環境変数で受け取る。

## 検証画像・動画の置き場所（BOXP-535）

- スクリーンショット・録画・フレーム画像・比較画像・音声などの検証メディアは **Obsidian vault に書き込まない・コピーしない**。vault は容量上限（10GB）のある Obsidian Sync へ同期されるため。
- 一時的な出力は Task Board の run workspace（自動で消える）に置く。
- 残す必要がある検証メディアは vault の外の `/home/boxp/verification-artifacts/<TICKET>/<label>/` に置く（codex-workspace の home PVC。自動削除はしない）。
- vault（チケット Notes や `Projects/...` のノート）には、結果の要約（判定・数値・不具合の有無）とそのパスだけを書く。
- 従来の置き場所 `Projects/kohako-home/verify` と `Projects/kohako-openamika-ui/live2d/k8s-verify` は、codex-workspace の Obsidian 同期から除外している。ここに置いたファイルは他の端末へ同期されない。新しいノート（`.md`）もここには置かず、チケットや `Projects/<project>/` 直下に書く。
