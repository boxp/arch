# BOXP-634: スマートフォンから Cloudflare 経由で AI CLI を本人認証・再認証できる導線

## 目的

手元から codex-workspace へ SSH できなくても、Owner がスマートフォンのブラウザだけで
Antigravity CLI (agy) の初回ログインと、Claude Code / Codex CLI の再ログインを行えるようにする。

## 方式の判断

| 案 | 判断 |
|---|---|
| Cloudflare ブラウザ SSH (Access の browser rendering) | 不採用。汎用シェルをインターネット側へ出すことになり、短命証明書の principal 対応 (email → boxp) と sshd 変更も要る。スマホで折り返した長い OAuth URL をターミナルから拾うのも難しい。 |
| **限定認証ページ (採用)** | 起動できるのは固定のログインコマンド 3 つだけ。URL をリンク一覧として表示し、認可コードは貼り付け欄から CLI へ直接渡す。 |

各 CLI の公式ログイン手段 (2026-11-19 に image の版で確認):

- Antigravity `agy` 1.5.12: login 専用 subcommand は無く、未ログインで対話起動すると
  「1. Google OAuth」を選ぶ TUI → URL (OSC 8 hyperlink) → 認可コード貼付。端末エミュレーションが必要。
- Claude Code 2.1.325: `claude auth login --claudeai`（サブスクリプション。`--console` = API 課金は使わない）。
- Codex 0.169.0: `codex login --device-auth`（localhost callback 不要のデバイスコード方式）。

## 構成

```
スマホ ─HTTPS→ Cloudflare Access (Owner email AND GitHub IdP, 1h, binding cookie)
       → 既存 k8s トンネル cloudflared (Access JWT/AUD 必須)
       → Service codex-auth-gateway:8095 (NetworkPolicy: k8s/cloudflared のみ)
       → codex-workspace Pod の auth-gateway コンテナ (uid 1000, HOME=PVC)
            JWT 署名/iss/aud/exp/email を再検証、Origin 検査
            → setsid script (PTY) → 固定ログインコマンド
```

- arch: `terraform/cloudflare/b0xp.io/k8s/codex_auth.tf`（Access app/policy, DNS）、`tunnel.tf`（ingress）、
  `docker/codex-workspace/auth-gateway/`（bb + xterm.js、Dockerfile で sha512 固定取得）、テスト/CI。
- lolice: `argoproj/codex-workspace/` に auth-gateway コンテナ、Service、NetworkPolicy。
  BOXP-204 の認証期限通知の案内文に URL を追記。

## 安全条件

- 汎用シェルは起動しない。コマンドはコード内の固定 argv だけで、リクエストから受け取るのは
  provider 名と端末の行数/桁数（範囲制限した整数）のみ。
- 子プロセスの環境変数は allowlist（HOME/PATH/LANG 等）。API 鍵・ADC・OAuth token 変数・
  クラスタの secret は渡さない。コンテナ自体にも API 鍵の env を設定しない。
- 端末の入出力はメモリ上だけ。ログには provider と開始/終了理由のみ。セッション終了で破棄。
- 同時に 1 ログインのみ（排他）。無操作 10 分・最大 20 分・本人の「終了」で process group ごと終了。
  OAuth の別タブから戻った時は再接続（attach のみ。終了済みなら新しいログインを始めない）。
- 資格情報はこのページでは読まない。CLI 自身が PVC 上の通常の保存先へ書くため Pod 再作成後も残る。
  logout は呼ばない。
- 成功確認はログインとは別ボタン。BOXP-204 の `agent_auth_expiry.bb` の非秘密メタデータだけを表示し、
  「実利用の成功」とは表示しない（Antigravity は資格情報を読まない契約のため直近 run の結果のみ）。
- 新課金・新 API 鍵・AI Credits/ADC への切替はしない。agy は /config で Use AI Credits off を本人が確認。

## 検証

- `tests/codex-workspace/auth-gateway-test.bb`: JWT（正常/aud/iss/期限/nbf/他人/署名不正/kid 不明/alg/
  設定欠落）、HTTP の認可と Origin、子 env の allowlist、固定コマンド、PTY・排他・無操作/最大時間・
  process tree 終了、WebSocket の E2E（他人拒否、attach は新規開始しない、入力→終了）。
- image smoke: vendored xterm.js の存在、/healthz 200、未設定時 503（fail closed）。
- 配備後: 未認証アクセスが Access ログインへリダイレクトされること、トンネル直接/他経路が拒否されること、
  Pod 内 gateway が JWT なしで 403 を返すことを実環境で確認。本人ログイン操作は Owner が行う。

## ロールアウト順

1. arch PR merge → tfaction apply（Access app → ingress → DNS）、image build。
2. Access app の AUD を確認し lolice PR（コンテナ・Service・NetworkPolicy・通知案内）→ Argo CD 同期。
3. 実環境で拒否系を確認し、Owner へ URL と短い操作案内を渡す。

## ロールバック

lolice の auth-gateway コンテナ/Service を revert（Pod から消える）→ arch の DNS/ingress/Access を revert。
CLI の資格情報には触れないため認証状態は変わらない。
