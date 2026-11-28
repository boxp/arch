# tidy764-frames.mjs（BOXP-764）

手を前でそろえるしぐさの試作候補 `tidy-5ba170b` を、同じ版の `?tidy=old`（通常版の形）と並べて見るための道具です。BFF は完全にモック（token 不要）、時計を止めて進めます。

- 準備: 候補のタグの `web/` を `npx vite build --base /kohako/ --outDir <dist>/kohako`。Playwright 1.56.1 のサーバー（コンテナ `mcr.microsoft.com/playwright:v1.56.1-noble` で `npx playwright run-server --port 39694 --host 127.0.0.1`、`--network host`）。`PW_WS` で接続先を変えられます。
- `tidy764-frames.mjs <dist>/kohako <outdir> '<query>' <秒>`: 手そろえを始めた時刻から、1/30 秒ずつ時計を進めて全身の範囲を JPEG に書き出します。30fps で並べると通常速度の動画になります（この環境はソフトウェア描画で、生の録画は 2fps ほどしか出ないため）。`MOUSE_AT=秒` で途中にマウスを動かします（中断の確認）。`events.json` に、しぐさ・腕セット・フェードの状態が替わったコマの秒を書きます。
- 動画: `ffmpeg -framerate 30 -i <outdir>/%05d.jpg -pix_fmt yuv420p -c:v libx264 -crf 26 out.mp4`。並べる時は `hstack`。
- 検証メディアは vault に置きません（`/home/boxp/verification-artifacts/<TICKET>/<label>/`）。
