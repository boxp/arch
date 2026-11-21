# retention647-static.mjs（BOXP-647）

保持検証用の静的配信ヘルパー。呼び出し元は `127.0.0.1` に bind する。デコード前後のパスと実体パスを検査し、SITE 外への参照を拒否する。回帰確認は `node retention647-static-test.mjs`。
