# hermes-notify-channel（BOXP-546 隔離試作）

**本番には配備していない試作。** Hermes 本体 patch（`docker/hermes-agent/patches/`）が担っている通知配送を、
公式の拡張機構（`kind: platform` の plugin）だけで置き換えられるかを、本番に触れない環境で実測するためのもの。
`docker/hermes-agent/` の外に置いてあり、どの image build・配備にも含まれない。

結果と本番移行の判断材料は Obsidian `Projects/hermes-upstream-alignment/prototype-results.md`（計画は同 `plan.md`）。

## 構成

| パス | 内容 |
|---|---|
| `plugin/boxp-notify/` | 送信専用の通知用 channel。Hermes からは `gateway.platforms.base` と `gateway.config` だけを import する |
| `lab/` | 実測環境。上流 image に plugin・擬似 LLM/Telegram（`stub.bb`）・偽 vault を焼き、`--network none` で動かす |

## channel の動き

届け先の指定（webhook route の `deliver: boxp_notify` と `deliver_extra.chat_id`、cron の `deliver: boxp_notify:<名前>`）:

| chat_id | 種類 | 家の受信箱 |
|---|---|---|
| `tb:<event id>` | Task Board 通知 | `Projects/task-board-events/delivered-copies/<event>[.notice].md` |
| `direct:alertmanager:<firing 数>` | agent を通さない直送 | `Projects/alertmanager-deliveries/delivered-copies/alert-*.md`（BOXP-501 の形式） |
| `direct:<その他>` | agent を通さない直送 | 無し（受信箱の取り決めが無いので Telegram のみ） |
| それ以外 | cron | `Projects/cron-deliveries/delivered-copies/cron-*.md` |

- `send` が実配信。まず家の受信箱へ書き、書けない時だけ Telegram へ送る（`BOXP_NOTIFY_TELEGRAM_MODE=fallback`。`off` / `both` も可）。
- 送る前に永続 receipt（`$HERMES_HOME/boxp-notify/receipts/`）を書き、同じ鍵は 1 回だけ届ける。
  Task Board は `event id × (report|notice)`、cron と直送は `名前(job id) × 本文 × 時間幅` が鍵。
- 無通知にするのは、票 Notes に helper の `result=silent|deferred|continued` の receipt がある時だけ。channel に `allow_silence` は与えない。
- `event=<id>` を含まない本文（上流の例外文・空応答の代替文など）は「配送要確認」の notice として 1 回だけ届ける。上流の文言には依存しない。
- 家にも Telegram にも届けられなかった分は pending として残り、`connect` 後の定期回復で届ける。

## 実測の再現

docker と `bb` が要る。すべて作業ディレクトリ内で完結し、外部へは上流 image の取得以外に通信しない。

```sh
docker pull docker.io/nousresearch/hermes-agent:v0.23.1
lab/lab.sh build boxp546/lab:v0.23.1 docker.io/nousresearch/hermes-agent:v0.23.1
lab/suite.sh boxp546/lab:v0.23.1 lab546a /path/to/evidence/v0.23.1   # 約 12 分
lab/lab.sh down lab546a
```

- `lab/Dockerfile.patched` は「上流 v0.22.5 ＋本番の本体 patch」の土台を作る（build context に `docker/hermes-agent/patches/` を置く）。並行稼働の確認用。
- `LAB_CRON_ONLY=1` で cron の場面だけ、`LAB_RUN_ARGS="-e BOXP_NOTIFY_CRON_BUCKET_SECONDS=60"` で重複排除の時間幅を変えられる。
- 証跡は `boxp-notify/journal.jsonl`（`send` の呼出しと判定）、`logs/telegram.jsonl`、`vault/`（家の受信箱）に残る。

## 試作のままにしてある点

- `lab-fail-home` / `lab-no-recovery` の印ファイルは障害を起こすための実測用。
- Telegram 送信は 4000 字で分割するだけで、再送間隔の調整や書式変換は無い。
- 起動時自己検査は結果を journal に書くだけで、監視へは繋いでいない。
