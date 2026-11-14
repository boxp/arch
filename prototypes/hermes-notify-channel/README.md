# hermes-notify-channel（BOXP-546 隔離試作、BOXP-553 段階 1、BOXP-554 段階 2、BOXP-556 段階 3〜4）

**段階 1（BOXP-553）で、この plugin の写しを Alertmanager 通知だけに本番配備した。** 配備物は lolice
`argoproj/hermes-agent/plugins/boxp-notify/`（既存 plugin と同じく ConfigMap から init container が入れる。
image には入れていない）で、`plugin/boxp-notify/` と同一内容に保つ。

**段階 2（BOXP-554）で、Task Board 通知と cron 通知をこの channel へ移す。** 本体 patch は image に残したまま
（戻し先）で、新しい経路の通知には反応しない。Task Board は patch が反応しない別名の webhook route
`task-board-channel`（lolice の init container が既存 route `task-board` から導出）を dispatcher の送信先にし、
cron は job の届け先を `boxp_notify:cron` にする。戻す時は dispatcher の送信先 URL と job の届け先を戻す。

**段階 3〜4（BOXP-556）で、本体 patch を image から外し、上流 v0.23.1 へ更新する。** `docker/hermes-agent/patches/`
は削除した。旧 webhook route `task-board`（本体 patch 前提）は lolice の init container が消し、`task-board-channel` だけを
残す。agent が `cronjob_manage` tool で作る job の届け先は、この plugin の `pre_tool_call` hook が Telegram（未指定・`origin`・
`all`・`telegram[:…]`）から `boxp_notify:cron` へ書き換える（失敗通知の宛先 `failure_deliver` も同じ。
`BOXP_NOTIFY_CRON_REWRITE=0` で止められる）。保存済みの job や CLI（`hermes cron create`）で Telegram 宛に作った job は、
回復 loop（既定 60 秒ごと）が `hermes cron edit` で同じ宛先へ移す（完了済み・無効の job は触らない）。戻す時は arch の変更を revert して
patch 入りの image へ戻す（lolice 側は patch の有無どちらの image でも動く）。

以下は試作時の説明。Hermes 本体 patch（当時の `docker/hermes-agent/patches/`）が担っていた通知配送を、
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
  直送は名前ごと、cron は `BOXP_NOTIFY_TELEGRAM_MODE_CRON` で上書きできる。本番は Alertmanager と cron が `both`（家と Telegram の両方）。
- Task Board 通知は設定の mode ではなく、本体 patch と同じ取り決めで届け先を決める（dispatcher が読むファイルも同じ）:
  - 正式報告（Notes に `result=notified|question` の記録があり、本文に `event=<id>` がある）は、
    `Projects/task-board-events/delivery-routing.md` が `task-board: home` で、催促 route が登録済み・dispatcher の
    準備状態（`home-reminder-ready.md`）が新しい間だけ、家の受信箱だけへ届ける（写しに `primary: home`。未読の催促と
    家へ入らなかった時の Telegram 送信は dispatcher が行う）。受信箱へ書けない時は Telegram へ送り、写しは後から印なしで書く。
  - 照合通知（配送要確認）、記録の無い報告、routing が `telegram` の時は Telegram へ送り、家へ印なしの写しを書く。
  - 静音時間（dispatcher が公開する `quiet-policy.md`）、digest が引き取った event（`delivery-claims/`）、夜間に
    `deferred` とした event の遅い報告は送らず、`delivery-receipts/<event>.md` に `quiet-held` を残す（朝の digest が回収）。
  - 届けたら `sent`、どこにも届かなければ `uncertain`、記録つきの無通知は `silent` を `delivery-receipts/` に残す。
    dispatcher はこれで event を完了・保留・再送停止にする。
- cron は job id しか渡らないので、家の受信箱の job 名は scheduler の `cron/jobs.json` から読む。
  Telegram へは、本文が 1 通に収まる時は Markdown（太字・code・link・見出し）を HTML に直して送り、拒否されたら素の本文で送る。
