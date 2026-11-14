# usability510.mjs（BOXP-510）

`usability510.mjs`（BOXP-510）は token 不要の完全な BFF モックで、PC と Pixel 7 相当の Enter 改行・Shift+Enter 送信、Markdown の安全な描画（script・javascript: リンク・画像を無効化し外部通信 0 件）、本文表示中の利用枠ウィジェット非表示、履歴・受信箱の昇順、背景の動きと OS の reduced-motion・「背景を動かす」OFF での静止を確かめます。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node usability510.mjs /out` を実行します。
