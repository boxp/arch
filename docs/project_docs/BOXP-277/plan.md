# BOXP-277: Task Board で localllm (Gemma 4) の文書更新アサインを実装し現行ハーネス適性を評価する

- チケット: vault `Tickets/BOXP-277`
- 設計・評価の正本: vault `Projects/task-board-localllm-docs/README.md`（owner 入口）、`evaluation.md`（ケース表・分母付き結果・失敗例）、`evidence/`（非秘密 run 証拠）
- 実装: boxp/arch `docker/codex-workspace/task-board/localllm_docs.bb`（新規）+ `task_board_runner.bb`（assignee `localllm` の経路追加）+ `tests/codex-workspace/localllm-docs-test.sh`（fake LLM で安全性 black-box）+ `tests/codex-workspace/localllm-eval/`（実 Gemma 4 評価ハーネス、CI では実行しない）

## 調査結果（Phase 0/1）

| 項目 | 事実（2026-10-23 実測） |
| --- | --- |
| 配備中 runner | `ghcr.io/boxp/arch/codex-workspace:sha-b42f09e`。runner source は arch `origin/main`（c8714c441）と同一 |
| 対応 assignee | `fable` / `claude-fable` / `claude-opus` / `claude-sonnet` / `codex*`（reasoning suffix 可）。`localllm` は未対応で、カードは無視される（Notes への記録なし） |
| 実行契約 | prompt を stdin で CLI (`claude --print` / `codex exec`) に渡し、無制限 shell + vault 全体書込み権限。stdout 末尾の `TASK_BOARD_RESULT: done|review|blocked` を runner が解釈し、review は PR URL か `TASK_BOARD_REVIEW_PR: none` を要求 |
| claim / heartbeat / 再開 | `locks/<ticket>.edn` + heartbeat、stale lock (180s) 回収、planned shutdown marker、idle timeout 7200s。lane は SSOT |
| local-llm 実 API | `http://llama-server.local-llm.svc.cluster.local:8080/v1`（llama.cpp router b11669）、model id `gemma4-26b`（`Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf`、Q4_K_M、n_params 25.2B、ctx 262144、`--parallel 1`、`--jinja`、`--reasoning off`）、認証不要（placeholder `local-llm`）、`/health` 200 |
| tool / schema 対応 | `tools` 指定で `finish_reason=tool_calls` と正しい引数 JSON を返す（実測）。`response_format: json_schema (strict)` は grammar で有効 JSON を返す（実測）。decode ≒ 14 tok/s、prefill 2K ≒ 250 tok/s（BOXP-253 計測） |
| 代替 CLI ハーネス | `pi` 1.3.0 が `llama.cpp/gemma4-26b`（maxTokens 4096）で設定済み。短い指示（PONG、1 ファイルの 1 語置換）は動くが、Task Board 形式の長い prompt では tool セットに関係なく無出力のまま固まる（900 秒 × 9 ケース + 420 秒診断 1 回）。Novel Board でも「Pi 起動不良」で不採用 |
| Novel Board 実績 | `novel_board_runner.bb` に SSE streaming + idle/total 上限 + 継続要求 + `llm-evidence.edn` の実装あり（再利用）。小説生成は「本文のみ出力」契約で、既存 Markdown を保持する編集ではないため文書更新の成功証拠にはしない |

## 方針

