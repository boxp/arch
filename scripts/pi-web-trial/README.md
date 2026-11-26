# Pi Web 試用（BOXP-714）

[tg-prplx/pi-web-agent](https://github.com/tg-prplx/pi-web-agent)（Pi のブラウザ UI、MIT）を、codex-workspace 上で本人だけが開ける形で試すための設定と起動スクリプト。

- モデル: lolice の local-llm（llama-server）の `gemma4-26b` だけ。クラウドのモデルは選べない（起動時にクラウドの API キー環境変数を渡さない）。
- Pi の設定: 試用専用の `~/.local/share/pi-web-trial/agent`。既存 Pi の `~/.pi/agent` は読まない・書かない。
- 道具: `read` `grep` `find` `ls` `write` `edit` `web_search`。`bash` は無効。`web_search` は毎回本人の確認ダイアログを経てから送る。決まりの正本は Obsidian の `Projects/pi-web-agent-trial/spec.md`。
- 入口: 本体は内部用の `127.0.0.1:4318`、本人が開く `127.0.0.1:4317` には Host / Origin を確かめる門番（`gate/gate.ts`）を置く。pi-web-agent の API には認証も Host 確認もないため、127.0.0.1 待ち受けだけだと SSH 転送中に悪意あるサイトが DNS rebinding で会話やノートを読めてしまう。門番は `Host` が `127.0.0.1:4317`/`localhost:4317` で、`Origin` が同じ場所（POST 等は必須）の要求だけを中継する。SSH のポート転送は 4317 だけにする（4318 は転送しない。認証なしで外に公開しない）。
- Cloudflare Access 入口（`https://pi-web.b0xp.io`）: 門番は `~/.local/share/pi-web-trial/access.json` があるときだけ `0.0.0.0:4319` でも待ち受け、Access JWT（署名・iss・aud・期限・Owner email）と Host / Origin を確かめてから本体へ中継する（JWT と Access の Cookie は本体へ渡さない。設定が欠けたら全部 403）。前段は Access（Owner email＋GitHub ログイン）、既存 k8s トンネルの cloudflared（JWT 必須）、lolice の Calico（4319 に入れるのは cloudflared だけ）。Terraform は `terraform/cloudflare/b0xp.io/k8s/pi_web_trial.tf`。

## 導入と起動

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
- 画面の一部（新規チャットのダイアログ、道具カードの見出し、入力欄の案内）はロシア語のまま。

## テスト

```bash
node --test scripts/pi-web-trial/test/
```
