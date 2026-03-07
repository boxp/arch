# ceeker: AI Coding Agent セッション・進捗モニタリングTUI 設計書

> **プロダクト名**: ceeker
> **リポジトリ**: [boxp/ceeker](https://github.com/boxp/ceeker)（新規作成予定）
> **ステータス**: 設計提案（Draft）
> **作成日**: 2026-03-03
> **関連タスク**: T-20260303-002

---

## 1. 背景・目的

### 1.1 課題

ラップトップ環境（ghq + gwq worktree + tmux）では、複数のAIコーディングエージェント（Claude Code / Codex）が並行して動作する。各エージェントはgwq worktree上で独立したtmuxセッションとして起動されるが、以下の課題がある:

1. **セッション状態の可視性不足**: 各worktreeでどのエージェントが動作中か、現在何をしているかが一覧できない
2. **進捗把握の手動作業**: progressファイルを個別に確認する必要がある
3. **tmuxセッション間の移動コスト**: 複数のtmuxセッションを手動で切り替える必要がある
4. **エージェント状態のリアルタイム把握**: Claude Code/Codexの実行状態（実行中/入力待ち/完了）を即座に把握できない

### 1.2 cmux調査結果

[manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) は macOS ネイティブのAIコーディングエージェント向けターミナルアプリケーションとして、同様の課題を解決している（2026-03-02時点のソースコード調査に基づく）:

- **確認済み事実**（ソースコード読解による）:
  - Claude Code hook統合が実装済み（`ClaudeHookSessionStore`, `Resources/bin/claude` wrapper）
  - Socket API（Unix Domain Socket）による外部制御
  - SwiftUI + AppKit + Ghostty（libghostty）ベースのmacOSネイティブ実装
  - Codex統合は `TODO.md` に未チェック状態で残存
- **評価**（上記事実に基づく判断）:
  - Linux環境では動作不可（macOS固有API依存: `LOCAL_PEERPID`, Keychain, AppKit）
  - Bashラッパー方式はClaude Code/Codexのバージョンアップ時に保守負担が発生する可能性がある

参照: T-20260302-010（cmux進捗ビュー分析、openclawタスク管理上の調査チケット）、T-20260303-001（cmux調査タスク、同上）。いずれもboxp/archリポジトリ外のタスク管理で追跡されている。

### 1.3 ceekerの位置付け

ceekerはcmuxの**Linux/WSL向け代替**として、以下の方針で設計する:

| 観点 | cmux | ceeker |
|------|------|--------|
| 動作環境 | macOS ネイティブ | Linux/WSL（tmux上） |
| UIフレームワーク | SwiftUI + AppKit | TUI（ターミナルUI） |
| ペイン管理 | 独自（Bonsplit） | tmux に委譲 |
| エージェント統合 | Bash wrapper | Hook receiver（非侵入） |
| Codex対応 | 未実装 | MVPから対応 |

---

## 2. プロダクト定義

### 2.1 名前

**ceeker** — "seek" + "er"。複数のAIエージェントセッションを探索し、状態を把握するツール。

### 2.2 リポジトリ

`boxp/ceeker` — 新規リポジトリとして作成予定。

### 2.3 ユーザー

ラップトップ環境（ghq + gwq worktree + tmux）で複数のAIコーディングエージェントを並行運用するオペレーター（主にBOXP個人）。

### 2.4 ユースケース

1. **一覧確認**: 全worktreeの状態（ブランチ、進捗率、エージェント状態）を一画面で確認
2. **tmuxジャンプ**: 選択したworktreeのtmuxセッション/ペインに即座にフォーカス移動
3. **リアルタイム監視**: エージェントのhookイベントを受信し、状態変化をリアルタイム反映
4. **進捗追跡**: progressファイルのチェックボックス解析による完了率表示

---

## 3. アーキテクチャ

### 3.1 全体構成

```
┌──────────────────────────────────────────────────────┐
│                    ceeker TUI                        │
│  ┌────────────────────────────────────────────────┐  │
│  │  Workspace List (worktree一覧 + 状態表示)      │  │
│  │  ├─ T-20260303-001  ⎇ main  ██████░░ 60%     │  │
│  │  ├─ T-20260303-002  ⎇ feat  █████████ 90%    │  │
│  │  └─ T-20260302-010  ⎇ fix   ████░░░░ 40%     │  │
│  └────────────────────────────────────────────────┘  │
│  [Enter] Jump  [r] Refresh  [q] Quit                 │
└──────────────────────────────────────────────────────┘
          │                           ▲
          │ tmux select-pane          │ inotify / poll
          ▼                           │ (read only)
┌─────────────────┐   ┌──────────────────────────────┐
│   tmux sessions │   │   State Store (persistent)    │
│   (gwq managed) │   │   $XDG_RUNTIME_DIR/ceeker/   │
│                 │   │  ┌─────────────────────────┐  │
│  session:0      │   │  │ sessions.edn            │  │
│  session:1      │   │  │ (hook CLIが直接書込)     │  │
│  session:2      │   │  └─────────────────────────┘  │
│                 │   │  ┌─────────────────────────┐  │
│                 │   │  │ Progress File Watcher    │  │
│                 │   │  │ (inotify/fswatch)        │  │
│                 │   │  └─────────────────────────┘  │
│                 │   │  ┌─────────────────────────┐  │
│                 │   │  │ gwq status Parser        │  │
│                 │   │  └─────────────────────────┘  │
│                 │   │  ┌─────────────────────────┐  │
│                 │   │  │ tmux Query               │  │
│                 │   │  │ (session/pane mapping)   │  │
│                 │   │  └─────────────────────────┘  │
└─────────────────┘   └──────────────────────────────┘
          ▲                     ▲
          │                     │ ceeker hook CLI
  Claude Code / Codex ──────────┘
  (hook → ceeker hook <event> → State Store直接更新)
```

### 3.2 コンポーネント詳細

#### 3.2.1 Hook CLI（`ceeker hook`）

Claude Code / Codex からのhookイベントを受け取り、State Storeを直接更新するCLIサブコマンド。TUIプロセスへのIPC通信は不要で、hookイベント発生のたびに `ceeker hook <event>` が起動し、永続State Storeファイルに状態を書き込む。

- **CLIサブコマンド**:
  - `ceeker hook session-start` — セッション開始通知 → State Storeにセッション追加
  - `ceeker hook notification` — 通知（進捗、質問、エラー等）→ State Storeのセッション状態更新
  - `ceeker hook stop` — セッション終了通知 → State Storeのセッション状態を完了に更新
- **State Store**: ファイルベース永続ストア（`$XDG_RUNTIME_DIR/ceeker/sessions.edn` or `/tmp/ceeker-<uid>/sessions.edn`）
- **フロー**: hook → `ceeker hook <event>` CLI → State Storeファイルを直接更新（ファイルロックで排他制御）
- **TUIとの連携**: TUIはState Storeファイルをinotify監視し、変更を検知して画面を更新する。TUIは読み取り専用であり、State Storeへの書き込みは行わない。

**重要**: ceekerはClaude Code/Codexをwrapしない。hookはユーザーがClaude Code/Codex側の設定（`--hooks` JSON / `config.toml`）で明示的に設定する。これにより:
- Claude Code/Codexのアップデートに影響されない
- 複数のhook consumerを共存可能
- ceekerが停止してもエージェント動作に影響しない（CLIコマンドはState Storeファイルに書き込むだけなのでTUI不要）
- TUIが複数起動していても問題ない（全TUIが同一のState Storeを読み取る）
- TUIが起動していなくてもhookイベントは永続化される

#### 3.2.2 State Store

全worktreeの状態を集約する永続ファイルベースストア。`ceeker hook` CLIが直接書き込み、TUIは読み取り専用でinotify監視する。

- **保存先**: `$XDG_RUNTIME_DIR/ceeker/sessions.edn`（フォールバック: `/tmp/ceeker-<uid>/sessions.edn`）
- **書き込み元**: `ceeker hook` CLIサブコマンド（hookイベント時に直接更新）
- **読み取り元**: TUI（inotify監視で変更を検知）
- **補助データソース**: Progress File Watcher, gwq status, tmux Query（TUI側でインメモリ集約）
- **排他制御**: ファイルロック（`java.nio.channels.FileLock`）で複数hookプロセスの同時書き込みを制御
- **一貫性**: hookデータは永続ファイルが正（TUI未起動でも保持）、補助データはTUI起動時にポーリングで収集

#### 3.2.3 TUI

ターミナルUI。worktree一覧、進捗バー、エージェント状態を表示。State Storeの読み取り専用クライアントとして動作し、状態の書き込みは行わない。

- **描画ライブラリ**: Clojure TUIライブラリ（後述）
- **レイアウト**: 単一リスト + ステータスバー
- **状態取得**: State Storeファイルのinotify監視 + gwq/tmux定期ポーリング
- **キーバインド**:
  - `↑/↓` or `j/k`: worktree選択
  - `Enter`: 選択worktreeのtmuxペインにジャンプ
  - `r`: 手動リフレッシュ
  - `q`: 終了
  - `/`: フィルタ（検索）

#### 3.2.4 tmux Jump

選択されたworktreeに対応するtmuxセッション/ウィンドウ/ペインにフォーカスを移動する機能。

---

## 4. データモデル

### 4.1 WorkspaceState（worktree単位の状態）

```clojure
{:workspace-id   "T-20260303-002"           ; worktree識別子
 :branch         "T-20260303-002-ceeker"     ; Gitブランチ名
 :worktree-path  "/home/node/worktrees/..." ; worktreeのパス
 :progress       {:total 7                  ; チェックボックス総数
                  :completed 3              ; 完了チェックボックス数
                  :percentage 43}           ; 完了率
 :agent-status   :running                   ; :idle | :running | :waiting | :completed | :error
 :agent-type     :claude-code               ; :claude-code | :codex | :unknown
 :session-id     "uuid-..."                 ; エージェントセッションID
 :tmux-target    {:session "gwq-T-20260303-002"
                  :window  0
                  :pane    0}               ; tmuxターゲット
 :last-message   "設計書を作成中"           ; 最新のhook通知メッセージ
 :last-updated   #inst "2026-03-03T09:30:00Z"} ; 最終更新時刻
```

### 4.2 SessionMapping（hookセッション → worktreeマッピング）

```clojure
{:session-id     "uuid-..."                 ; Claude Code/Codexセッション
 :workspace-id   "T-20260303-002"           ; 対応するworktree
 :cwd            "/home/node/worktrees/..." ; hookから取得したcwd
 :started-at     #inst "2026-03-03T09:00:00Z"
 :agent-type     :claude-code}
```

### 4.3 HookEvent（hookイベントスキーマ）

```clojure
;; Claude Code hook payload (SessionStart)
{:type        "session-start"
 :session-id  "uuid-..."
 :cwd         "/home/node/worktrees/..."
 :timestamp   "2026-03-03T09:00:00Z"}

;; Claude Code hook payload (Notification)
{:type        "notification"
 :session-id  "uuid-..."
 :title       "Task completed"
 :message     "設計書を作成しました"
 :timestamp   "2026-03-03T09:15:00Z"}

;; Claude Code hook payload (Stop)
{:type        "stop"
 :session-id  "uuid-..."
 :reason      "completed"               ; "completed" | "error" | "interrupted"
 :timestamp   "2026-03-03T09:30:00Z"}
```

---

## 5. Hook連携方針

### 5.1 設計原則: Claude/Codexをwrapしない

ceekerはClaude Code/Codexの**hookイベント受信側**に徹する。ラッパースクリプトやPATH操作は行わない。

**根拠**:
1. **安定性**: Claude Code/Codexのバージョンアップでラッパーが壊れるリスクを排除
2. **非干渉**: ceekerが停止してもエージェント動作に影響しない
3. **柔軟性**: 複数のhook consumerを並行利用可能（ceeker + 他ツール）
4. **シンプルさ**: ユーザーが明示的にhook設定する方がデバッグしやすい

### 5.2 Claude Code hookの設定例

ユーザーが `.claude/settings.json` または `--hooks` 引数で設定:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "ceeker hook session-start --session-id \"$SESSION_ID\" --cwd \"$CWD\""
      }
    ],
    "Notification": [
      {
        "type": "command",
        "command": "ceeker hook notification --session-id \"$SESSION_ID\" --title \"$TITLE\" --message \"$MESSAGE\""
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "ceeker hook stop --session-id \"$SESSION_ID\" --reason \"$REASON\""
      }
    ]
  }
}
```

> **注意**: 上記hookペイロードの変数展開方式はClaude Code/Codexの実際のhook仕様に合わせて調整が必要。これは推測であり、実装時にClaude Code hook仕様を確認すること。

### 5.3 Codex hookの設定例

`~/.codex/config.toml` でnotifyコマンドを設定:

```toml
[hooks]
notify = "ceeker hook notification --message \"$MESSAGE\""
```

> **注意**: Codexのhook API仕様は今後変更される可能性がある。仕様変更時はCLIの引数マッピングのみ調整すればよい。

### 5.4 hookが利用できない場合のフォールバック

hookが設定されていない場合でも、以下のデータソースで基本機能を提供:

1. **progressファイル監視**: worktree内のprogressファイルのinotify監視
2. **gwq status**: worktree一覧と基本情報の取得
3. **tmux query**: `tmux list-sessions` / `tmux list-panes` による状態取得
4. **完了マーカー**: タスク完了の検知

---

## 6. tmuxジャンプ仕様

### 6.1 worktree → tmuxセッションのマッピング

gwqが作成するworktreeのtmuxセッション名は、以下の規則に従う（推測、実装時に確認が必要）:

```
worktree名: T-20260303-002-ceeker-design
  ↓ gwqの命名規則