1. **評価（Phase 2）**: 隔離 fixture vault（実 vault/実 secret を使わない）に対し、実 Gemma 4 を 3 つのハーネスで通す。
   - H1 現行ハーネス相当: `pi -p --model llama.cpp/gemma4-26b`（read/edit/write ツール、cwd=fixture）に Task Board と同じ契約（日本語指示 + `TASK_BOARD_RESULT` marker）。
   - H2 全文書き換え: chat completion に対象ノート全文を渡し、更新後の全文を出力させて保存。
   - H3 構造化差分 adapter: 変更案を JSON schema（`replace-section` / `append-to-section` / `append-section` / `replace-text` / `needs-human`）で出させ、runner 側の trusted executor が検証して適用。v1 → v2（見出し表記の許容、表ヘッダ保護、Review 指示優先、修正ラウンド 1 回）→ v3（表ヘッダ判定の修正、曖昧依頼の停止規則）→ v4（下記の段階的収集）。
   - 単一ノート編集 12 ケース（限定差替え / 追記 / 要約→更新 / 複数参照+出典 / frontmatter・wikilink・コードブロック保持 / 日英混在 / 曖昧→停止 / 長文 / 複数ターン改稿 / 命令注入 / 秘密要求 / allowlist 外）。H3 は各版 2 反復、H1/H2 は 1 反復。判定は決定的 checker（frontmatter 同一・範囲外差分 0・リンク/フェンス保持・期待文字列・根拠に無い数値）+ claude-fable の目視（LLM 自己採点はしない）。
   - 予算: GPU 直列、合計 2.5 時間 / 60 リクエスト上限、HTTP エラー 3 連続または Novel Board lock 出現で停止。
2. **主用途の評価（owner 重点: 多数資料から別ノート更新）**: `corpus_fixture.bb` が設計メモ（旧版 superseded / 現行）、決定記録 ADR（採用 / 却下 / 検討中 / テンプレート）、週次進捗（古い版と最新）、会議メモ（予定 = 未稼働）、同名類似の別プロジェクト（`sample-streamer`）、無関係 padding（規模 S=0 / M=40 / L=160 ノート、語彙を重ねて検索を濁す）を生成。正解根拠・必須事実・誤採用禁止情報を `corpus_cases.edn` に事前定義。
   - 対照条件 **given**（チケットに正解資料を wikilink で列挙、現行の参照収集）と **search**（`docs-sources:` に corpus フォルダだけを宣言し自力探索）を分け、探索漏れ（gold 資料の読取率）と読後の統合/編集誤り（checker）を別に計測。
   - 規模 S / M（総量 29.8k 字 > context 予算 24k 字）/ L（175 ノート 107k 字、index 6k 字予算も超過）、hub ノートからのリンク追跡、解消不能な矛盾（採用 ADR の 8082 vs 「8081 のまま運用」）→ 停止、資料に無い事実（SLO）→ 停止、同名プロジェクトの混同、採用済み ADR だけを出典 wikilink 付きで統合。各 2 反復。
   - 計測: 成功率（分母付き）、gold 読取率、禁止資料の出典化、探索回数（search / read / round）、根拠文字数、token、時間、打ち切り理由。
3. **実装（Phase 3/4）**: `localllm_docs.bb` を runner に組み込み、`assignee: localllm` かつ frontmatter `docs-target:`（vault 相対 path）の明示 opt-in がある票だけを実行。runner 側で強制: allowlist root（`CODEX_TASK_BOARD_LOCALLLM_DOCS_ROOTS`、既定 `Projects/task-board-localllm-docs/pilot`）、canonical path / symlink 拒否、`.md` のみ、frontmatter 不変、base hash による競合検査、原本 backup、原子的保存、失敗時不適用、audit（`localllm-audit.edn` / `llm-evidence.edn`）と rollback コマンド。結果は常に Review（担当 boxp）か Blocked（理由付き）で、Done にしない。model 到達不能時は cloud に切り替えず Blocked。
   - **adapter v4 段階的収集**（`docs-sources:` opt-in）: 資料群は全文を渡さず、index（path / タイトル / 見出し、6k 字予算）→ model が JSON schema で `search`（語句一致、上位 8 件 × 3 行）/ `read`（ノートまたは節、3.5k 字まで）/ `finish` を選ぶ → runner が中継（最大 6 回、根拠 14k 字、900 秒、進展なし 2 回で打ち切り）→ 集めた根拠だけを編集段階に渡す。編集提案の `sources` は読んだ資料に限り、無ければ適用しない。資料は read-only で参照許可 root 外・symlink は拒否。Review の Notes に出典・調査量・読んだ資料を記録。
