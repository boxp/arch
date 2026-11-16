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
- 実施時の変更：runner の tick は回さず、`t1_run.sh` が runner と同じ prompt・pi 引数・env・patch の取り方で pi を直接起動し、`t1_finish.bb` が記録に runner の結果処理関数（`localllm-coder-events` / `result-marker` / `localllm-coder-result`）をそのまま当てる。runner が `owner-acceptance` を出し、固定検証が accepted の時だけ、Owner 受入の代わりとして scratch の票を `task-board.bb update --lane Done` で動かし、Board を読み戻して Done にあることを確かめる。runner の tick そのもの（lock、run 状態、idle timeout、Notes 追記、PR gate）は試していない。

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

## 実施結果（2026-11-16 12:25 UTC）

段階 2〜5 を実施した。詳細は vault の `Projects/localllm-practical-eval/README.md`。

- T1：QCN は 2/2 で 30 分以内に完了報告（1 本は runner の結果行を repo のファイルに書き出し、固定検証は不合格）。Q27・FN は修正内容は合格だが 30 分で完了報告に届かない。
- T1 の結果処理と Done 遷移（`t1_finish.bb` を 4 本の記録に当てた）：QCN t1a は runner 結果 owner-acceptance・検証合格で票が Done に移った。QCN t1b は runner 結果 owner-acceptance だが検証不合格で Done に移さない（runner だけでは混入を止められず、受入側の確認が要る）。Q27・FN は exit 124 で runner 結果 blocked、Done に移さない。Task Board フローを Done まで通せたのは QCN の 1/2。本番 runner の tick を通した確認は未実施。
- N1/N2 小説：QCN の pi agent だけが完走（合成の採点 2/5、実バース本文は Owner の読み比べ待ち）。Q27 の agent は 38〜60 分で本文に届かず、FN の agent は指示逸脱で成果 0。一括生成は 3 モデルとも 1/5。
- 推奨：localllm-coder の既定は QCN のまま。二段目（IQ3_S など）は Owner 判断。
- Owner の評価軸（速度は参考、成果の品質と任せられる仕事の広さを重視）で見直し：時間切れ・中断を「未評価」、成果を見た上での不良を「品質不良」に分けた。Q27 は T1 の途中成果が合格で指示逸脱も無く、品質は未評価（遅いだけでは不採用にしない。確かめるには上限を延ばした T1 が要る、Owner 判断）。FN は指示逸脱（外部 RSS 取得）と一括の崩れという品質面の理由で非推奨。QCN 維持の結論は速度を外しても変わらない。対応範囲は T1 1 種と短編小説しか見ていない。
- 一括生成（n1s）は過去 3 本とも着想メモを渡していなかったため、`novel_singleshot.bb` が着想メモと小説草案も渡すよう修正した（再計測はしていない）。
- gate の閉鎖は各区間 90 分以内。workspace の計画停止による中断 5 回は、次の run の `recover.sh` か dead-man で復帰した。本番 vault の保護対象は評価による変更 0。

## TD-02: 時間上限なしの継続評価（2026-11-16 14:05 UTC 追加）

Owner は時間より実際のアウトプットを読み比べたい。そこで、30/60 分の上限や workspace 停止で終わった run を品質の判定に使わず、成果が出るまで続ける。

- 方式: `tools/long_run.sh`。pi の session を `--session-dir` に保存する。中断したら、次の GPU 区間で `--continue` を使い、中断した事実だけを伝えて再開する（指示の追加やヒントは与えない）。SIGTERM と SIGKILL のどちらで中断しても再開できることを gemma4-26b で確認した。
- job の状態は `workspaces/BOXP-561/longeval/long-MODEL-KIND/` に置く。run の workspace が替わっても残る。
- 終わり方の区別:
  - exit: 完了。成果の有無と品質は後段の check/verify で判定する。
  - abort: 閉鎖期限・メモリ・GPU 異常・workspace 停止による中断。次の区間で再開する。
  - idle: events.jsonl が 30 分伸びない。2 回で stalled（進捗のない停止）とする。
  - nonconvergent: tool 呼び出しが 600 回を超えるか、同じ呼び出しが 15 回を超える（反復）。
