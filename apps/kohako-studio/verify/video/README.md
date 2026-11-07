# 配備済み Web リグの録画と時系列検証（BOXP-441 TD-23）

静止画比較では見えない「動作中の髪のずれ」を、配備されたページそのものを実 Chromium で録画し、
**各 frame の時刻と parameter 値を対応付けて**確認するための道具です。画像生成なし。

## 前提

- 担当コンテナ（codex-workspace の task-board-runner）には Chromium の共有ライブラリが無いので、
  `docker run -d --name b441pw --shm-size=1g -w /work mcr.microsoft.com/playwright:v1.56.1-noble sleep infinity`
  の中で `npm install playwright@1.56.1` して使う（`run.sh` が `docker cp` でスクリプトと成果物を受け渡す）。
- 対象はクラスタ内 Service `http://kohako-studio.kohako-studio.svc.cluster.local`（配備版そのもの）。`H` 環境変数で変更可。
- `studio` シナリオ（実 Hermes 会話）は承認済みの検証 token（codex-workspace の workspace コンテナ
  `/var/run/secrets/kohako-bff-verifier/token`、`run.sh` が ssh で読み `TOKEN_FILE` として渡す）を
  `/kohako/api/` へのリクエストだけに付ける。token は表示・保存しない。
- 画像処理は `jimp`（純 JS、`npm install jimp@0.22`）。MP4 化は Playwright 同梱 ffmpeg に image2 が無いため
  コンテナ内の `apt-get install ffmpeg` を使う。

## 使い方

```
./run.sh kohako-v25 det pc      # 決定論の parameter 軌道（X±30→Y±20→XY→X+HairBack→blink+口、15.5s、behaviors 停止）
./run.sh kohako-v25 nat pc      # 自然動作（behaviors 有効）: 待機4s→考え中6s→発話6s（口パク）→失敗/首振り4s→待機3s
./run.sh kohako-v25 studio pc   # studio.html で実 Hermes 会話（読み上げ off、応答まで最大 90s）
```

未配備の候補を同じページ・同じ軌道で比べるときは `OVERRIDE_P2LRT=/work/<file>.p2lrt ./run.sh kohako-v25 nat pc` のように、
`b441pw` コンテナ内のファイルで指定モデルの p2lrt だけを差し替える（画面表示の版名は指定した既存モデルのまま。出力 dir 名も同じなので実行ごとに移す）。

出力 `out/<model>-<scenario>-<dev>/`: `frames/*.jpg`（CDP screencast、60fps、studio は 30fps）、`frames.json`（frame→ms）、
`trace.json`（描画 frame ごとの parameter 値。`player.draw` を hook）、`events.json`（state 切替・送信などの時刻）、
`meta.json`（読込 p2lrt、画面表示、stage の bbox、viewport、エラー）。時刻は最初の frame を 0 とした ms。

```
node sheet.mjs out/A out/B --from 0.6 --to 2.5 --every 14 --cols 4 --scale 1.4 --crop 0,0.35,1,0.6 --out sheet.png --label v25,v24
node pair.mjs out/A out/B pairs/x --fps 30 --slow 3 --crop 0.3,0.3,0.7,0.55 --scale 1.6 --label v25,v24   # 同時刻の旧新を横並び
ffmpeg -framerate 30 -i pairs/x/%05d.jpg -pix_fmt yuv420p -c:v libx264 -crf 23 out.mp4
```

`--crop` は stage に対する比率 (x,y,w,h)。sheet の各セルに `t=秒 state X Y HB E M` を焼き込む（状態名は ASCII に写す）。
担当（AI）は sheet を画像入力で読み、破綻の時刻と parameter を特定してから、該当区間を `--every 1` で密に見る。

## 既知の限界

- SwiftShader（ソフト描画）なので GPU 固有の描画差は見えない。fps は 60 前後。
- 低い fps で瞬間的な破綻が無いことは保証しない。必要な区間は `--every 1` で全 frame を見る。
- `studio` はページを `http://localhost:8765`（secure context）で開き、全リクエストを `H` へ転送する。クラスタ内 http オリジンのままでは `crypto.randomUUID` が無く送信前に止まる（2026-11-07 まで「応答 timeout」と誤認していた原因）。
- `studio` は Hermes の応答時間に依存する。前の送信が pending のまま（BFF が `busy`）だと新しい送信が進まない。