4. **非干渉**: 既存 cloud 経路・Novel Board・稼働 run・lolice manifest は変更しない（env 既定値で動く）。`autonomy_policy.bb` の v2 schema registry は触らない（実行許可ではないため）。
5. **E2E**: merge → image build → GitOps 配備は Pod 再作成を伴うため、本 run（同 Pod 内）からは merge しない。配備前に、この Pod 内で `tick --ticket <テスト票>` を実 vault・実 API・専用テストノートに対して 1 回実行し、assign → 多数資料（pilot 配下の専用参照ノート群）の探索 → 限定差分 → Review 停止 → Obsidian 側で閲覧できることを確認する（他の候補カードには触らない）。配備後の sidecar での再確認は owner の merge 後の判断事項として残す。

## やらないこと

- 新モデル download / GPU 二重 load / driver・kernel 変更 / 推論 tuning / vector DB 等の新検索基盤。認証追加 / 課金切替 / 本番インフラ変更 / 既存票の再実行 / lock 強制削除 / 他 agent 中断 / 全 vault 無条件更新。docs-only PR。

## 結果（2026-10-23、詳細は vault `Projects/task-board-localllm-docs/evaluation.md`）

- 単一ノート 12 ケース × 2 反復: H3 adapter v4 21/24（安全ケース再実行 v4.2 6/6）、H2 全文書き換え 10/12（不採用）、H1 pi CLI は Task Board 形式 prompt で無出力 timeout のため測定不能（不採用）。
- 主用途（多数資料 → 別ノート）9 ケース × 2 反復: 正解資料付与 4/4（S・L）、自力探索 S 規模 4/4、M/L 規模 0/4 → v4.1（runner の自動読取）で 2/4、矛盾・不足での停止 4/4、同名混同 2/2、採用 ADR の出典付き統合 2/2。旧版・却下・検討中・予定・別プロジェクトの誤採用は 0、無言欠落は 0。
- 観測した危険挙動と対策: JSON grammar 下の暴走生成（6144 token / 568 秒）→ 繰り返し検出で打ち切り・max_tokens 到達は再提案なし。秘密転記要求でプレースホルダ節を追加して偽成功 → 認証情報語彙の追記を executor が遮断。表の孤立行・見出し重複 → executor で結合・除去。既存見出しへの append-section → 一意な見出しなら追記として扱い、同名見出しが複数ある場合は新設せず拒否（codex review）。
- E2E（配備前、Pod 内 `tick --ticket BOXP-278`、実 vault の専用テストノート + 5 件の専用参照ノート）: 1 回目は executor の検査で Blocked（未適用）、修正後の 2 回目で Review 停止・正しい更新・出典記録を確認。Done には遷移していない。
- 採否: 文書更新専用の限定採用（明示 opt-in、pilot root、Review 必須）。50 件超 corpus の自力探索は下書き専用。配備（merge → image → lolice bump → Pod 再作成）は未反映。
- codex review 対応（v4.3）: 段階的収集の総時間上限（既定 900 秒）を各 LLM 呼出しの残り時間として渡す（1 回目が固まっても上限内で停止）。認証情報語彙を含む追記・変更行はノート内に既出でも全て拒否。`sources` は読んだ資料だけに限定し、search 該当のみの資料は出典にできない（モデルが読まずに finish した場合は runner が上位該当資料を読んでから編集へ渡す）。文書の書込みは runner の lifecycle commit（停止 monitor 下、Notes / lane 遷移と同じ区間）まで遅延し、全 localllm 書込みを 1 つの OS file lock（`<root>/locks/localllm-docs-write.lock`）で直列化して競合再確認→backup→書込みを行う（同じ docs-target の 2 票が並列でも片方は競合で停止、計画停止でノートだけ更新済みにならない）。書込み直前に lock 内で path を再検証（snapshot 後に許可ディレクトリが symlink に差し替えられても書き抜けない）。1 回の依頼で送る文字数に上限（`CODEX_TASK_BOARD_LOCALLLM_MAX_PROMPT_CHARS`、既定 60,000 字）を設け、超える場合はモデルを呼ばず Blocked。blocked 結果の Notes / run summary も lifecycle commit 内で最終化。書込み後の遷移失敗は backup から復元して Blocked。読取は O_NOFOLLOW、書込みは temp 作成直前 / rename 直前に symlink guard（openat が無いため完全には閉じない残限界を明記）。Notes の出典は runner が解決・読取した path だけ。rollback も同じ write lock 内で検査・復元。強制終了で書込み後に完了しなかった run は stale lock 回収時に audit から検出して復元。復旧の「遷移完了」判定は ticket の `status`（Review 再実行では開始時点から review で run 固有でない）ではなく、lifecycle commit 内で書く run 固有の `localllm-committed.edn`（lane 移動直前に `:committing`、frontmatter 更新直後に `:committed`）だけを見る。journal 無し→backup から復元、`:committing`→検証済みの書込みを保持して lane / frontmatter 遷移を冪等に完了（Review と文書内容が食い違う状態を残さない）、`:committed`→何もしない。docs-target と参照ノートも読取前に O_NOFOLLOW でサイズ検査（max-note-chars×4 bytes、対象は Blocked・参照は skip）。docs-sources の各ノートは読取直前に path 全体を再検証し（列挙後に中間ディレクトリが symlink へ差し替えられても追従しない）、O_NOFOLLOW でサイズを検査して 1 ノート（既定 1,000,000 bytes）/ 合計（既定 32,000,000 bytes）の上限を超えればモデルを呼ばず Blocked。チケットの `docs-target` / `docs-sources` は空白のみ trim し、先頭 `/` は resolver が絶対 path として拒否（list 分割時の正規化で vault 相対に変換しない）。書込み直前の競合検査は再検証に成功した path だけを読む（中間ディレクトリの symlink 差替え後に vault 外を読まない）。複数 docs-target の書込みは各ファイルの書込み直前にも存在/hash を再確認し、途中で外部編集を検出したら書込み済み分を backup から復元して競合として Blocked。修正ラウンド（拒否理由を添えた再依頼）の送信内容にも文字数上限を適用し、超過なら 2 回目を送らず Blocked。復旧ジャーナル（backup path と書込み予定の hash を含む `:applied`）は最初の 1 byte を書く前に audit へ永続化し、書込み直後〜最終 audit の間で強制終了しても次の tick の stale lock 回収で復元できる（未書込みのノートは before hash 一致で「unchanged」）。モデル出力・ノート本文に由来する文字列（needs-human の理由、見出し・old_text・path・JSON エラー断片・失われるリンク等）は sentinel で印を付け、Notes / last-message へは固定の placeholder に置換して出さず、audit の `:reason` にだけ残す。`tick --ticket BOXP-N` は stale lock / planned-shutdown の回復を対象票に限定し（対象票自身の計画停止 lock は即時回収、他票の lock と owner marker は loop に委ねる）、対象票だけを実行する。`append-section` は heading が未存在のときだけ新設し、一意に存在すれば追記、同名見出しが複数あれば拒否（第 3 の同名見出しを作らない）。`apply` 提案を適用しても本文が変わらない（例: replace-text の old_text = new_text、末尾空白のみの差）ファイルは「変更なし」として拒否し、Review へ進めない。Review note（文書更新を主張する最初の記録）を書く前に遷移 journal `:committing` を永続化し、note 直後〜lane 移動前の強制終了は次の tick で遷移完了（文書保持）として復旧する（note と矛盾する rollback を残さない）。遷移失敗で rollback した run は journal を `:rolled-back` にして後続の復旧対象から外す。`:committing` の復旧は write lock 内で audit の各 `:after-sha256` と現在の内容を照合してから遷移を完了し、強制終了後に対象ノートが手で編集・復元・削除されていた場合は遷移せず（backup からの復元もせず）Blocked にして journal を `:conflict` にする（編集済みのノートを「適用済み」の Review として見せない、テスト BOXP-782）。`tick --ticket BOXP-N` では board / frontmatter の status 同期も対象票に限定し、手で移動して未同期の他票の frontmatter や card 行を書き換えない（テスト BOXP-726 を拡張）。black-box 47 本。

