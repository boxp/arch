# サンライズ空席監視の運用

Python 標準の HTMLParser を使用する。Babashka の既存環境には HTML parser がなく、Python は実行環境にあるため追加依存が不要。公式検索の GET のみを許可し、リダイレクトは拒否する。接続・読み取りは15秒、全体は240秒を上限とし、同時実行は非ブロッキング lock で抑止する。変更前の設定と状態の保全が必要。

設定 JSON の `legs` は方向名をキーとし、各値に `date` (ISO日付)、`from`、`to`、`departure` (JSTのHH:MM)、`stop` (同日同時刻のタイムゾーン付きISO日時)、`enabled`、`queries` を含める。各 query は公式検索 URL `url`、結果表示と一致する `train`、設備 ID の配列 `rooms` を持つ。検索種別と設備 ID の組は実装の allowlist に従う。私的な設定と state を秘密の保管場所に作り、`SUNRISE_WATCH_CONFIG` と `SUNRISE_WATCH_STATE` にそれぞれ指定する。Hermes scripts には image 内の `sunrise-watch.sh` を使う相対名の wrapper を設置する必要がある。状態ファイルの親ディレクトリは事前作成する。

状態は設備ごとの `full` / `available` と方向・検索ごとの連続失敗数・前回通知時刻で管理する。unknown は正常な前回値を保持する。初期値がない設備の空席は遷移元が不明なため通知しない。停止済み方向は `enabled: false`、出発後は自動で検索対象から外れる。両方向終了後の cron 自体の停止は運用側で行う。設定が不正または状態の読み書きに失敗した場合は stderr にエラーを出し、stdout は空となるので、cron の実行失敗を別途監視する。

切替時は旧 run が終了した安全な境界で**最新の**旧 state を取得する。各 `last_good` の「残席なし」を `full`、「空席あり」「空席残りわずか」を `available` に変換し、unknown は既存の確定値や通知履歴を確認して判断する。旧 `last_alert` と障害の連続数・通知時刻の意味を照合し、履歴を再現できない場合は切替を中止する。`python3 migrate.py CONFIG LATEST_LEGACY_STATE` は変換候補JSONをstdoutへ出すだけで、実stateを書き換えない。出力はprivate領域へ保存する。元の通知履歴・unknown観測は候補にも保持し、last_goodは新形式のroomsへ変換、検索URLが一致する障害記録は連続数と前回通知時刻を引き継ぐ。snapshot や古い参考 state をそのまま使ってはならない。新 state の書込み前に変換結果を dry-run として人が照合し、バックアップと復旧手順を確認する。旧 run と新 run の lock は共有されないため同時に書かせない。

正常な平常時の stdout は0 byte。通知は状態を原子的に保存してから stdout に出す。Hermes の stdout 配送には成功確認をこのプログラムに返す仕組みがないため exactly-once は保証できない。保存後から配送前の停止や配送失敗では通知が届かない場合があり、再起動時は自動再送しない。逆に運用者が state を戻して手動再送すれば重複し得る。配送結果の確認と未着時の手動調査を運用に含める。通知は予約確保ではない。

公式 HTML は変更され得る。日付・駅・列車・出発時刻・設備分類を照合できない場合や案内不可の場合は unknown。混雑などの継続障害は3回目から同じ方向・検索につき6時間間隔で通知する。全設備の取得成功を示すものではない。実サイトの取得結果や個人設定は private に保管する。

通知候補は `notifications` に配送未確認 (`delivery: unconfirmed`) として最大100件保持する。これは送信成功の記録ではない。切替担当はHermes側の `last_delivery_error` / `last_delivery_unverified` と配送ログを突合し、未着の候補を明示的に調査する。自動再送せず、送信済みか確認できないままstateを戻さない。現在の監視値は `rooms`、今回のunknownを含む結果は `observations` が正本となり、移行元の `last_good` / `last_alert` / `last_run` は保存された移行証跡である。

配備は通常のPRレビューとCI、現headのP0/P1ゲートを通過してからmergeし、正規image buildを確認してGitOps経路で行う。既存jobは配備とwrapper試験が成功するまで継続する。私的wrapper内で設定とstateの環境変数をexportすれば、Hermesのsubprocess環境フィルタに依存しない。共通quiet gateを通さず、この監視に承認された夜間例外だけを保つ。旧runの終了とclaim非稼働を確認し、最終stateの移行・正式job更新を安全な境界で行う。更新対象は同じjobのscript/no_agentだけとし、schedule・配送先・attachはreadbackで比較する。旧runを強制終了しない。

切替後は実tickのno_agent出力記録、LLM session非作成、平常stdoutの0 byte、通知抑制、state継続を確認する。全方向終了時は `active: false` を確認して同じjobだけを正式APIで停止する。運用権限が足りなければ、検証済commit/image・private設定・移行候補・最小手順を担当へhandoffし、切替・実tickを未達として報告する。
