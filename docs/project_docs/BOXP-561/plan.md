# BOXP-561 localllm 実用途評価：Qwen3.8 系と現行 Qwen Coder を小説・Task Board の完走で比較する

## 目的

短い bench（tok/s、15 要求の合否）ではなく、実際に使うフローを最初から最後まで通して比べる。

1. **daily hitohako novel フロー**：`Infrastructure/Codex Cron/prompts/daily-hitohako-news-novel.md` の手順（設定を読む → 着想 → 短編を書く → 指定の場所に保存 → 末尾の各節）を local model が agent として完走できるか。
2. **Task Board フロー**：自然文の依頼票が `localllm-coder` に割り当てられてから、runner が実行し、成果を検証して Done にできるまで。

同じ開始資料・同じ依頼で、最終成果の品質、完走の可否、時間と資源、人や別 agent の救援が要ったか、どこで失敗したかを比べる。失敗はモデルの能力とハーネスの不具合に分けて記録する。Done に移ったことだけでは合格にしない。

## 現配備（2026-11-16 確認）

| 項目 | 値 |
|---|---|
| runtime | `local-llm/llama-server` router、image `llama-sycl@sha256:f74b5341…`（b11669）、`--models-max 1 -c 262144 --parallel 1 -fa auto --reasoning off --jinja`、golyat-4（Arc 140T、RAM 93 GiB） |
| 既定 | `gemma4-26b`（変えない） |
| 現行 Qwen Coder | `qwen3-coder-next`（unsloth Q4_K_S、45.5 GB）。`localllm-coder` の既定モデル（pi agent 経由） |
| Qwen3.8 系（router 登録済み） | `qwen38-flash-next`（ISTA-DASLab GSQ-RCO Q2_0、mmap）、`qwen38-27b`（HauhauCS Q4_K_P） |
| Qwen3.8 系（node にあるが router 未登録） | Flash-Next IQ3_S（BOXP-557）、IQ3_XXS、UD-Q4_K_XL |
| 受付 | envoy の admission gate（`open|closed|verify:<token>`）。変更は BOXP-349 の runtime file queue 経由 |
| daily novel の本番 | codex-cron の `claude` runner + `sonnet`、1 日 3 回。Web 検索と Codex 画像生成を使う |

## 比べるモデル

| 記号 | モデル | 理由 |
|---|---|---|
| QCN | `qwen3-coder-next` | 現行 Qwen Coder（基準） |
| FN | `qwen38-flash-next`（Q2_0） | Qwen3.8 系の主候補。router 登録済みで、preset の変更が要らない |
| Q27 | `qwen38-27b`（Q4_K_P） | Qwen3.8 系の dense 候補。遅いので、合成側で完走の見込みがある場合だけ実バースへ進む |

IQ3_S（557）は router 未登録のため、一段目では使わない。FN の結果が「量子化が足りないせいで落ちた」と読める場合に限り、二段目として一時 preset（lolice PR → 試験 → revert）を検討する。新しい weights は取得しない。

## 試験

### N1 小説（合成、cloud が読める）

- 資料：非私的な合成設定「灯火街」（`Projects/gemma4-31b-evaluation/artifacts/fixtures/synth-setting/`、決定・却下・下書きの罠を含む 21 ノート）。
- 依頼：本番 prompt の手順・作風・制約を保ち、パスだけを隔離コピーに置き換える。Web 検索の代わりに固定の着想メモ（非私的な季節の話題 3 件）を渡す。挿絵の生成は cloud API なので行わず、「## 挿絵生成メモ」に理由を書かせる（本番 prompt の失敗時手順と同じ）。
- 判定（機械）：完走（終了、出力ファイル 1 件）、ファイル名の形式、既存ファイルの改変 0、`## 追加設定メモ` / `## 着想元メモ` / 使用設定リンク / `## 挿絵生成メモ` の有無、本文の文字数、日本語率、「，」・CP932 外・英文の混入、反復。
- 判定（品質）：cloud（担当）が本文を読み、設定との矛盾（罠の決定に反していないか）、キャラの口調、構成、読みやすさを固定 rubric で採点する。
- 対照：同じ資料を一括で渡す single-shot 生成も 1 本作る。agent では落ちて single-shot では書ける場合は、ハーネス（tool 利用や長い context）側の問題と読む。

### N2 小説（実バース、local のみ）