## Owner 目的訂正後の計画（2026-10-24、run 20261023T233535Z）

Owner の訂正（2026-10-23 16:46 / 23:11）: 最終目的は「ひとはこさんバースの多数の設定資料を自力参照し、既存の確定設定（canon）と新規提案を区別して別文書へ新設定を加筆案として描き足す」運用。上記の事実転記 adapter v4.3 + 安全 executor（PR #13838）は土台であり、pilot 限定採用や CI pass では本票は完了しない。

### 実装: 設定提案 mode（`docs-mode: propose`）

- 資料調査は v4 の段階的収集（index → search → 節 read）をそのまま使い、設定向けの観点（人物の基本情報・口調・衣装・関係性・年表・retcon の有効版・未承認下書きの区別）を調査 prompt に追加。
- 編集段階は JSON schema `{decision: propose|needs-human, title, canon_facts[{fact, source}], proposal, conflicts[], questions[], sources[]}`。runner が対象ノート末尾に `## 提案（未承認）BOXP-N` 節を **1 つだけ** 追加（Review 改稿では同節を置換）。canon 本文は構造上変更されず、未承認案の自動昇格なし。
- 「資料に無い」は停止理由にしない。needs-human は対象不明・設定提案でない依頼（ファイル/チケット/秘密）・canon 本文の書き換え依頼だけ。
- 案と根拠を照合する自動検査 1 回（`verify-proposal!`）。結果は「（自動検査）」付きで矛盾・要確認へ。失敗しても run は止めない（shutdown のみ伝播）。
- canon_facts の出典は runner が読んだ資料 path に限定（未読は除外・全滅なら修正ラウンド）。架空 wikilink は平文化、見出しは太字化、結果マーカー・認証情報語は従来通り拒否。
- `CODEX_TASK_BOARD_LOCALLLM_DEFAULT_SOURCES`: `docs-sources` 未宣言の票に使う既定 corpus（参照 root 検証は宣言時と同じ）。機械向け frontmatter は `docs-target` + `docs-mode` の 2 行で足りる。
- black-box: 提案 mode 6 本追加（追加 / 改稿置換 / 既定 corpus と root 外拒否 / 未読出典の修正ラウンド / needs-human と不正 mode / マーカー拒否 / corpus 無し）→ 53 本。

