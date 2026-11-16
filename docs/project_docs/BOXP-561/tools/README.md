# BOXP-561 ハーネス

計画は `../plan.md`。どのスクリプトも、`BOXP561_TMP` に `/home/boxp/.codex-task-board/workspaces/BOXP-561/` の下にある既存の絶対パスを設定してから実行する。出力や run ディレクトリもその下に置く。実バースの資料と生成された本文は私的な情報として扱い、cloud には渡さない。

## GPU 区間（1 区間で 1 モデル、受付の閉鎖は 90 分以内）

`session.sh MODEL TOKEN PLAN` が次の順で進める。

1. 事前確認（`ops.sh preflight`）：gate が open、sd-webui の replicas が 0（llm-open）、MemAvailable が 40 GiB 以上、GPU HANG/reset の件数、読み込み中のモデル。
2. guard の snapshot：本番 vault の `ひとはこさんバース/`、`小説草案/`（直下と `AI執筆/`）、`Tickets/BOXP-382.md` の SHA-256 と、本番 Board 上の `EVAL561-*` カードの数。
3. 受付を閉じる（`ops.sh close`）：BOXP-383 の file queue（`rtapi.sh gate`）で gate を `closed:BOXP-561-TOKEN` にし、外部から 503 が返ることを確かめる。そのあと envoy の upstream active/pending が 0 になるのを待つ（`ops.sh drain`）。deployment の scale は変えない。
4. 直接経路（`tunnel.sh up 18561`）：node の 127.0.0.1:18561 で `relay.py` を root で起動し、pod の netns に setns してから 127.0.0.1:8081（llama router、envoy を通らない）へ中継する。手元からは `ssh -L` で 127.0.0.1:18561 につなぐ。
5. 観測（`obs.sh start`）：30 秒ごとに MemAvailable、load1、GPU HANG/reset の件数、gate の状態を記録する。MemAvailable < 12 GiB が 2 回続くか、HANG/reset が増えたら `ABORT` を作る。閉鎖から 90 分たったときも `ABORT` を作る。各 run は `ABORT` を見て止まる。
6. モデルの読み込み（1 token の要求、上限 600 秒）を経て、PLAN の各手順を実行する。閉鎖の残りが 300 秒以下なら残りは打ち切る。
7. 後始末（trap により、エラーや INT/TERM でも必ず通る）：観測を止め、直接経路で `gemma4-26b` を実推論する。gate を `open:BOXP-561-TOKEN-end` に戻し、LAN 経路でも実推論し、`/health` と models の件数を確認する。tunnel を下ろし、guard の verify を行う。

## 中断からの復旧

workspace の計画停止などで session.sh が SIGKILL/SIGTERM を受けると、cleanup が途中で止まり gate が `closed:BOXP-561-*` のまま残ることがある（2026-11-16 の qcn1 で発生、約 63 分で復旧）。各 run の開始時に必ず `recover.sh [GUARD_EDN]` を実行する。gate が BOXP-561 の closed なら直接経路を張り直して `ops.sh restore` を行い、残った tunnel/relay を片付け、guard を verify する。tunnel.sh up は ssh -N を背景に残すので、パイプ（`| tail`）につながず必ずファイルへリダイレクトすること。

PLAN の手順：

| 記号 | 内容 | 上限 |
|---|---|---|
| `n1` | `novel_prepare.bb synth` → `novel_run.sh`（pi agent） | 60 分 |
| `n1s` | `novel_prepare.bb synth` → `novel_singleshot.bb`（一括の対照） | 60 分 |
| `n2` | `novel_prepare.bb real` → `novel_run.sh`（実バース、local のみ） | 60 分 |
| `t1*` | `t1_run.sh` → `t1_verify.sh` | 30 分 |

## 各スクリプト

