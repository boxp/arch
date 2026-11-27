# BOXP-735: Grok CLI の本人ログインを codex-auth に追加する

## 目的

コハコの X 読み取り連携（公開投稿を出典付きで参照）の検証には、Owner 本人の Grok OAuth ログインが必要。
Owner の依頼「ほかの CLI と同様に codex-auth から認証したい」に従い、BOXP-634 の本人限定ログインページ
（https://codex-auth.b0xp.io）に公式 Grok Build CLI のログインを足す。Pod へ直接 exec してログインする旧案は採らない。

## 変更

- `docker/codex-workspace/Dockerfile`: `@xai-official/grok@1.0.92`（xai-security 配布）を npm global に版固定で導入（`/usr/bin/grok`）。Renovate の管理対象に追加。
- `auth_gateway.bb`: 固定コマンドに `grok login --device-auth` を追加（4 つ目）。
  - 専用の資格情報領域 `$HOME/.grok-x-read`（0700 で作成・既存なら 0700 に締める）を HOME・GROK_HOME・作業フォルダにする。
  - `GROK_TELEMETRY_ENABLED=false`。`CODEX_HOME` は渡さない。API 鍵・トークン系は従来どおり allowlist で落とす（`XAI_API_KEY` の従量課金経路に入らない）。
  - 他 3 CLI の起動内容と環境は変えない。
- `static/index.html`: Grok ボタンと手順。状態確認には Grok が出ないこと、成否は次の確認実行で判断することを明記。
- テスト: 固定コマンド表、Grok の環境と作業フォルダ、専用領域の 0700、既存 CLI の環境が不変、ボタンとコマンド表の一致。smoke test で image 内の `/usr/bin/grok --version`。

## 変えないこと

- Access（Owner email + GitHub IdP）と gateway の JWT 再検証、Origin 検査、排他、無操作/最大時間、ログ方針。
- 汎用シェルを出さない。agent は資格情報を読まない・代理ログインしない。
- Hermes の `xai-oauth` は使わない（既定/補助モデルが変わるおそれ）。lolice の変更なし（image 更新のみ）。

## 確認

- `bb tests/codex-workspace/auth-gateway-test.bb`（先に失敗を確認してから実装）。
- 実物の grok 1.0.92 をゲートウェイの PTY 経由で起動し、デバイス URL 表示・承認待ち・専用領域 0700 を確認（ログインは完了させない）。
- 配備後: Pod の auth-gateway で `/usr/bin/grok` の存在、healthz 200、JWT 無し 403、外部未認証 302 を確認。

## 次

本人がログインした後、BOXP-735 の次 run で専用 GROK_HOME を使い、空の作業フォルダ・ツール制限（CD-01）で公開 X 投稿の取得可否を隔離検証する。ログイン操作の完了だけでは認証済み・ハンドル確定と扱わない。