- 資料：`ひとはこさんバース/` の 3 ディレクトリと `小説草案/` を run workspace 内へ読み取り用にコピーする。出力は隔離コピーの `小説草案/AI執筆/` に書かせる。
- cloud（担当と delegate）は本文・設定・要約を読まない。機械判定はスクリプトが件数・有無・数値だけを出す。
- 本文は Owner が読み比べられるよう `Projects/localllm-practical-eval/outputs/novel-real/<model>/` に置く（vault 内の私的領域。既存の BOXP-294 と同じ扱い）。品質の最終判断は Owner。担当は「本番 sonnet の同日出力と比べてどうか」を判断しない。

### T1 Task Board（coding、自然文依頼から Done まで）

- 依頼：BOXP-382 と同じ自然文（`ansible-apply-targets.sh` が `.yaml` の playbook をノードに対応付けない）。origin/main ではまだ直っていないので、現 main を base にそのまま使える。
- 経路：scratch vault（Board と票 1 枚だけ）で本番と同じ `task_board_runner.bb` を `assignee: localllm-coder`、`CODEX_TASK_BOARD_LOCALLLM_CODER_MODEL=<model>` で 1 tick 回す。pi の provider 設定は scratch の `models.json`（base URL を受付を通らない直接経路に向ける）。
- 検証（固定、開始前に決める）：patch を origin/main の独立 worktree に当てて、追加 3 件が修正前に落ちて修正後に通る、既存 52 ケースが残る、全体 55/55 pass、変更は script と test の 2 ファイルだけ。満たした場合だけ scratch の票を Done へ動かす。
- 本番 vault の票には書かせない（BOXP-383 batch8 で起きた混入を防ぐ）。

### 回数と上限

| 試験 | QCN | FN | Q27 |
|---|---|---|---|
| N1 agent | 1 | 1 | 1 |
| N1 single-shot | 1 | 1 | 1 |
| N2 | 1 | 1 | N1 で上限内に完走した場合だけ 1 |
| T1 | 2 | 2 | 1 |

- 1 run の上限：N1/N2 は 60 分、T1 は 30 分（本番の idle timeout と同じ桁）。上限で打ち切ったものは「時間内に完走しなかった」として数える。
- 失敗した run を同じ条件で盲目的に再試行しない。基盤側の中断（GPU HANG、tunnel 切断など）だけは理由を記録して 1 回まで置き換える。

## 安全

- 受付：GPU を使う区間は gate を `closed:BOXP-561-<run>` にして、upstream の active/pending が 0 になってから始める。試験の要求は envoy を通らない直接経路（node から pod の netns の 127.0.0.1:8081 へ）で送る。1 回の閉鎖は 90 分以内。区間ごとに開け直す。
- 開始前の確認：sd-switch が `llm-open`、GPU を使う他の票が進行中でない、MemAvailable、GPU HANG/reset の件数。
- 中止：MemAvailable < 12 GiB が 2 回続く、HANG/reset が増える、ready が 600 秒以内に来ない。
- 復帰：直接経路で `gemma4-26b` を読み込ませて実推論 → gate を open → LAN 経路で実推論、`/health`、models 一覧、sd-switch を確認。
- 変えないもの：既定モデル、`models.ini`、Deployment、本番の cron job と prompt、本番の連載（`小説草案/` の原本）と進行票。既存モデルは削除しない。新しい weights・課金・権限は使わない。
- pi の bash tool は同じ uid で絶対パスを読める（OS sandbox ではない）。そのため、本番 vault の保護対象（`ひとはこさんバース/`、`小説草案/`、`Boards/`、評価対象の票）の hash を run の前後で比べ、変化があれば記録して止める。

## 成果物

- `Projects/localllm-practical-eval/README.md`：実結果、条件差、未確認、用途別推奨（日本語）。
- 機械判定の結果と run の metadata：`Projects/localllm-practical-eval/artifacts/`。
- 実バースの本文：`Projects/localllm-practical-eval/outputs/novel-real/`（Owner 用）。
- ハーネス：このディレクトリの `tools/`。

## 段階

1. 調査と設計、ハーネスの作成（この PR）。
2. QCN の GPU 区間（N1、N1 single-shot、N2、T1×2）。
3. FN の GPU 区間。
4. Q27 の GPU 区間（N1 の結果で範囲を絞る）。
5. 集計と推奨を Projects に書く。必要なら IQ3_S の二段目を Owner に提案する。
