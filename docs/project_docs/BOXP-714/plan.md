# BOXP-714: Pi Web Agent からローカル LLM と既存 Pi ツールを試す

## 目的

本人が希望した tg-prplx/pi-web-agent（Pi のブラウザ UI）を、既存 Pi とローカル LLM につないだ本人限定の試用環境として用意し、
実ブラウザでローカルモデルによる Obsidian 検索・Web 検索・試験用ノート追記を一往復確かめる。

## 制約（チケットより）

- 既存 Pi・コハコ・推論環境の通常利用を妨げない。
- 無認証公開・新課金・クラウドモデルへの自動切替・私的ノート本文の外部送信をしない。

## 方式

| 候補 | 判断 |
| --- | --- |
| codex-workspace 内で 127.0.0.1 待ち受け＋SSH ポート転送 | **第 1 段で採用**。vault と local-llm に既に届き、k8s/Cloudflare の変更なしで本人限定（SSH 鍵）にできる |
| Cloudflare Access（本人 email＋GitHub）付きの URL | 第 2 段の候補。スマホから開きやすいが、codex-workspace の Service/NetworkPolicy（lolice）と Access/tunnel（arch）の変更が要る |
| 別 Pod に分離 | vault（codex-workspace の PVC）を共有できないため今回は不採用 |

- Pi の設定は試用専用の `PI_CODING_AGENT_DIR`（local-llm の gemma4-26b だけ）。起動は `env -i` で、クラウドの API キー環境変数を渡さない。
- 既に読み込まれている gemma4-26b だけを出す（router の別モデルへ切り替えて他の利用者を待たせない）。
- ガード拡張（`scripts/pi-web-trial/extension/`）: bash を外す、ファイル系の道具を vault 内（隠しフォルダ除く）に限定、書き込みは `Projects/pi-web-agent-trial/sandbox/` の `.md` に限定、`web_search`（DuckDuckGo HTML、検索語だけ送信）を追加し、このチャットで読んだ本文と 16 文字以上同じ並びを含む検索語・読んだ本文の記録が上限を超えたチャットの検索は止め、それ以外の検索語も毎回本人の確認ダイアログ（検索語をそのまま表示）で「送信」された時だけ送る。
- 現行仕様: Obsidian `Projects/pi-web-agent-trial/spec.md`（spec-index: `pi-web-trial-guard`）。

## Lean 形式モデル

状態は「読んだ本文の集合」が増えるだけで、判定は入力 1 件ごとの関数に閉じる。順序の規則（読んだ後の検索だけ止まる）は直接テストで確かめられるため、Lean モデルは作らない（標準の適用外: 入出力関数を直接テストで覆える）。

## 検証

- 自動試験: `node --test scripts/pi-web-trial/test/`（期待値は仕様の例から作成。実装前に失敗を確認）。
- 実ブラウザ（Playwright コンテナから 127.0.0.1:4317、PC 1440×900 / スマホ 390×844）: ローカルモデルで grep による vault 検索、web_search、sandbox への追記、bash の不使用、vault 外の read の拒否。
- 本人端末からの SSH 転送での利用は本人受入として残る。

## 次の段（同チケット内）

- スマホから開きやすい Cloudflare Access 付き URL（lean-reading と同じ「本人 email＋GitHub」方式、tunnel 側 JWT 検証）を検討。

## 第 2 段: Cloudflare Access 入口（TD-01、Owner 承認 2026-11-26）

- URL: `https://pi-web.b0xp.io`。codex-auth.b0xp.io（BOXP-634）と同じ形で、独立した 4 段がそれぞれ止める。
  1. Access: Owner email かつ既存 GitHub IdP ログインの policy 1 本（他は拒否）。24h、App Launcher 非表示。
  2. cloudflared（既存 k8s トンネル）: ingress でこのアプリの AUD の Access JWT を必須にする。DNS はアプリと ingress の後に作る。
  3. lolice Calico: codex-workspace Pod の 4319 は k8s 名前空間の cloudflared だけ。Service `pi-web-trial`（ClusterIP、targetPort 数値なので Pod 再起動なし）。
  4. 門番 `gate.ts` の Access 用口（0.0.0.0:4319）: JWT の署名・iss・aud・期限・Owner email と Host/Origin を再検証し、JWT と Access Cookie は本体へ渡さない。設定（`~/.local/share/pi-web-trial/access.json`）が欠ければ全部 403。
- 既存の 127.0.0.1:4317 口、ローカルモデル限定、道具の判定、書込み範囲、web_search の本人確認は変えない。
- 変更: arch `terraform/cloudflare/b0xp.io/k8s/{pi_web_trial.tf,tunnel.tf}`、`scripts/pi-web-trial/{gate,bin,test,README.md}`。lolice `argoproj/codex-workspace/{service-pi-web-trial.yaml,networkpolicy.yaml,kustomization.yaml}`。
- Lean: 適用外（要求 1 件ごとの判定関数で状態を持たない。直接テストで覆う）。
- 検証: node test（期待値は仕様の例から、実装前に失敗を確認）、apply 後に未認証の要求が Access で止まること・偽 JWT が cloudflared / 門番で止まること・LAN から 4319 に届かないことを外から確認。Owner の GitHub ログインでの本人利用は本人受入。

## 第 3 段: Access ログイン後の `forbidden (sec-fetch-site)`（TD-02）

- 症状: Owner が `https://pi-web.b0xp.io` で Access（GitHub）ログイン後に `forbidden (sec-fetch-site)`。
- 原因: ログイン画面（別サイト）での操作から 302 で戻るトップレベル遷移は、ブラウザが `Sec-Fetch-Site: cross-site`（`Sec-Fetch-Mode: navigate`、`Sec-Fetch-Dest: document`）を付ける。門番は `same-origin` / `none` 以外を一律拒否していた。再読込も cross-site のまま拒否。前段の模擬検証は http（非安全オリジン）で Chrome が Sec-Fetch-* を送らず見逃した。
- 修正: `cross-site` / `same-site` は「GET/HEAD・Mode navigate・Dest document・パスが /api 以外（%デコード・小文字化後、`//` 始まりは拒否）」のトップレベル画面遷移だけ通す。iframe・no-cors/cors 読取・/api への遷移・別 Origin / Origin 無しの POST は従来どおり 403。JWT 検証・Owner 限定・Host（DNS rebinding）・Origin・Upgrade・道具ガードは不変。
- Lean: 適用外（状態を持たない要求ごとの判定関数。仕様の例から直接テスト）。
- 検証: node test（新規ケースは実装前に失敗を確認）、HTTPS 前段＋ログイン画面代役＋実 Chromium で PC/スマホ幅の再現（修正前 403 → 修正後 200・会話 SSE 返答）と不正経路の 403。