- 安全: 1 回の閉鎖は最大 180 分（`BOXP561_CLOSURE_MIN`）。期限が来たら restore し、通常の受付に戻す。dead-man、obs による中止条件、guard、私的本文を local に限ることは従来どおり。
- 対象: Q27 と FN の t1・n1・n2（いずれも時間切れで未評価だったもの）。QCN の既存成果は再利用する。
- 納品: `Projects/localllm-practical-eval/読み比べ.md` を一つの入口とし、各モデルの本文と成果物へリンクする。

### TD-02 の実施結果（2026-11-16 23:18 UTC）

| 課題 | Q27 | FN |
|---|---|---|
| T1 | 34 分で自力完了。固定検証に合格し、Done に到達 | 22 分で自力完了。期待値を `"$WORKER"`（値は同じ）と書いたため、字面の固定検証では不合格 |
| N1（合成） | 32 分で完了。採点（Codex 委譲）は総合 2 で、QCN agent と同点 | 中断と再開を経て計 47 分で完了。ただし本番 vault を読んでから執筆（逸脱）。local 限定で未採点 |
| N2（実バース） | 82 分で完了。本文は Owner が読み比べる | 非収束：空の台詞「「」」の追記を 27 回繰り返し、閉鎖期限で中止 |

- 区間は q27L1（151 分）、fnL1（34 分、vaultwatch の誤検知で中止）、fnL2（179 分）、fnL3（178 分）。どの区間でも受付の復帰と実推論を確認した。HANG は 0、MemAvailable の最小は 31.0 GiB。guard の差分は本番 cron と他の票による Board の変更だけで、評価による変更はなかった。
- 運用中の修正は 3 点。状態判定の set -e 不具合（finalize を追加）、vaultwatch の追加、再処理中の idle 誤判定を防ぐ slot 確認。
- レビュー後の追加: vaultwatch は tool 実行開始後の事後検出で書込みを防げないため、pi 拡張 `tools/vaultguard.ts` を `long_run.sh` で `-e` 読込みし、本番 vault 配下への write/edit と本番 vault のパス要素（obsidian-headless / Documents とその glob）を含む bash を実行前に拒否する（判定不能は拒否）。模擬サーバの tool 呼び出しで bash/write とも拒否・vault 変更 0 を確認。vaultwatch と guard は二次防御として残す。今回の評価結果は本変更前のもので、再計測はしていない（過去 T1 で本番 vault を ls した 6 呼び出しは今後は拒否される）。
- 読み比べの入口は Obsidian の `Projects/localllm-practical-eval/読み比べ.md`。
- レビュー後の追加2: `cd /home/boxp; rm -rf Doc*/obs*/BOXP` のような相対 glob が拒否されない穴を修正。bash は引用符/バックスラッシュを除いてから照合し、glob を含む各パスセグメントを正規表現化して本番 vault パスの要素（home/boxp/Documents/obsidian-headless）のどれかに一致しうれば拒否（`*` 単独・`[D]ocuments`・`?ocuments` も拒否、解釈できない括弧は拒否）。`*.md`・`tests/*.sh`・scratch 向け task-board.bb は許可。13 ケースで期待どおり。
- レビュー後の追加 2: vaultguard の文字列照合は変数展開（`D=Doc; E=uments; rm -rf /home/boxp/$D$E`）やスクリプト経由で回避でき、`read` 系 tool も検査していなかった。`tools/landlock_exec.py` を追加し、`long_run.sh` は pi を Linux Landlock（ABI 4、no_new_privs 下で非特権利用可）で囲んで起動する。`/` から本番 vault までの経路上の兄弟エントリにだけ権限を付ける許可リスト方式で、pi と bash を含む全子プロセスから本番 vault の読み書き（シンボリックリンク経由を含む）を OS が拒否する。適用後に vault を読めないことを自己確認し、Landlock が使えなければ起動しない（fail closed）。vaultguard は `read`/`grep`/`find`/`ls` の vault 配下も拒否する補助層とした。本物の pi と模擬サーバで、変数展開した `ls`/`touch` がどちらも Permission denied・vault 変更 0、作業ディレクトリへの書込みは成功を確認。既存のハードリンクは対象外で、guard.bb の digest 照合で検出する。