- Telegram の宛先は `BOXP_NOTIFY_TELEGRAM_TOKEN` / `_CHAT_ID` / `_THREAD_ID`。無ければ gateway 自身の
  `TELEGRAM_BOT_TOKEN` / `TELEGRAM_HOME_CHANNEL` / `TELEGRAM_HOME_CHANNEL_THREAD_ID`（`deliver: telegram` と同じ届け先）。
- 送る前に永続 receipt（`$HERMES_HOME/boxp-notify/receipts/`）を書き、同じ鍵は 1 回だけ届ける。
  Task Board は `event id × (report|notice)`、cron と直送は `名前(job id) × 本文 × 直近の受理` が鍵。
  記録と受信箱のファイル名は「読める接頭辞＋鍵全体の hash」で、宛先名の長さに依らない。
  直送と cron は、同じ本文が「その宛先（job）の直近の通知」で、時間幅の内（直送 20 分、cron は
  `BOXP_NOTIFY_CRON_DEDUP_SECONDS`、既定 300 秒）にある時だけ同じ通知の再送として扱う。cron は実行 ID が渡らないので、
  同じ job が時間幅の内に同じ本文を続けて出すと 1 件にまとまる（job の最短間隔より短くしておく）。
  job id が渡らない時（gateway 外配送の口）は job を区別できないので、再送扱いをせず毎回届ける（別 job の同じ本文を落とさないため。重複は起こり得る）。
- 無通知にするのは、票 Notes に helper の `result=silent|deferred|continued` の receipt がある時だけ。channel に `allow_silence` は与えない。
- `event=<id>` を含まない本文（上流の例外文・空応答の代替文など）は「配送要確認」の notice として 1 回だけ届ける。上流の文言には依存しない。
- 家にも Telegram にも届けられなかった分は pending として残り、`connect` 後の定期回復で届ける。
  `both` では家と Telegram の両方へ届くまで pending のまま残し、届いていない側だけを回復で送る（片方でも届けば上流へは成功を返す）。
  片方へ届いたまま、その届いた時点から 24 時間（`BOXP_NOTIFY_PENDING_MAX_AGE_SECONDS`）もう片方へ届かない分は `expired` にして再試行をやめる（作成時刻からではないので、両方が長く止まった後に片方だけ戻っても、もう片方の回復は続く）。
  どちらにも届いていない分は期限で捨てない。Task Board の event は、配送係向けの配送記録（`sent`）を vault へ書けていない間は期限切れにしない（記録が無いと配送係が event を完了できないため、vault が戻るまで続ける。送信済みの通知は再送しない）。
- `send` と回復は receipt ごとの同じ lock（process 内の lock ＋ lock ファイル）を取る。送信中の通知を回復が重ねて送ることは無い。

## 実測の再現

docker と `bb` が要る。すべて作業ディレクトリ内で完結し、外部へは上流 image の取得以外に通信しない。

```sh
docker pull docker.io/nousresearch/hermes-agent:v0.23.1
lab/lab.sh build boxp546/lab:v0.23.1 docker.io/nousresearch/hermes-agent:v0.23.1
lab/suite.sh boxp546/lab:v0.23.1 lab546a /path/to/evidence/v0.23.1   # 約 12 分
lab/lab.sh down lab546a
```

- （`lab/Dockerfile.patched` は本体 patch の削除に伴い BOXP-556 で削除した。patch 入りの土台が要る時は当時の本番 image を digest 指定で使う。）
- `lab/stage1.sh` は段階 1 の経路（Alertmanager payload → 本番の relay script → channel → 家の受信箱＋Telegram）を、
  本番 image（digest 指定）と lolice の manifest（設定・route・plugin 一式）で動かす。
  `stage1.sh build <tag> <本番 image> <lolice/argoproj/hermes-agent>`、`stage1.sh run <tag> <名前> <証跡dir>`。
  `STAGE1_CONFIG=<file>` を付けて build すると、ConfigMap の `config.yaml` の代わりにその file（本番 PVC 上の手編集済みの写しなど）で動かす。
