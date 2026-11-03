# 独立 usage pilot と source coverage（2026-11-03 UTC）

着手時 checkout HEAD `e53ce4e8f` は 2026-08-16 の commit で、稼働中 `/opt/codex-workspace/task-board/task_board_runner.bb` と checkout の同名ファイルは `cmp -s` で不一致だった。調査中に共有作業により HEAD は `419481d4c` に変わり、再確認では同ファイルは一致した。runtime 自体は Git checkout ではなく稼働 revision は未確認。checkout 全体と runtime 全体の一致は未検証。BOXP-360 の gate 予算停止と BOXP-376 の分析範囲を尊重し、その未解決コードを移植していない。

調査は既存ファイルの読み取りのみ。JSON を process 内で読み、固定 key と数値・件数のみを出力した。ログ本文、モデル名、ID、tool 引数・結果、秘密は表示・保存していない。実行中のファイルを含むため以下は固定 snapshot ではなく再実行時に変化する。権限追加・API 呼出し・モデル呼出しはない。

## source coverage

直近ファイル選択は mtime 降順。source のファイル群は相互に重なり得るので、行数を合算しない。

| source | 読取・実在確認 | 実出力で確認した field / 件数 | 欠落・二重計上・取得可否 |
|---|---|---|---|
| Codex sessions | ローカル 30 ファイル | `token_count` 305 件、`total_token_usage` / `last_token_usage` 各 305 件。各 input、cached input、output、reasoning output、total が各 305 件 | total は累積 snapshot、last は直近値。イベントを call と同一視できず、session や TaskBoard との重複も未検証。cache は input、reasoning は output の内数として別表示。cache write、call ID、親子関係、価格は unknown |
| Claude sessions | ローカル直近 30 ファイル | `message.usage` 1375 件、input、output、cache read、cache creation 各 1375 件 | message/stream 再出力の重複と親子 join 未検証。全呼出しや local/cloud 別の coverage は unknown |
| TaskBoard | `runs` 直近 events 30 ファイル | top-level `usage` 5952 件。うち `result` に input、output、cache read、cache creation 各 67 件 | usage object の存在はそのまま usage 有効を意味しない。result と session・child・review・retry の重複/累積は unknown。全 run と欠落率は未測定 |
| NovelBoard | ローカル JSONL 15 ファイル | parse 可能な event 272 件、top-level usage 10 件、input/output 各 10 件。JSON として読めない行 64 件 | 形式や途中書き込みの区別未確認。欠落があるため全体を確定できない。TaskBoard/Codex/Claude との重複は unknown |
| Hermes | 既存 kubectl read-only で関連 pod の存在を確認 | 既存 owner-summary に metadata ledger の turn / approval 実績あり | 今回 usage 出力そのものを確認できていない。呼出し token・provider・session join は unknown。pod 存在を usage coverage と見なさない |
| local Gemma / Qwen | runtime 内の関連コード参照の存在を確認 | 稼働出力の usage は未確認 | 各モデルの呼出しや token は unknown。local と cloud を混ぜない |
| cloud / subscription | Codex / Claude のローカル出力に上記 usage を確認 | provider/model や料金の値は取得していない | 個別 cloud provider の完全性・subscription 枠や金額は unknown。API 単価を適用しない |

`~/.codex/sessions` は 3376 JSONL、`~/.claude/projects` は 889 JSONL、TaskBoard runs は 1685 JSONL、NovelBoard は 15 JSONL（調査時点、全件集計ではない）。Hermes、local/cloud の実出力を網羅したとは言えない。TTFT、tool 回数、template/version、effort、difficulty、品質・受入・救援、親子対応、取得資料量は未接続。ファイルが読めない・無い場合と明示的な 0 は別である。

## 実データ観測

`usage_pilot.py` の 30 ファイル実行では token_count 305 件で、各 usage field の存在 305 件。last 値の最大は input 104603、cached input 100480、output 6739、reasoning output 733、total 104896。これらは各 field の独立した最大値であり、同一イベントや全体合計ではない。各内数も足さない。累積 snapshot を call と扱わず、重複・coverage 不明のため実呼出し総量は unknown。上記の他 source の値は別の直近サンプルであり同期 snapshot ではない。

## pilot の機能と限界

`aggregate_calls` は呼出しごとに一意な局所 ordinal と明示的な leaf/call の意味、重複排除と親子非重複が保証される入力だけを集計する実験用関数。自由文字列の model / ID / 追加 key を受け取らず、出力は件数と field 別観測合計・欠測件数だけ。parent と cumulative は除外し、同一 ordinal の不一致は拒否する。cache/reasoning と total は別々の field のまま扱う。ordinal はメモリ内のみで出力しない。未観測 field の合計は null。`observed_sum` は欠測があれば部分値であり全体の確定値ではない。呼出し元が leaf と ordinal を正しく供給することが前提で、検証不能な親子関係を推定しない。