### 評価: 非露骨な創作設定 fixture（`setting_fixture.bb` 灯火街）

- 人物 6（似た名前 2 組: ユイ/ユキ、ミオ/ミナ）、年表、retcon 採用（ユイ 17→19 歳、旧版 superseded）、却下案（レンは幼馴染でない）、未承認下書き 2、M 規模は無関係 40 ノート（囮「料理人のユイ」含む）。
- ケース P01-P09（`setting_cases.edn`）: 新衣装 / 初対面エピソード / M 規模 / 別人（ユキ）の口調 / 依頼が canon と矛盾→矛盾を明示して提案 / canon 書き換え依頼→停止 / 対象不明→停止 / Review 改稿 / 新規ノート。各 2 反復、自力探索条件。
- checker: canon が byte 一致の prefix として保持、提案節が 1 個、新規提案に canon 誤り・未承認案・別人の口調が無い、矛盾小節に期待語、出典に旧版/未承認/囮が無い（retrieval）。加えて claude-fable が本文を目視。

### pi（H1）無出力 timeout の有限診断

- 5 試行・各 ≤240 秒・`/slots` 観測。結果は vault `evidence/pi-diag-2026-10-24/`。900 秒 hang は再現せず、失敗は「tool 結果後に `<tool_call|>` を本文として出して空出力終了」（5 回中 2 回）＝ harness/template 側。localllm 経路は pi 非依存。

### 配備と E2E の実施条件