- `lab/stage2.sh` は段階 2 の経路を、本番 image（digest 指定）の上で、lolice の init container の script をそのまま流して
  配置し（ConfigMap を `/bootstrap`、plugin を `/bootstrap-plugins` に置く）、無改変の dispatcher（`task_board_events.bb`）を
  event の送信元、`lab/home.bb` を擬似の家にして動かす。`stage2.sh build <tag> <本番 image> <lolice/argoproj/hermes-agent>`、
  `stage2.sh run <tag> <名前> <証跡dir>`（約 12 分）。`STAGE2_CONFIG=<file>` で本番 PVC 上の config.yaml の写しを使う
  （model だけ擬似 LLM へ向ける）。場面: 正式報告（家のみ→dispatcher 完了→未読催促）、同じ event の再投入、記録なし無通知、
  記録つき無通知、例外、静音時間に入った後の報告（保留→朝の digest）、受信箱へ書けない時、routing を telegram にした時、
  両方不通＋再起動、旧 route（残っていれば本体 patch 経由で届くこと、消えていれば拒否されること）、cron（成功・失敗・同じ本文の再実行）、Alertmanager。
  BOXP-556 で追加: 画像表示 route（plugin `kohako-vault-image`）、agent が作る cron の届け先書き換え、全 plugin の公式検査。
- `LAB_CRON_ONLY=1` で cron の場面だけ、`LAB_RUN_ARGS="-e BOXP_NOTIFY_CRON_BUCKET_SECONDS=60"` で重複排除の時間幅を変えられる。
- `lab/cron-standalone.sh` は gateway を起動せず `hermes cron tick` だけで cron を届ける場面。
- `lab/home-dispatch.sh <証跡> <作業dir>` は出来た受信箱を無改変の配送係（`task_board_events.bb`）に読ませ、擬似の家が受け取った内容を出す。
- `python3 lab/unit_check.py` は image 無しで動く確認（`both` で Telegram だけ失敗した時の回復、送信中の回復との競合、別 process との排他、分割送信の途中停止からの再開、
  長い宛先名での記録名の衝突なし、Alertmanager の種類別設定・title・回復・期限切れ、解除後に同じ本文で再発した通知が、最初の通知が片方だけ届いた状態でも、どちらにも届いていない状態でも失われないこと）。上流の gateway は擬似に差し替えている。
- 証跡は `boxp-notify/journal.jsonl`（`send` の呼出しと判定）、`logs/telegram.jsonl`、`vault/`（家の受信箱）に残る。

## 試作のままにしてある点

- gateway 外配送用の `standalone_sender_fn` は登録してあるが、実測した 2 版では `hermes cron tick` が adapter を自分で起こして `send` を呼ぶため、この口は呼ばれなかった（未実測）。
- `lab-fail-home` / `lab-no-recovery` の印ファイルは障害を起こすための実測用。
- Telegram 送信は 4000 字で分割するだけで、再送間隔の調整は無い。書式変換は Task Board と cron の 1 通に収まる本文だけ。
- Task Board と cron の通知も channel 宛では Telegram の会話 session へ mirror されない（返信の文脈は家の会話と本文・Notes）。
- cron job の届け先は job ごとの設定。agent が作る job は hook が channel 宛へ書き換える（BOXP-556）。それ以外の方法で Telegram 宛に作られた job は回復 loop が channel 宛へ移す。移す前（最長で回復間隔）に実行された分は Telegram にだけ届き、家の受信箱には載らない（本体 patch 撤去後）。
- 起動時自己検査は結果を journal と gateway の log（warning）に書くだけで、監視へは繋いでいない。
- Alertmanager 通知は channel 宛になったので、Telegram の会話 session への mirror（`mirror_to_session`）は無い。
