# retention647-static-test.mjs（BOXP-647）

`node apps/kohako-studio/verify/home/retention647-static-test.mjs` で現在の作業ディレクトリ配下に一時ディレクトリを作成し、検証用サーバーを起動し、実 HTTP で正常ファイル、traversal、壊れた URI、シンボリックリンクと loopback bind を確認する。一時ディレクトリは終了時に削除する。run の worktree 内で実行する。Playwright や実 API は不要。