実 source adapter は Codex の metadata 存在・最大値の棚卸しのみで、確定した call ID と親子対応がないため `aggregate_calls` には接続していない。したがって実データでの呼出し単位集計は未達。合成 fixture で動作・安全境界を検証したが、実測と混同しない。実装は production collector ではなく、任意ファイルを正規化する汎用ツールでもない。行単位 JSON parse のため一時的に本文が process memory に入るが、選択した metadata 以外を出力・永続化しない。

再現（ローカルの出力は変化する）:

```sh
python3 scripts/ai-observability/usage_pilot.py --codex-sessions "$HOME/.codex/sessions" --limit 30
python3 -m unittest discover -s tests/ai-observability -v
```

テスト 2 件成功。本文/秘密を含む未許可 key・値、cache/reasoning 内数、累積、同一 identity 重複、欠測、親子合算除外、identity の競合を合成入力で検証。非個人固定課題での matched eval は本 pilot では未実施。追加 LLM 呼出しはせず、改善率や model 優劣は主張しない。

## 親による検証と統合

調査子の委譲はdelegate.py verify成功、親もテスト2件を再実行して成功した。稼働ログの再実行ではtoken_countは311件に増えたため、305件との差を欠損や改善とは扱わない。source棚卸しとは別に、親が固定公開合成課題で実呼出し8件のmetadata-only evalを実施した（[結果と限界](matched-eval.md)、数値JSON同梱）。この8件は一callずつの隔離実行で重複・子reviewを起動しないが、既存業務の全call coverageを満たしたことにはならない。

`trivy config .`は実行したが、この環境にtrivyが無くexit127だった。Python以外のruntime/infra変更はない。新しい常駐collector・routing変更・本番反映は未実施。

## Hermes追加read-only実証（親、05:44 UTC頃）

既存podのhermes-agent imageは `sha-1b5b4d8`。新権限を付けず既存kubectl execでSQLiteを `mode=ro` / 一つのread transactionで集計した。`sessions` 2,153件、parent_session_idの非NULLは1件。input/output/api_call_countの正値は各2,129件、cache-read 1,426件、reasoning 1,701件、tool_call_count 1,315件、cache-write 0件。**全欄にDEFAULT 0があり、0と未提供を区別できない。** 正値の存在はusage sourceの実在を示すが、call単位のprovider実値coverageを保証しない。session合計は重複・累積意味を未検証なので計算しない。

既知model familyのGemma一致12件、Qwen一致0件。Qwenが全環境で使われていない意味ではない。billing_modeの既知enum subscription/api/local一致は全て0件で、他値/NULLの内容は出力していない。したがってGemma12件をlocalと分類しない。上の初回source表のHermes未確認はこの追加調査で「session counter確認済み」に更新されるが、call/親子join/local-cloud境界はunknownのまま。本文・ID・model名・provider URLは取得/出力しない。

再現は `kubectl -n hermes-agent exec -i <現在のpod> -c hermes-agent -- python3 - --db /opt/data/state.db < scripts/ai-observability/hermes_inventory.py`。出力は固定keyと数値/boolean/nullのみ。CLI失敗は固定unavailable、schema未対応はunsupported_schema。テストは不正/欠測schemaと私的文字列非出力を含む計6件に更新。

## 探索上の逸脱

親の週次接続先探索でcronディレクトリへの広すぎるrg検索が過去event本文断片をtool応答へ出した。断片はPRや正本へ転記していないが、runのtoolログには残るため全経路の本文非出力は未達。以後は既知設定/コードだけの検索と、JSON/SQLiteの固定metadata数値抽出へ変更した。collectorの新規配備や外部転送は行っていない。将来の自動batchではraw eventディレクトリを全文検索対象から外す。

## security scan補足

初期PATHにはtrivyがなかったため、公式GitHub releaseのTrivy 0.76.1を一時領域へ取得し、同releaseのchecksumと照合した。通常の`trivy config .`はcheck bundle更新待ちが続いたため停止し、`trivy config . --skip-check-update --timeout 60s`で既存cache/同梱checkによるscanを完了（exit0）。config結果59、変更外の既存設定にHIGH5/MEDIUM1/LOW7、変更pathのfindingは0。全体無指摘やcheckの最新性は主張しない。repoの設定変更・依存追加はしていない。
