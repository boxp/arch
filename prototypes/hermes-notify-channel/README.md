# hermes-notify-channel（BOXP-546 隔離試作、BOXP-553 段階 1）

**段階 1（BOXP-553）で、この plugin の写しを Alertmanager 通知だけに本番配備した。** 配備物は lolice
`argoproj/hermes-agent/plugins/boxp-notify/`（既存 plugin と同じく ConfigMap から init container が入れる。
image には入れていない）で、`plugin/boxp-notify/` と同一内容に保つ。Task Board 通知と cron の経路は試作のまま。

Hermes 本体 patch（`docker/hermes-agent/patches/`）が担っている通知配送を、
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
| `direct:alertmanager` | agent を通さない直送 | `Projects/alertmanager-deliveries/delivered-copies/alert-*.md`（BOXP-501 の形式。title と発生件数は relay の本文から読む。`direct:alertmanager:<発生件数>` も可） |
| `direct:<その他>` | agent を通さない直送 | 無し（受信箱の取り決めが無いので Telegram のみ） |
| それ以外 | cron | `Projects/cron-deliveries/delivered-copies/cron-*.md` |

- `send` が実配信。まず家の受信箱へ書き、書けない時だけ Telegram へ送る（`BOXP_NOTIFY_TELEGRAM_MODE=fallback`。`off` / `both` も可）。
  直送は名前ごとに上書きできる。本番は `BOXP_NOTIFY_TELEGRAM_MODE_ALERTMANAGER=both` で、アラートは家と Telegram の両方へ届く。
- Telegram の宛先は `BOXP_NOTIFY_TELEGRAM_TOKEN` / `_CHAT_ID` / `_THREAD_ID`。無ければ gateway 自身の
  `TELEGRAM_BOT_TOKEN` / `TELEGRAM_HOME_CHANNEL` / `TELEGRAM_HOME_CHANNEL_THREAD_ID`（`deliver: telegram` と同じ届け先）。
- 送る前に永続 receipt（`$HERMES_HOME/boxp-notify/receipts/`）を書き、同じ鍵は 1 回だけ届ける。
  Task Board は `event id × (report|notice)`、cron と直送は `名前(job id) × 本文 × 時間幅` が鍵。
  記録と受信箱のファイル名は「読める接頭辞＋鍵全体の hash」で、宛先名の長さに依らない。
  直送は、直前の時間幅に同じ本文の記録があればそれと同じ通知として扱う（時間幅の境目をまたぐ再送対策）。
- 無通知にするのは、票 Notes に helper の `result=silent|deferred|continued` の receipt がある時だけ。channel に `allow_silence` は与えない。
- `event=<id>` を含まない本文（上流の例外文・空応答の代替文など）は「配送要確認」の notice として 1 回だけ届ける。上流の文言には依存しない。
- 家にも Telegram にも届けられなかった分は pending として残り、`connect` 後の定期回復で届ける。
  `both` では家と Telegram の両方へ届くまで pending のまま残し、届いていない側だけを回復で送る（片方でも届けば上流へは成功を返す）。
  片方へ届いたまま 24 時間（`BOXP_NOTIFY_PENDING_MAX_AGE_SECONDS`）もう片方へ届かない分は `expired` にして再試行をやめる。
  どちらにも届いていない分は期限で捨てない。
- `send` と回復は receipt ごとの同じ lock（process 内の lock ＋ lock ファイル）を取る。送信中の通知を回復が重ねて送ることは無い。

## 実測の再現

docker と `bb` が要る。すべて作業ディレクトリ内で完結し、外部へは上流 image の取得以外に通信しない。

```sh
docker pull docker.io/nousresearch/hermes-agent:v0.23.1
lab/lab.sh build boxp546/lab:v0.23.1 docker.io/nousresearch/hermes-agent:v0.23.1
lab/suite.sh boxp546/lab:v0.23.1 lab546a /path/to/evidence/v0.23.1   # 約 12 分
lab/lab.sh down lab546a
```

- `lab/Dockerfile.patched` は「上流 v0.22.5 ＋本番の本体 patch」の土台を作る（build context に `docker/hermes-agent/patches/` を置く）。並行稼働の確認用。
- `lab/stage1.sh` は段階 1 の経路（Alertmanager payload → 本番の relay script → channel → 家の受信箱＋Telegram）を、
  本番 image（digest 指定）と lolice の manifest（設定・route・plugin 一式）で動かす。
  `stage1.sh build <tag> <本番 image> <lolice/argoproj/hermes-agent>`、`stage1.sh run <tag> <名前> <証跡dir>`。
  `STAGE1_CONFIG=<file>` を付けて build すると、ConfigMap の `config.yaml` の代わりにその file（本番 PVC 上の手編集済みの写しなど）で動かす。
- `LAB_CRON_ONLY=1` で cron の場面だけ、`LAB_RUN_ARGS="-e BOXP_NOTIFY_CRON_BUCKET_SECONDS=60"` で重複排除の時間幅を変えられる。
- `lab/cron-standalone.sh` は gateway を起動せず `hermes cron tick` だけで cron を届ける場面。
- `lab/home-dispatch.sh <証跡> <作業dir>` は出来た受信箱を無改変の配送係（`task_board_events.bb`）に読ませ、擬似の家が受け取った内容を出す。
- `python3 lab/unit_check.py` は image 無しで動く確認（`both` で Telegram だけ失敗した時の回復、送信中の回復との競合、別 process との排他、分割送信の途中停止からの再開、
  長い宛先名での記録名の衝突なし、Alertmanager の種類別設定・title・回復・期限切れ、解除後に同じ本文で再発した通知が抑止されないこと）。上流の gateway は擬似に差し替えている。
- 証跡は `boxp-notify/journal.jsonl`（`send` の呼出しと判定）、`logs/telegram.jsonl`、`vault/`（家の受信箱）に残る。

## 試作のままにしてある点

- gateway 外配送用の `standalone_sender_fn` は登録してあるが、実測した 2 版では `hermes cron tick` が adapter を自分で起こして `send` を呼ぶため、この口は呼ばれなかった（未実測）。
- `lab-fail-home` / `lab-no-recovery` の印ファイルは障害を起こすための実測用。
- Telegram 送信は 4000 字で分割するだけで、再送間隔の調整や書式変換は無い。
- 起動時自己検査は結果を journal と gateway の log（warning）に書くだけで、監視へは繋いでいない。
- Alertmanager 通知は channel 宛になったので、Telegram の会話 session への mirror（`mirror_to_session`）は無い。
