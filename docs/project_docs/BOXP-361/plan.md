# BOXP-361: Novel Board の Backlog 要件整理（cloud groom）契約不整合の修復

## 症状
cloud agent（codex-sol 等）への Backlog groom で、prompt の Goal は「`## Requirements` / `## Outline` を埋める」なのに
`Allowed writes` が Change History のみだった。指示に従う agent は Requirements/Outline を編集できず、
proposal.json を作って `NOVEL_BOARD_RESULT: blocked` を返していた（NOVEL-9 が Backlog から進めない）。

## 正本の設計（変更しない）
- cloud route: agent が管理ノートを直接編集し、runner は終了後に Requirements/Outline の充足を検査する。
- localllm route: runner がモデル出力を適用する。proposal.json を runner が適用する経路は作らない。

## 修正
1. `agent-writable-sections`: action 別の許可 section を単一定義（groom/regroom = Requirements/Outline/Change History、write/revise = Change History）。prompt はこれから生成。
2. `cloud-note-violation`: agent 実行前後で管理ノートを比較し、frontmatter（card 同期キー assignee/status/title/nsfw を除く）や許可外 section（runner 所有の Run History は除く）が変わった場合は失敗扱い（自動 revert なし）。section 区切りは実行前に存在した見出しのみ（Outline 内の `## 第1章` を許容）、空行・行末空白は無視。計画停止（shutdown）は違反判定より優先。
3. cloud mode の Reference Context / Run History 要約: 「読取 0 / 未解決 0 / なし（runner 判定）」をやめ、「候補 N 件、runner は本文未読…runner 未検証」「不足/未解決（agent 側）: runner 未判定」と表記。
4. テスト: 契約検査型 fake agent（旧 prompt では blocked）、cloud Reference Context の表記、groom/write の許可外 section 編集の検知、unit test。

## 検証
- `bb docker/codex-workspace/novel-board/novel_board_runner.bb test`
- `tests/codex-workspace/novel-board-runner-test.sh`
- CI → merge → Image Updater 配備 → 稼働 runner の readback → 通常 scheduler で SFW 合成 fixture を Backlog→groom→Draft まで確認。

## 非対象
NOVEL-9 の本文・創作内容・挿絵の生成/再生成、旧 groom proposal / Run History の変更、lock 解除・再割当はしない。
