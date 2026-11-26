# Pi Web 試用（BOXP-714）

Pi のブラウザ UI を、codex-workspace 上で本人だけが開ける形で試すための設定と起動スクリプト。

- 現行の画面: [xing-shuyin/pi-web-ui](https://github.com/xing-shuyin/pi-web-ui)（Keel 内蔵、MIT、npm `pi-web-ui@0.122.0` に固定）。2026-11-26 に Owner 承認で置き換え（TD-03）。
- 旧画面: [tg-prplx/pi-web-agent](https://github.com/tg-prplx/pi-web-agent)（MIT）。消さずに残してあり `pi-web-trial use legacy` で切り戻せる。
- pi-web-ui は 127.0.0.1 からの接続を認証なしで信用し、ターミナル・ファイル編集・エンジン切替・設定・プラグインなどを 1 本の WebSocket（`/ws`）と HTTP API で出している。そのため門番（`gate/gate.ts --profile pwu`）が、チャットに要る HTTP パスと WebSocket メッセージ（型と項目）だけを許可リストで通し、それ以外は止める（fail-closed）。決まりは Obsidian の spec「新本体（pi-web-ui）向けの門番の決まり」。
- pi-web-ui は試用専用の HOME（`~/.local/share/pi-web-trial/pwu-home`）・データ（`pwu-data`）・Pi 設定（`agent-pwu`）で動かし、既存の Claude / Codex / Pi の認証情報や `~/.pi/agent` を見せない。

- モデル: lolice の local-llm（llama-server）の `gemma4-26b` だけ。クラウドのモデルは選べない（起動時にクラウドの API キー環境変数を渡さない）。
- Pi の設定: 試用専用の `~/.local/share/pi-web-trial/agent`。既存 Pi の `~/.pi/agent` は読まない・書かない。
- 道具: `read` `grep` `find` `ls` `write` `edit` `web_search`。`bash` は無効。`web_search` は毎回本人の確認ダイアログを経てから送る。決まりの正本は Obsidian の `Projects/pi-web-agent-trial/spec.md`。
- 入口: 本体は内部用の `127.0.0.1:4320`（pi-web-ui。旧画面は `4318`）、本人が開く `127.0.0.1:4317` には Host / Origin を確かめる門番（`gate/gate.ts`）を置く。pi-web-agent の API には認証も Host 確認もないため、127.0.0.1 待ち受けだけだと SSH 転送中に悪意あるサイトが DNS rebinding で会話やノートを読めてしまう。門番は `Host` が `127.0.0.1:4317`/`localhost:4317` で、`Origin` が同じ場所（POST 等は必須）の要求だけを中継する。SSH のポート転送は 4317 だけにする（4318 は転送しない。認証なしで外に公開しない）。
- Cloudflare Access 入口（`https://pi-web.b0xp.io`）: 門番は `~/.local/share/pi-web-trial/access.json` があるときだけ `0.0.0.0:4319` でも待ち受け、Access JWT（署名・iss・aud・期限・Owner email）と Host / Origin を確かめてから本体へ中継する（JWT と Access の Cookie は本体へ渡さない。設定が欠けたら全部 403）。前段は Access（Owner email＋GitHub ログイン）、既存 k8s トンネルの cloudflared（JWT 必須）、lolice の Calico（4319 に入れるのは cloudflared だけ）。Terraform は `terraform/cloudflare/b0xp.io/k8s/pi_web_trial.tf`。

## 導入と起動

pi-web-ui（現行）:

```bash
scripts/pi-web-trial/bin/pi-web-trial install-pwu      # npm install pi-web-ui@0.122.0 + 試用の Pi 設定 + 日本語パック
~/.local/share/pi-web-trial/bin/pi-web-trial use pwu   # 門番の後ろを pi-web-ui に切り替えて再起動
~/.local/share/pi-web-trial/bin/pi-web-trial status    # ui: pwu / {"ok":true...}
# 切り戻し: ~/.local/share/pi-web-trial/bin/pi-web-trial use legacy
```

旧画面（tg-prplx/pi-web-agent）:

```bash
# pi-web-agent をビルド（upstream の build:offline はモデルカタログの取得が壊れているため、
# npm 公開版 @earendil-works/pi-ai@0.82.1 の providers/data を流用する）
ARCH=$PWD   # boxp/arch のチェックアウト（このコマンドはリポジトリのルートで始める）
git clone https://github.com/tg-prplx/pi-web-agent /path/to/pi-web-agent && cd /path/to/pi-web-agent
git checkout ae5e1c79c8d8314339e1c9a3cd252a1f014f03d2
npm ci --ignore-scripts
npm pack @earendil-works/pi-ai@0.82.1 && tar xzf earendil-works-pi-ai-0.82.1.tgz
mkdir -p packages/ai/src/providers/data && cp -r package/dist/providers/data/. packages/ai/src/providers/data/
npm run build:offline

# 試用環境へ導入して起動（pi-web-agent に移動しているので arch 側は絶対パスで呼ぶ）
"$ARCH/scripts/pi-web-trial/bin/pi-web-trial" install /path/to/pi-web-agent
~/.local/share/pi-web-trial/bin/pi-web-trial start     # stop / restart / status
```

手元の端末から:

```bash
ssh -L 4317:127.0.0.1:4317 <codex-workspace>
# ブラウザで http://127.0.0.1:4317
```

Cloudflare Access 入口を使うときは、AUD（`terraform output pi_web_trial_access_aud`、または未認証で開いたときのログイン画面 URL の `kid=`）を入れて置いてから再起動する:

```bash
cat > ~/.local/share/pi-web-trial/access.json <<'JSON'
{"teamDomain": "https://<team>.cloudflareaccess.com", "aud": "<AUD>", "ownerEmails": ["<Owner の email>"], "publicOrigin": "https://pi-web.b0xp.io"}
JSON
~/.local/share/pi-web-trial/bin/pi-web-trial restart
# PC / スマホのブラウザで https://pi-web.b0xp.io（初回は GitHub でログイン）
```

## 注意

- pi-web-agent 同梱の Pi（0.82.1）には組込みの `llama.cpp` プロバイダがあり、既存 Pi と同じ `llama.cpp` という名前で models.json に書くと「Provider is not configured」になる。試用では `local-llm` という名前にしている。
- `web_search` は Node の fetch だと DuckDuckGo のボット判定に当たるため、`curl` を引数配列で呼ぶ（シェルを通さない）。
- 旧画面の一部（新規チャットのダイアログ、道具カードの見出し、入力欄の案内）はロシア語のまま。
- pi-web-ui の日本語パックは npm に入っていないため、`install-pwu` が GitHub のタグ `v0.122.0` の `locales/ja.json` を取得して置く。画面の一部（左の Agents / PROJECTS 見出し、入力欄の下の提案ボタン「继续・上传发布…」など）は英語・中国語のまま。
- pi-web-ui の画面のうち、ターミナル・ファイル一覧・Git・デバイスセンター（左の Agents / GROUPS）・設定・プラグインは門番で止めているため、押しても何も起きないか「読み込めない」と出る。使うのはチャット欄だけ。
- 入力欄の `/` で始まる文（スラッシュコマンド）と `!` で始まる文は門番が捨てる（送られない）。ファイルの添付もできない。
- pi-web-ui の版を上げると WebSocket の型や項目が変わりうる。門番は知らないものを止める側に倒れるので漏れはしないが、画面が動かなくなりうる。上げるときは `PWU_VERSION` と門番の許可リストを一緒に見直す。

## テスト

```bash
node --test scripts/pi-web-trial/test/
```