- `novel_prepare.bb synth|real NEW_ROOT [--dry-run]`：資料をコピーし、`prompt.md` と `manifest.before` を作る。prompt は本番の `daily-hitohako-news-novel.md` を元に、パスだけを置き換える。変えるのは 3 点で、Web 検索の代わりに `着想メモ.md` を使う、挿絵は生成せず `## 挿絵生成メモ` に理由を書く、synth では本番固有の名前を合成側の対応物にする。real でコピーするのは設定 3 ディレクトリの `.md`、`小説草案/` 直下の `.md`、`AI執筆/` の最新 10 件。画像はコピーしない（text model なので）。
- `novel_check.bb ROOT`：新しく出力されたファイルと既存ファイルの変更を数える。全文と本文（末尾メモより前）それぞれについて、文字数、日本語率、「，」・CP932 外・英単語の数、反復を出す。ほかに見出しの有無と、リンクの数・実在するリンクの数を JSON で出す。本文そのものは出さない。
- `novel_run.sh MODEL ROOT OUTDIR PORT`：runner の localllm-coder と同じ pi の引数、専用 HOME、環境変数の許可リストを使い、`prompt.md` を標準入力で渡す。
- `novel_singleshot.bb MODEL ROOT OUTDIR PORT`：prompt と設定の Markdown をすべて 1 要求にまとめて送る（temperature 0.7、max_tokens 8192）。
- `pi_models.bb PORT OUT`：本番の `models.json` を元に、baseUrl を直接経路に向けた設定を作る。3 モデルの設定値は qwen3-coder-next と同じにする。
- `t1_prompt.bb`：scratch の vault と root を env で指定したうえで、本番の `task_board_runner.bb` を `load-file` して `prompt-for`（ai-ops は nil）を呼び、`run-localllm-coder!` と同じ末尾の文を付ける。runner の main は `babashka.file` で守られているので、load しても実行はされない。
- `t1_run.sh MODEL NEW_RUNDIR PORT`：scratch vault に票 `fixtures/EVAL561-T1.md` を置き、固定の base `d95b7cdc`（2026-11-16 の origin/main）から worktree を作って pi を 1 回実行する。runner と同じく、base からの diff と untracked を patch にまとめる。
- `t1_verify.sh PATCH`：検証の内容は試験の前に固定した。新しい worktree で次をすべて確かめる。patch が当たる、変更は script と test の 2 ファイルだけ、既存の `^check` 45 行が順序どおり残り 48 行になる、修正後の結果が 56/56、test だけを当てた旧 script では新しい 3 件が落ちる。

## T1 の方式と理由

`run-localllm-coder!` をそのまま呼ぶ方式は採らなかった。この関数は、本番 root の run 状態、workspace の準備、base の同期、プロセスの登録を一緒に行い、scratch の env だけでは副作用を切り離せると確かめられなかったからである。代わりに、prompt は runner の関数そのものから作り（runner のコードはコピーしない）、pi の引数、env、cwd、patch の取り方は runner と同じにした。runner との違いは、idle timeout の代わりに 30 分の固定上限を使うこと、Board/Notes を更新しないこと（scratch で、Done の判定は `t1_verify.sh` の accepted で行う）の 2 点。

票の文は BOXP-382 の Summary、Acceptance Criteria、Plan と同じにした。違うのは件数（現在の main は `^check` 45 行・実行 53 件。382 の当時は 52 件）と、過去の試行の経緯を外したことだけ。不具合が origin/main にまだあることは確認した（`nodes_for_playbook` の case が `.yml` しか見ていない）。

## 確認したこと（GPU は使っていない）

- 全 bash の `bash -n`。
- `ops.sh preflight` を実際に実行した（gate open、sd 0、MemAvailable 86.8 GiB、HANG 0）。
- `tunnel.sh up/check/down` を実際に実行した：直接経路で `/health` 200、models 11。推論は送っていない。down の後に relay が残っていないことも確かめた。
- `obs.sh` で 2 サンプルを取れた。
- `guard.sh` の snapshot/verify：1110 ファイルで差分 0。
- `t1_prompt.bb`：10,488 字の prompt ができ、scratch にも本番にも書き込みがなかった。
- `t1_verify.sh` を 3 通りの参照 patch で試した（patch は `BOXP561_TMP` の中だけに置き、モデルには見せない）。正しい修正は accepted=true。test だけの patch は 53/56 で false。既存の check を 1 行消した patch は順序判定で false。
- `novel_prepare.bb synth` で 21 ファイルを作り prompt を確認した。`real --dry-run` は 54 ファイル、418 KB。

## 既知の制約

- pi の bash tool は同じ uid で絶対パスを読み書きできる（OS sandbox ではない）。guard の verify で後から検出するだけである。
- 本番の小説 cron は JST 05/12/20 時（UTC 20/03/11 時）に `AI執筆/` に書き込む。この時刻にかかる区間では、guard の added=1 が cron によるものかどうかを確認する必要がある。区間はこの時刻を避けて組む。
- 試験中は CI の負荷がある（load1 12〜14）。速度は条件差として記録する。