- PR #13838（gate 済み・MERGEABLE）は許可範囲内で merge する。image build → argocd-image-updater → Argo 自動 sync で Pod が再作成されるため、**他の active run（`locks/`）が無い区切りで本 run の最後に merge** する。配備後の E2E（専用テストカード BOXP-278 転記 / BOXP-279 提案）は配備済み runner で次 run が実施。配備前の E2E は本 run 内で `tick --ticket` により実 vault の専用テストノートへ実施。

### 結果（2026-10-24、run 20261023T233535Z、詳細は vault `evaluation.md` §7）

- 設定提案 mode の実 Gemma4 評価（自力探索、各 2 反復、18 run）: **15/18**。新衣装 2/2、初対面エピソード 2/2、M 規模 2/2、別人の口調 2/2、依頼が canon と矛盾 1/2、canon 書き換え依頼の停止 2/2、代名詞だけの対象 0/2（唯一の男性人物と解釈して提案。ケース設計が弱い）、Review 改稿 2/2、新規ノート 2/2。canon 破壊・未承認案/却下案/旧版/囮の事実採用・架空リンク・範囲外変更は 0。1 run 90〜250 秒、prompt 計 15k〜50k token。
- 自動検査（案と根拠の照合）は姉妹の設定を取り違える false positive を出す。矛盾欄に「（自動検査）」付きで出るだけで適用は止めない。
- pi（H1）無出力 timeout の有限診断: harness 側（`<tool_call|>` トークン漏れで空応答、container に models.json 未 mount）と切り分け。localllm 経路は非依存。
- codex review（ローカル 6 回）の P2 計 7 件を修正。black-box 54 本。
- 採否: 設定提案を限定 pilot（明示 opt-in、pilot root、Review 必須）で採用。依頼の前提が canon と矛盾する依頼・50 件超 corpus は下書き専用。実資料の root / scope は owner の判断。

## 配備後（2026-10-24、run 20261024T014433Z）

- 配備確認: PR #13838 / #13842 の merge 後、image-updater → Argo sync で codex-workspace Pod が再作成され（`codex-workspace-7fc96f7c84-748lm`）、`/opt/codex-workspace/task-board/` の runner 5 ファイル（`task_board_runner.bb` / `localllm_docs.bb` / `vault_writer.bb` / `autonomy_policy.bb` / `task_board_events.bb`）が `origin/main`（ea132ea9a）と byte 一致。lolice manifest の変更は不要だった（env は既定値）。
- 配備後 E2E（配備済み loop runner の通常 tick、`tick --ticket` ではない）: テストノート 2 件を前回 run の backup（配備前状態）へ戻し、BOXP-278（転記）/ BOXP-279（設定提案）を `assignee: localllm`・Ready に戻した。loop は 60 秒以内に両票を同時 claim し、他票（cloud agent の BOXP-280）と並走した。
  - BOXP-279 設定提案: 1 回目 PASS（Review 停止、提案節追加、canon byte 一致、出典 3 件、矛盾 0、llm 424 秒 = GPU を 278 と直列共有）。2 回目は人の改稿指示を Notes に書いて Ready に戻し、提案節の置換を確認（結果は vault `evaluation.md` §8）。
  - BOXP-278 転記: 1 回目 Blocked・未適用。調査が 1 read で finish し、票の Context / Notes に残る前回結果を根拠に出典へ「Notes」を挙げ、runner の「sources は読んだ資料のみ」検査が拒否した（安全側に収束、cloud 切替なし）。2 回目を同じ配備版で実行（結果は §8）。
- 修正（本 run の PR）: `ticket-brief` から runner 自身が追記する Notes（start / finish / localllm 結果 / Blocked transition / kohako relay）を除外し、「票本文は依頼であり出典にできない」注記を加えた。弱いモデルが前回結果を資料の代わりにする誘因を減らす。unit テスト追加。
- 残る owner 判断は 1 つ: 実資料の root / scope（参照を許す最小フォルダ、提案節を書いてよいノート、最初の目視期間）。lolice の sidecar env `CODEX_TASK_BOARD_LOCALLLM_DOCS_ROOTS` / `READ_ROOTS` / `DEFAULT_SOURCES` で与える。