tmuxセッション名: gwq-T-20260303-002-ceeker-design
  または: T-20260303-002-ceeker-design
```

マッピング方式（優先度順）:

1. **tmuxペインのcwd照合**（primary）: `tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_current_path}'` でペインのcwdを取得し、worktreeパスと照合する。hookに依存しない。
2. **gwq status**: gwqの状態情報からworktree一覧を取得し、パスベースでtmuxペインと紐付ける。
3. **hookのcwd照合**: hookで受信したcwdとworktreeパスを照合。より正確なセッション紐付けが可能。

### 6.2 ジャンプ実行フロー

```
ユーザー: TUI上でworktreeを選択 → [Enter]押下
  ↓
ceeker:
  1. 選択worktreeのtmux-targetを解決
     tmux list-panes -a でcwdを照合し、ペインを特定
     hookデータがあればSessionMappingからtmux session/window/paneを取得
     いずれも見つからない場合: エラー表示
  2. tmuxコマンド実行
     - tmux switch-client -t <session>:<window>.<pane>
     - または tmux select-window + select-pane
  3. ceekerのTUIに戻る（自動、またはユーザーが手動で戻る）
```

### 6.3 ジャンプ先が見つからない場合

- TUIにエラーメッセージを表示: `"tmux session not found for T-20260303-002"`
- ユーザーに手動操作を案内

