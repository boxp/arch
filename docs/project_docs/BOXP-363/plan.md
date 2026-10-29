# BOXP-363: Novel Review の挿絵生成指示を参照探索と画像だけの再開へ反映する

## 症状
Review Instructions で挿絵を求めても、通常の改稿（:revise）として本文を毎回書き直したうえで
「参照画像が管理ノート/参照設定に埋め込まれていない」と挿絵を生成せず Review へ戻る。

## 原因（novel_board_runner.bb、main 7396b3733 = 配備版と同一）
1. `reference-image-candidates` は (a) 管理ノートの画像埋込 と (b) Requirements/Outline/Review Instructions の
   明示参照（バッククォート・wiki link）先ノートの画像埋込 しか見ない。
   - 設定探索（BOXP-305）が名前一致で見つけて Reference Context に列挙した人物設定ノートは画像候補に入らない。
   - 人物設定からリンクされた作画資料ノート（1 hop の wiki link）は辿らない。
   - 明示参照の画像ファイル名（例 `chara.png`）は Markdown として解決を試みて「見つからない」扱い。
   - 結果、agent/planner が実在画像名を選んでも候補外として捨てられ、参照画像 0 件 → 未生成。
2. Review + Review Instructions は常に `:revise`。画像だけの依頼でも本文を改稿し、cloud route では
   「原稿が変更されていない」と失敗扱いになるため、本文を変えずに挿絵だけ作る経路が無い。
3. `generate-illustration!` は生成前に既存 illustration.png を退避するため、失敗時に既存画像が消える。
   既定 prompt は本文抜粋 400 字を画像 API（cloud）へ送る。

## 方針（最小実装）
- 画像候補探索を段階化: 管理ノート → 明示参照（Markdown と画像名、作品自身の private `references/`）
  → 名前一致の設定ノート → それらから 1 hop の wiki link 先。各段で「候補発見 / path 解決 / 許可 root /
  実 bytes（magic）」を分けて検査し、探索したノート数・画像数・未解決を記録する。SFW 作品は NSFW 由来を除外。
- `:illustrate`（画像だけの再開）: Review で指示がすべて挿絵依頼、または反映済み指示に挿絵依頼が含まれ
  現 manuscript に対する挿絵が未生成のとき。本文は書かず、manuscript の sha256 を前後で照合。
  job state（`work/NOVEL-N/illustration-job.edn`）で重複生成防止と結果不明（crash）時の pending 画像照合を行う。
  成功・失敗とも Review（担当 boxp）へ戻し、失敗理由は「何を探索し何が不足か」を具体的に書く。
- 生成は pending ファイルへ出力 → 検証成功時だけ既存画像を退避して差し替え（既存画像保護）。
- 既定 prompt から本文抜粋を除く（原稿本文の cloud 転載をしない）。
- Draft 同期は `:illustrate` 成功 run も完了扱い。検証成功までは「一部未完了: 挿絵なし」を保持。

## 検証
- `bb novel_board_runner.bb test` に unit test、`tests/codex-workspace/novel-board-runner-test.sh` に black-box
  （画像だけ依頼で本文不変・生成1回・再割当で重複なし・crash 後 pending 採用・資料不足時の具体的理由と既存画像保護）。
- merge・配備後、SFW 隔離 fixture 作品で通常 scheduler 経由 Review 画像依頼 → 実 Gemini で1枚 → Preview 表示・本文不変を確認。
  既存 NOVEL-9 は操作しない。