---

## 7. 開発スタック

### 7.1 言語・ランタイム

| 要素 | 選択 | 理由 |
|------|------|------|
| 言語 | **Clojure** | ark-discord-bot準拠、関数型プログラミングによる状態管理の明快さ |
| ランタイム | **GraalVM native image** | Go同等の起動速度・バイナリサイズ、JVMなし実行 |
| ビルド | **deps.edn** + Makefile | Clojure標準のdeps管理 |

### 7.2 主要ライブラリ（候補）

| 用途 | ライブラリ | 備考 |
|------|-----------|------|
| TUI描画 | [clojure-lanterna](https://github.com/MultiMUD/clojure-lanterna) or JLine3 | GraalVM native互換を要確認 |
| ファイルロック | Java NIO FileLock | State Storeの排他制御（hook CLI間） |
| ファイル監視 | Java NIO WatchService | inotify相当、GraalVM native対応 |
| JSON処理 | cheshire or jsonista | hookペイロードのパース |
| プロセス実行 | clojure.java.shell / babashka.process | tmux/gwqコマンド呼び出し |

> **注意**: GraalVM native image化の際にリフレクション設定やDynamic Proxyの問題が発生する可能性がある。TUIライブラリの選定はGraalVM native互換性を最優先で評価すること。これは主要な技術リスクである。

### 7.3 lint/test（ark-discord-bot準拠）

| ツール | 用途 |
|--------|------|
| clj-kondo | Clojure linter |
| cljfmt | コードフォーマッター |
| kaocha | テストランナー |
| test.check | Property-based testing（必要に応じて） |

CI設定はGitHub Actionsで構成し、ark-discord-botの既存ワークフローをテンプレートとする。

### 7.4 プロジェクト構成

```
boxp/ceeker/
├── src/ceeker/
│   ├── core.clj              ; エントリーポイント、CLIパース
│   ├── hook/
│   │   ├── cli.clj           ; hook CLIサブコマンド (ceeker hook ...)
│   │   └── handler.clj       ; hookイベント → State Store書き込み
│   ├── state/
│   │   ├── store.clj         ; State Store (persistent file + file lock)
│   │   └── workspace.clj     ; WorkspaceState管理
│   ├── source/
│   │   ├── progress.clj      ; progressファイル監視・パース
│   │   ├── gwq.clj           ; gwq statusパーサー
│   │   └── tmux.clj          ; tmuxクエリ・ジャンプ実行
│   └── tui/
│       ├── app.clj           ; TUIアプリケーションループ
│       ├── view.clj          ; 描画ロジック
│       └── input.clj         ; キー入力ハンドラ
├── test/ceeker/
│   ├── hook/
│   │   └── handler_test.clj
│   ├── state/
│   │   └── store_test.clj
│   └── source/
│       ├── progress_test.clj
│       └── gwq_test.clj
├── deps.edn                   ; 依存関係
├── Makefile                   ; ビルド・テスト・lint
├── .clj-kondo/                ; linter設定
├── graalvm/
│   └── native-image.properties ; GraalVM設定
├── CLAUDE.md                  ; AI開発ガイドライン
├── AGENTS.md -> CLAUDE.md     ; Codex用シンボリックリンク
└── README.md
```

---

## 8. MVP → 拡張フェーズ計画

### 8.1 Phase 1: MVP（目標: 1-2日）

**ゴール**: tmuxの左ペインで動作するworktree進捗モニタリングTUI（Claude Code / Codex両対応）

**スコープ**:
- [ ] progressファイル監視（NIO WatchService / inotify）
- [ ] gwq status パース → worktree一覧取得
- [ ] TUI基本表示（worktreeリスト、プログレスバー、ブランチ名）
- [ ] tmux jump（Enter キー → tmux switch-client）
- [ ] 完了マーカーによるタスク完了検知
- [ ] `ceeker hook` CLIサブコマンド + State Store永続ファイル書き込み
- [ ] Claude Code hook handler実装
- [ ] Codex hook handler実装
- [ ] hookイベント → State Store反映
- [ ] エージェント状態バッジ表示（Running / Waiting / Completed / Error）
- [ ] 最新hookメッセージの表示

**受け入れ条件**:
- 20 worktreeの同時表示で描画遅延 < 200ms
- inotify検知 → TUI反映 < 500ms
- tmux jumpが正しいpaneにフォーカスできること
- Claude Code / Codex hookイベントがTUIにリアルタイム反映されること
- JVMモードで動作すること（native image化はPhase 2）
- ceekerが停止してもClaude Code / Codexの動作に影響しないこと
- TUIが起動していなくてもhookイベントがState Storeに永続化されること

**非スコープ（MVP）**: native image

### 8.2 Phase 2: Native Image（目標: 2-3日追加）

**スコープ**:
- [ ] GraalVM native image ビルド・テスト
- [ ] native imageでのState Store / TUI動作検証

**受け入れ条件**:
- native imageでの起動時間 < 100ms
- native imageでMVPの全機能が動作すること

### 8.3 Phase 3: 拡張機能（目標: 3-5日追加）

**スコープ**:
- [ ] ポート一覧表示（ss + /proc/net/tcp パース）
- [ ] セッション履歴・統計機能（State Storeの永続データを活用）
- [ ] tmux統合強化（自動ウィンドウ配置）
- [ ] 通知（notify-send / tmux display-message）
- [ ] Git branch / PR情報表示（gh CLI連携）
- [ ] フィルタリング・検索機能

---

## 9. リスク・制約・ロールバック

### 9.1 技術リスク

| リスク | 影響度 | 対策 |
|--------|--------|------|
| GraalVM native imageでTUIライブラリが動作しない | 高 | MVP段階ではJVMモードで動作させ、native image化はPhase 2で検証。代替として直接ANSIエスケープシーケンス + JLine3を使用する。 |
| Claude Code / Codex hook仕様の変更 | 中 | hookペイロードのパースを疎結合に実装。不明フィールドは無視する方針。CLI引数マッピングのみ調整で対応可能。 |
| gwq status出力フォーマットの変更 | 低 | gwq statusのパーサーを分離し、変更時の影響を局所化。 |
| tmuxセッション名の命名規則不一致 | 中 | cwd照合をフォールバックとして持ち、セッション名に依存しない設計。 |
| inotifyのwatch上限 | 低 | `/proc/sys/fs/inotify/max_user_watches` の設定ガイドを文書化。 |

### 9.2 運用上の制約

1. **依存コマンド**: `tmux`, `gwq` がPATH上に必要
2. **ファイルシステム**: inotify対応のファイルシステムが必要（ext4, xfs等）
3. **State Store**: hook状態の永続化に `$XDG_RUNTIME_DIR/ceeker/sessions.edn` を使用
4. **メモリ**: JVMモード時はヒープサイズ制御が必要（推奨: `-Xmx256m`）

### 9.3 ロールバック方針

ceekerは**読み取り専用のモニタリングツール**であるため、ロールバックは単純:

1. ceekerプロセスを停止するだけで、他のシステムに影響しない
2. Claude Code/Codex側のhook設定を削除すれば、hook連携も完全に停止
3. gwq, tmuxの動作に一切干渉しない設計のため、ロールバック時のデータ損失リスクなし

---

## 10. 受け入れ条件（Definition of Done）

### 10.1 MVP完了条件

- [ ] `ceeker` コマンドでTUIが起動し、worktree一覧が表示される
- [ ] progressファイルの変更がリアルタイムでTUIに反映される
- [ ] worktree選択 + Enterで対応するtmuxペインにジャンプできる
- [ ] 20 worktree同時表示で描画遅延 < 200ms
- [ ] Claude Code hookイベントがTUIにリアルタイム反映される
- [ ] Codex hookイベントがTUIにリアルタイム反映される
- [ ] `clj-kondo` によるlintエラーが0
- [ ] `kaocha` による単体テストが全てパス
- [ ] README.mdにインストール・使用方法が記載されている

### 10.2 全体完了条件（Phase 3まで）

- [ ] MVP完了条件を全て満たす
- [ ] GraalVM native imageでビルド・実行できる
- [ ] GitHub Actions CIが構成されている（lint + test + native image build）

---

## 11. 未決事項

1. **TUIライブラリの最終選定**: clojure-lanterna vs JLine3 vs 直接ANSIエスケープシーケンス。GraalVM native互換性の検証が必要。
2. **Claude Code hook仕様の詳細確認**: 実際のhookペイロード形式、変数展開方式の確認。
3. **Codex hook仕様の詳細確認**: Codex側のhook API仕様の確認。仕様変更時はCLI引数マッピングのみ調整。
4. **gwq statusの出力形式**: JSON出力オプションの有無確認。テキストパースの場合はフォーマット安定性の確認。
5. **tmuxセッション命名規則**: gwqが作成するtmuxセッション名の規則確認。

---

## 12. 参考資料

- [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) — macOS向けAIターミナルアプリ（2026-03-02時点のソースコード調査で分析）
- T-20260302-010: cmux進捗ビュー分析（openclawタスク管理で追跡、boxp/archリポジトリ外）
- T-20260303-001: cmux調査タスク（openclawタスク管理で追跡、boxp/archリポジトリ外）
- [ark-discord-bot](https://github.com/boxp/ark-discord-bot) — Clojure + GraalVM nativeのリファレンス実装
- [openclaw plan](../openclaw/plan.md) — OpenClawデプロイ計画
- [cc-sddガイドライン](../T-20260220-001-cc-sdd-guideline/plan.md) — AI支援開発ワークフロー
