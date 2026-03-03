# cmux 進捗表示ビュー調査 & Linux/WSL向け実装方針

> T-20260302-010: cmuxコード調査とLinux向け進捗TUI実装方針まとめ
>
> 調査対象: manaflow-ai/cmux commit `b3f6f8cfd705e64e69c604674ed5d94fa4f3fe53`
> 調査日: 2026-03-03

## 1. 概要

### cmuxとは

cmux は [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) が開発する **macOS ネイティブのAIコーディングエージェント向けターミナルアプリ**。Ghostty ターミナルエンジンをベースに、Swift/AppKit/SwiftUI で構築されている。

主な特徴:
- **垂直タブ（ワークスペース）管理** - サイドバーにGitブランチ、PRステータス、進捗バー、ログを表示
- **通知システム** - OSC 9/99/777 エスケープシーケンスでペイン/タブを通知
- **Socket API** - CLI/外部ツールからワークスペース・ペインを自動制御
- **内蔵ブラウザ** - agent-browser API

### 進捗表示の全体像

cmuxの左サイドバーは、各ワークスペース（≒ターミナルタブ）について以下の情報を階層的に表示する:

```
┌──────────────────────────────────────┐
│ [Badge] [Pin] Title         [Cmd+N] │ タイトル行
│ Notification subtitle (2行max)       │ 通知サブタイトル
│ [icon] key=value  [icon] key=value   │ ステータスエントリ
│ ## Markdown Block                    │ メタデータブロック
│ [icon] Latest log message            │ 最新ログ(1件)
│ ████████░░░░░░░ 75% (3px高)          │ プログレスバー
│ ⎇ feature/my-branch* | ~/src/proj   │ Gitブランチ+ディレクトリ
│ ⎇ PR #123 open                       │ Pull Request
│ :3000, :8080                         │ リッスンポート
└──────────────────────────────────────┘
```

各要素はユーザー設定（`AppStorage`）で個別に表示/非表示を切り替え可能。

---

## 2. データフロー詳細

### 2.1 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                  Shell Integration                       │
│  (zsh/bash precmd/preexec hooks)                        │
│  ┌─ pwd変更検出 → report_pwd                            │
│  ├─ gitブランチ検出 → report_git_branch                 │
│  ├─ PR情報取得(gh) → report_pr                          │
│  ├─ TTY名報告 → report_tty                              │
│  └─ ポートkick → ports_kick                             │
└──────────────┬──────────────────────────────────────────┘
               │ Unix Domain Socket (/tmp/cmux.sock)
               │ テキストコマンド or JSON-RPC 2.0
               ▼
┌─────────────────────────────────────────────────────────┐
│             TerminalController.swift                     │
│  ┌─ Socket受信 (accept loop, per-connection thread)     │
│  ├─ コマンドパース (v1: text, v2: JSON-RPC)             │
│  ├─ Fast Path デデュプ (SocketFastPathState)            │
│  └─ DispatchQueue.main.async → UI更新                   │
└──────────────┬──────────────────────────────────────────┘
               │ @Published プロパティ更新
               ▼
┌─────────────────────────────────────────────────────────┐
│             Workspace.swift (@Published)                  │
│  statusEntries, logEntries, progress,                    │
│  gitBranch, panelGitBranches, pullRequest,               │
│  panelPullRequests, surfaceListeningPorts                │
└──────────────┬──────────────────────────────────────────┘
               │ SwiftUI リアクティブバインディング
               ▼
┌─────────────────────────────────────────────────────────┐
│             ContentView.swift (Sidebar)                   │
│  TabItemView → 各情報要素の描画                          │
│  プログレスバー / ログ / ブランチ / PR / ポート           │
└─────────────────────────────────────────────────────────┘
```

### 2.2 通信プロトコル

#### v1 プロトコル（テキストベース）

```
COMMAND [ARGS] [--option=value]\n
→ OK\n  または  ERROR: message\n
```

#### v2 プロトコル（JSON-RPC 2.0）

```json
{"id": "uuid", "method": "workspace.select", "params": {"workspace_id": "..."}}\n
→ {"id": "uuid", "result": {...}}\n
```

### 2.3 Sidebar関連ソケットコマンド一覧

| コマンド (v1) | パラメータ | 更新対象 |
|---|---|---|
| `set_status <key> <value>` | `--icon`, `--color`, `--url`, `--priority`, `--format`, `--tab` | `Workspace.statusEntries` |
| `clear_status <key>` | `--tab` | `Workspace.statusEntries` |
| `log <message>` | `--level` (info/progress/success/warning/error), `--source`, `--tab` | `Workspace.logEntries` |
| `clear_log` | `--tab` | `Workspace.logEntries` |
| `set_progress <0.0-1.0>` | `--label`, `--tab` | `Workspace.progress` |
| `clear_progress` | `--tab` | `Workspace.progress` |
| `report_git_branch <branch>` | `--status=dirty\|clean`, `--tab`, `--panel` | `Workspace.gitBranch`, `panelGitBranches` |
| `clear_git_branch` | `--tab`, `--panel` | `Workspace.gitBranch` |
| `report_pr <number> <url>` | `--label`, `--state=open\|merged\|closed`, `--tab`, `--panel` | `Workspace.pullRequest`, `panelPullRequests` |
| `clear_pr` | `--tab`, `--panel` | `Workspace.pullRequest` |
| `report_pwd <path>` | `--tab`, `--panel` | `Workspace.panelDirectories` |
| `report_ports <port1> [port2...]` | `--tab`, `--panel` | `Workspace.surfaceListeningPorts` |
| `report_tty <tty_name>` | `--tab`, `--panel` | `Workspace.surfaceTTYNames` |
| `report_meta_block <key>` | `--priority`, `--tab`, `-- <markdown>` | `Workspace.metadataBlocks` |
| `sidebar_state` | `--tab` | (読み取り専用) |
| `reset_sidebar` | `--tab` | (全sidebar状態をクリア) |

### 2.4 シェル統合の自動検出ロジック

cmuxはzsh/bashのprecmd/preexecフックを使って、以下を自動的に検出・報告する:

#### ワーキングディレクトリ変更
- 毎`precmd`で`$PWD`を前回値と比較
- 変更があれば非同期で`report_pwd`を送信
- TerminalController側でもSocketFastPathStateによるデデュプ

#### Gitブランチ変更
- `.git/HEAD`ファイルのmtime監視（`zstat`/`stat`）
- 以下のトリガーで非同期プローブ実行:
  1. ディレクトリ変更時
  2. HEADファイル変更時
  3. `git`/`gh`/`lazygit`/`tig`等のコマンド実行後（強制リフレッシュ）
  4. 前回から3秒以上経過時
- `git branch --show-current` + `git status --porcelain -uno` を実行
- 結果を`report_git_branch`で送信（dirty/clean付き）

#### Pull Request情報
- `gh pr view --json number,state,url` を60秒周期で実行
- git操作時にも強制リフレッシュ

#### ポートスキャン
- PortScanner: バッチ処理でps+lsofを効率的に実行
- Coalesce(200ms) + Burst(6回: 0.5, 1.5, 3, 5, 7.5, 10秒)
- コマンド実行時間>=2秒 or 前回スキャンから10秒以上で`ports_kick`発火

---

## 3. 状態モデル詳細

### 3.1 Workspace クラス（主要プロパティ）

```swift
@MainActor
final class Workspace: Identifiable, ObservableObject {
    // 基本情報
    @Published var title: String
    @Published var customTitle: String?
    @Published var isPinned: Bool = false
    @Published var customColor: String?

    // サイドバー表示情報
    @Published var statusEntries: [String: SidebarStatusEntry] = [:]
    @Published var metadataBlocks: [String: SidebarMetadataBlock] = [:]
    @Published var logEntries: [SidebarLogEntry] = []
    @Published var progress: SidebarProgressState?
    @Published var gitBranch: SidebarGitBranchState?

    // パネル別情報
    @Published var panelDirectories: [UUID: String] = [:]
    @Published var panelGitBranches: [UUID: SidebarGitBranchState] = [:]
    @Published var pullRequest: SidebarPullRequestState?
    @Published var panelPullRequests: [UUID: SidebarPullRequestState] = [:]
    @Published var surfaceListeningPorts: [UUID: [Int]] = [:]
    @Published var listeningPorts: [Int] = []
}
```

### 3.2 データ型定義

```swift
struct SidebarStatusEntry {
    let key: String
    let value: String
    let icon: String?      // "emoji:🔧", "sf:checkmark", "text:⚠️"
    let color: String?     // "#FF5733"
    let url: URL?
    let priority: Int
    let format: SidebarMetadataFormat  // .plain | .markdown
    let timestamp: Date
}

struct SidebarLogEntry {
    let message: String
    let level: SidebarLogLevel  // .info | .progress | .success | .warning | .error
    let source: String?
    let timestamp: Date
}

struct SidebarProgressState {
    let value: Double      // 0.0 ~ 1.0
    let label: String?
}

struct SidebarGitBranchState {
    let branch: String
    let isDirty: Bool
}

struct SidebarPullRequestState: Equatable {
    let number: Int
    let label: String
    let url: URL
    let status: SidebarPullRequestStatus  // .open | .merged | .closed
}

struct SidebarMetadataBlock {
    let key: String
    let markdown: String
    let priority: Int
    let timestamp: Date
}
```

### 3.3 セッション永続化

SessionPersistence.swiftで、Codable対応のスナップショット構造体を使い、アプリ再起動時も状態を復元する:
- `SessionWorkspaceSnapshot` - ワークスペース全体
- `SessionPanelSnapshot` - パネル単位
- `SessionProgressSnapshot`, `SessionGitBranchSnapshot` 等

---

## 4. Linux向け再設計（互換/非互換ポイント）

### 4.1 互換ポイント（そのまま流用可能）

| 要素 | 理由 |
|---|---|
| **Unix Domain Socket通信** | Linux/WSLでも動作する標準的なIPCメカニズム |
| **テキスト行ベースプロトコル (v1)** | 言語・OS非依存。ncatやsocatで簡単にテスト可能 |
| **シェル統合スクリプト** | zsh/bashフック（precmd/preexec）はLinuxでも動作 |
| **git/gh CLIによるブランチ・PR検出** | クロスプラットフォーム |
| **状態モデルの設計思想** | Workspace/Panel/Statusの階層はそのまま使える |
| **ログレベルとアイコン体系** | TUIでも同等の表現が可能 |

### 4.2 非互換ポイント（再実装必要）

| 要素 | cmuxの実装 | Linux代替案 |
|---|---|---|
| **UIフレームワーク** | SwiftUI + AppKit | Ratatui (Rust) / Ink (Node.js) / Textual (Python) / Bubble Tea (Go) |
| **ターミナルエミュレータ** | Ghostty (libghostty) | 不要（既存ターミナル+tmux内で動作） |
| **ペイン管理** | Bonsplit (カスタム) | tmux のペイン管理を利用 |
| **OSCシーケンス処理** | Ghostty内部 | 不要（ソケット経由のみで十分） |
| **ポートスキャン** | ps + lsof (macOS) | ss/netstat + /proc/net/tcp (Linux) |
| **プロセスID検証** | LOCAL_PEERPID (macOS固有) | SO_PEERCRED (Linux) |
| **Keychain** | macOS Keychain | ファイルベース認証で十分 |
| **リアクティブUI** | SwiftUI @Published | TUIフレームワーク固有のイベントループ |

### 4.3 アーキテクチャ上の重要な差異

cmuxは「ターミナルアプリそのもの」であり、ペイン内でプロセスを実行している。一方、Linux/WSL版は「tmux + 既存ターミナル」の上で動くモニタリングTUIとなる。この違いにより:

1. **パネル/ペインの紐付け方式が異なる** - cmuxはプロセスIDで直接紐付けられるが、Linux版はtmuxセッション/ウィンドウIDまたはworktreeパスで紐付ける
2. **プロセスの直接管理ができない** - cmuxは子プロセスを直接管理するが、Linux版はopenclaw/gwq等の既存ツール経由で間接的に状態を取得する
3. **データソースの多様化** - progressファイル（`$OPENCLAW_STATE_DIR/workspace/progress/`）、gwq status、tmuxセッション情報など複数ソースを統合する必要がある

---

## 5. MVP設計（1〜2日で作る場合）

### 5.1 ゴール

**tmuxの左ペインで動作する、worktreeごとの進捗モニタリングTUI**

表示内容:
- 各worktreeの名前（ブランチ名）
- 現在のステータス（idle / running / done / error）
- プログレスバー（0〜100%）
- 最新ログメッセージ（1行）
- Gitブランチ + dirty flag
- PR情報（番号、状態）

### 5.2 技術選定

| 項目 | 選定 | 理由 |
|---|---|---|
| 言語 | Go | シングルバイナリ配布、クロスコンパイル容易、TUIライブラリ充実 |
| TUIフレームワーク | [Bubble Tea](https://github.com/charmbracelet/bubbletea) + [Lip Gloss](https://github.com/charmbracelet/lipgloss) | Elm Architecture、テスタブル、豊富なスタイリング |
| IPC | Unix Domain Socket | cmuxと互換性のあるプロトコル |
| 設定 | TOML/YAML | 軽量 |

代替案:
- **Rust + Ratatui**: パフォーマンス最高だが、開発速度ではGoに劣る
- **Python + Textual**: 簡易だがシングルバイナリ配布が困難
- **Node.js + Ink**: 既存のJS/TSエコシステムを活用できるが、起動が重い

### 5.3 アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│              progress-tui (Go / Bubble Tea)       │
│                                                   │
│  ┌─ DataCollector ──────────────────────────┐    │
│  │  FileWatcher: progressファイル監視         │    │
│  │  GitProbe: git branch/status 定期実行      │    │
│  │  GwqProbe: gwq status パース              │    │
│  │  PRProbe: gh pr view 定期実行             │    │
│  │  PortProbe: ss -tlnp パース               │    │
│  └──────────────────┬───────────────────────┘    │
│                     │ EventBus (channel)          │
│                     ▼                             │
│  ┌─ StateStore ─────────────────────────────┐    │
│  │  workspaces: map[string]*WorkspaceState   │    │
│  │  Update(event) → new state               │    │
│  └──────────────────┬───────────────────────┘    │
│                     │                             │
│                     ▼                             │
│  ┌─ View (Bubble Tea Model) ────────────────┐    │
│  │  Sidebar rendering with Lip Gloss         │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
│  ┌─ SocketServer (optional) ────────────────┐    │
│  │  cmux互換プロトコルでCLIから状態更新      │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 5.4 データスキーマ

```go
// WorkspaceState は1つのworktree/作業単位の状態を保持する
type WorkspaceState struct {
    ID          string                   `json:"id"`
    Name        string                   `json:"name"`
    BranchName  string                   `json:"branch_name"`
    WorkDir     string                   `json:"work_dir"`
    Status      WorkspaceStatus          `json:"status"`
    Progress    *ProgressState           `json:"progress,omitempty"`
    GitBranch   *GitBranchState          `json:"git_branch,omitempty"`
    PullRequest *PullRequestState        `json:"pull_request,omitempty"`
    Logs        []LogEntry               `json:"logs"`
    StatusMap   map[string]StatusEntry   `json:"status_map"`
    Ports       []int                    `json:"ports"`
    UpdatedAt   time.Time                `json:"updated_at"`
}

type WorkspaceStatus string
const (
    StatusIdle    WorkspaceStatus = "idle"
    StatusRunning WorkspaceStatus = "running"
    StatusDone    WorkspaceStatus = "done"
    StatusError   WorkspaceStatus = "error"
)

type ProgressState struct {
    Value float64 `json:"value"` // 0.0 ~ 1.0
    Label string  `json:"label,omitempty"`
}

type GitBranchState struct {
    Branch  string `json:"branch"`
    IsDirty bool   `json:"is_dirty"`
}

type PullRequestState struct {
    Number int               `json:"number"`
    Label  string            `json:"label"`
    URL    string            `json:"url"`
    Status PullRequestStatus `json:"status"`
}

type PullRequestStatus string
const (
    PROpen   PullRequestStatus = "open"
    PRMerged PullRequestStatus = "merged"
    PRClosed PullRequestStatus = "closed"
)

type LogEntry struct {
    Message   string   `json:"message"`
    Level     LogLevel `json:"level"`
    Source    string   `json:"source,omitempty"`
    Timestamp time.Time `json:"timestamp"`
}

type LogLevel string
const (
    LogInfo     LogLevel = "info"
    LogProgress LogLevel = "progress"
    LogSuccess  LogLevel = "success"
    LogWarning  LogLevel = "warning"
    LogError    LogLevel = "error"
)

type StatusEntry struct {
    Key      string `json:"key"`
    Value    string `json:"value"`
    Icon     string `json:"icon,omitempty"`
    Color    string `json:"color,omitempty"`
    Priority int    `json:"priority"`
}
```

### 5.5 イベントプロトコル

内部イベントバスで使用するイベント型:

```go
type Event struct {
    Type        EventType   `json:"type"`
    WorkspaceID string      `json:"workspace_id"`
    Payload     interface{} `json:"payload"`
    Timestamp   time.Time   `json:"timestamp"`
}

type EventType string
const (
    EventProgressUpdate   EventType = "progress.update"
    EventProgressClear    EventType = "progress.clear"
    EventGitBranchUpdate  EventType = "git_branch.update"
    EventGitBranchClear   EventType = "git_branch.clear"
    EventPRUpdate         EventType = "pr.update"
    EventPRClear          EventType = "pr.clear"
    EventLogAppend        EventType = "log.append"
    EventLogClear         EventType = "log.clear"
    EventStatusUpdate     EventType = "status.update"
    EventStatusClear      EventType = "status.clear"
    EventPortsUpdate      EventType = "ports.update"
    EventWorkspaceCreate  EventType = "workspace.create"
    EventWorkspaceRemove  EventType = "workspace.remove"
    EventWorkDirUpdate    EventType = "workdir.update"
)
```

### 5.6 データ収集方式（Linux/WSL）

#### 5.6.1 Progressファイル監視（主要データソース）

既存のopenclaw運用ではprogressファイルが使われている:

```
$OPENCLAW_STATE_DIR/workspace/progress/T-XXXXXXXX-NNN-progress.md
# デフォルト: $XDG_STATE_HOME/openclaw/ または ~/.openclaw/
```

- `fsnotify` (Go) / `inotify` (Linux syscall) でファイル変更を監視
- ファイル内のチェックボックス（`- [x]` / `- [ ]`）を解析して進捗率を算出
- ステータスヘッダ（`## ステータス: 作業中`）を解析

#### 5.6.2 gwq status 統合

```bash
gwq status -g --show-processes
```

- 定期実行（5秒間隔）でworktree一覧と実行中プロセスを取得
- JSON出力オプションがあれば利用、なければテキストパース

#### 5.6.3 完了検知

```
$OPENCLAW_STATE_DIR/workspace/.completed/T-XXXXXXXX-NNN.done
```

- `fsnotify`で`.completed`ディレクトリを監視
- `.done`ファイル出現でステータスを`done`に更新

#### 5.6.4 Git/PR情報

- 各worktreeディレクトリで`git branch --show-current` + `git status --porcelain -uno`
- `gh pr view --json number,state,url`
- cmuxと同等のポーリング間隔（git: 3秒、PR: 60秒）

### 5.7 ソケットサーバー（オプション・Phase 2）

cmux互換のソケットAPIを提供することで、既存のシェル統合やCLIツールからの状態更新を受け付ける:

```
$XDG_RUNTIME_DIR/progress-tui.sock  (フォールバック: /tmp/progress-tui-$UID.sock)
```

#### セキュリティ要件

- ソケットファイルのパーミッション: `0600`（所有者のみ）
- `SO_PEERCRED` (Linux) による接続元UID検証 - 自プロセスのUIDと一致するもののみ許可
- 入力バリデーション: コマンド長上限 4096 bytes、引数数上限 32
- レート制限: 1接続あたり 100 cmd/sec

#### cmux互換コマンドマトリクス

| cmuxコマンド | Linux版対応 | 理由 |
|---|---|---|
| `set_progress` / `clear_progress` | 完全互換 | コアMVP機能 |
| `log` / `clear_log` | 完全互換 | コアMVP機能 |
| `set_status` / `clear_status` | 完全互換 | コアMVP機能 |
| `report_git_branch` / `clear_git_branch` | 完全互換 | コアMVP機能 |
| `report_pr` / `clear_pr` | 完全互換 | Phase 3で対応 |
| `sidebar_state` | 完全互換 | デバッグ・統合用 |
| `report_pwd` | 部分互換 | tmux/gwq経由で取得するため受動的受信の優先度は低い |
| `report_ports` | 部分互換 | Linux版はss/procfsで自力検出するためオプション |
| `report_tty` | 非対応 | cmux固有のペイン管理に依存。Linux版はtmux IDで代替 |
| `report_meta_block` / `clear_meta_block` | Phase 4 | Markdown描画はTUIでは複雑なため後回し |
| `reset_sidebar` | 完全互換 | 実装が軽量 |
| workspace系 (`workspace.list` 等) | 非対応 | Linux版はgwqでworktree管理するため不要 |

### 5.8 表示レイアウト（TUI）

```
┌─ Progress Monitor ──────────────────┐
│                                      │
│ ▸ T-20260302-010                     │  ← 選択中（ハイライト）
│   ⎇ T-20260302-010-cmux-progress    │
│   ██████████░░░░ 70%                 │
│   ✓ cmux調査完了                     │
│                                      │
│   T-20260302-001                     │
│   ⎇ fix/k8s-upgrade                 │
│   ████████████████ 100%              │
│   ✓ Done                             │
│                                      │
│   T-20260301-005                     │
│   ⎇ feature/auth                     │
│   ░░░░░░░░░░░░░░ idle               │
│                                      │
│───────────────────────────────────── │
│ [q]uit [r]efresh [Enter]detail       │
└──────────────────────────────────────┘
```

---

## 6. 段階的拡張計画

### Phase 1: MVP（1〜2日）
- progressファイル監視 + `.completed` 検知
- gwq status統合（worktree一覧取得）
- 基本TUI（worktree一覧 + ステータス + プログレスバー）
- Git ブランチ表示
- **受け入れ基準**: 20 worktreeで描画遅延 < 200ms、inotify検知からTUI反映まで < 500ms

### Phase 2: Socket API + シェル統合（2〜3日追加）
- Unix Domain Socketサーバー（cmux互換サブセット）
- シェル統合スクリプト（cmuxのzsh/bash統合を移植）
- ログエントリ表示
- ステータスエントリ表示
- **受け入れ基準**: ソケットコマンド応答 < 10ms、100 cmd/sec でドロップなし

### Phase 3: 高度な機能（3〜5日追加）
- PR情報表示（gh CLI統合）
- ポートスキャン（ss + /proc/net/tcp）
- セッション永続化（JSON ファイル）
- tmux統合（ペインの自動レイアウト）
- 通知（tmux display-message / notify-send）
- **受け入れ基準**: セッション復元時間 < 1s、永続化データ破損時にgraceful degradation

### Phase 4: 統合強化
- openclaw イベントシステムとの統合
- Claude Code / Codex のstatus line hookとの連携
- メタデータブロック（Markdown）表示
- 複数ウィンドウ対応

---

## 7. 実装チェックリスト

### Phase 1 MVP

- [ ] プロジェクト初期化（Go module + Bubble Tea + Lip Gloss）
- [ ] `WorkspaceState` データモデル定義
- [ ] `EventBus` 実装（Go channel ベース）
- [ ] `FileWatcher` - progressファイル監視
  - [ ] inotify (fsnotify) セットアップ
  - [ ] Markdownチェックボックスパーサー
  - [ ] ステータスヘッダパーサー
- [ ] `CompletionWatcher` - .completed ディレクトリ監視
- [ ] `GwqProbe` - gwq status パース
  - [ ] worktree一覧取得
  - [ ] 実行中プロセス検出
- [ ] `GitProbe` - git branch/status 取得
  - [ ] 各worktreeディレクトリでのgitコマンド実行
  - [ ] dirty flag検出
- [ ] `StateStore` - イベント集約 + 状態管理
- [ ] `SidebarView` - Bubble Tea Model/View
  - [ ] worktree一覧表示
  - [ ] プログレスバー描画
  - [ ] ステータス表示
  - [ ] Gitブランチ表示
- [ ] キーバインド（q: 終了, r: リフレッシュ）
- [ ] tmuxペイン内での動作確認

### Phase 2 Socket API

- [ ] Unix Domain Socket サーバー
- [ ] cmux互換コマンドパーサー（v1）
- [ ] シェル統合スクリプト（zsh precmd/preexec）
- [ ] CLIクライアント（`progress-tui set-progress 0.5`）
- [ ] ログエントリ表示（レベル別アイコン・色）
- [ ] ステータスエントリ表示

---

## 8. 参照ファイル一覧

### cmuxリポジトリ主要ファイル

| ファイル | サイズ | 役割 |
|---|---|---|
| `Sources/Workspace.swift` | 169KB | ワークスペース状態モデル（全struct/enum定義） |
| `Sources/TerminalController.swift` | 554KB | Socket受信・コマンドハンドラ（全sidebar APIの実装） |
| `Sources/ContentView.swift` | 365KB | サイドバーUI描画（TabItemView、プログレスバー等） |
| `Sources/TabManager.swift` | 151KB | ワークスペース・パネル全体管理 |
| `Sources/SessionPersistence.swift` | - | セッション永続化（スナップショット構造体） |
| `Sources/PortScanner.swift` | - | ポートスキャン（ps + lsof バッチ処理） |
| `Sources/SocketControlSettings.swift` | - | Socket認証・パス設定 |
| `Sources/AppDelegate.swift` | 331KB | Socket健全性監視・再起動 |
| `Sources/cmuxApp.swift` | - | アプリエントリーポイント |
| `CLI/cmux.swift` | 283KB | CLIクライアント（Socket接続・コマンド送信） |
| `Resources/shell-integration/cmux-zsh-integration.zsh` | - | zshシェル統合（precmd/preexec フック） |
| `Resources/shell-integration/cmux-bash-integration.bash` | - | bashシェル統合 |
| `vendor/bonsplit/` | - | ペイン/タブ分割管理フレームワーク |

### cmuxリポジトリ内の重要な行番号

| ファイル:行 | 内容 |
|---|---|
| `Workspace.swift:59-88` | SidebarStatusEntry struct定義 |
| `Workspace.swift:594-630` | SidebarLogLevel, SidebarLogEntry, SidebarProgressState, SidebarGitBranchState, SidebarPullRequestState |
| `Workspace.swift:90-100` | SidebarMetadataBlock, SidebarMetadataFormat |
| `TerminalController.swift:400-508` | Socketサーバー起動（AF_UNIX bind/listen） |
| `TerminalController.swift:643-785` | accept loop + handleClient |
| `TerminalController.swift:787` | processCommand() エントリーポイント |
| `TerminalController.swift:11825-12000` | set_status / clear_status / list_status |
| `TerminalController.swift:12085-12163` | log / clear_log / list_log |
| `TerminalController.swift:12165-12202` | set_progress / clear_progress |
| `TerminalController.swift:12204-12324` | report_git_branch / clear_git_branch |
| `TerminalController.swift:12326-12450` | report_pr / clear_pr |
| `TerminalController.swift:12452-12510` | report_ports |
| `TerminalController.swift:12511-12616` | report_pwd |
| `TerminalController.swift:12716-12785` | sidebar_state |
| `TerminalController.swift:12786` | reset_sidebar |
| `TerminalController.swift:262-280` | SocketFastPathState（デデュプ機構） |
| `ContentView.swift:5678-5802` | SidebarView body |
| `ContentView.swift:6457-7655` | TabItemView body |
| `ContentView.swift:6740-6762` | プログレスバー描画 |
| `ContentView.swift:6765-6816` | Gitブランチ表示 |
| `ContentView.swift:6818-6845` | PR表示 |
| `ContentView.swift:6847-6854` | ポート表示 |
| `ContentView.swift:6704-6722` | ステータスエントリ表示 |
| `ContentView.swift:6725-6738` | ログエントリ表示 |
| `SessionPersistence.swift:199-337` | セッション永続化スナップショット |
| `CLI/cmux.swift:472-597` | CLISocketClient（connect, send, sendV2） |

### 既存運用で参照するパス

| パス | 用途 |
|---|---|
| `$OPENCLAW_STATE_DIR/workspace/progress/` (デフォルト: `~/.openclaw/workspace/progress/`) | タスク進捗ファイル |
| `$OPENCLAW_STATE_DIR/workspace/.completed/` (デフォルト: `~/.openclaw/workspace/.completed/`) | 完了マーカー |
| `gwq status -g --show-processes` | worktree一覧・プロセス状態 |
| `gwq list -v` | worktree一覧（詳細） |

---

## 9. 既存運用との統合案

### 現在の運用フロー

```
openclaw task → gwq worktree作成 → tmuxセッション → Claude Code/Codex実行
  ↓
progressファイル書き出し → .completed/.done マーカー
```

### 統合ポイント

1. **progress-tui の起動位置**: tmuxの左端ペイン（幅40列程度）に常駐
2. **データソース統合**:
   - progressファイル → ProgressState + LogEntries
   - `.completed/*.done` → WorkspaceStatus = done
   - `gwq status` → Workspace一覧
   - worktree内git → GitBranchState
3. **既存ツールへの影響なし**: 読み取り専用のモニタリングツールとして動作
4. **Phase 2以降**: ソケットAPIを追加すれば、Claude Codeのhooksやopenclaw側から直接状態を送信可能

### 推奨される起動方法

```bash
# tmuxで左ペインに配置
tmux split-window -hb -l 40 'progress-tui'

# または gwq tmux run で常駐
gwq tmux run --id progress-monitor "progress-tui --watch ~/.openclaw/workspace/progress/"
```

### パス設定

progress-tuiは以下の優先順序でベースディレクトリを解決する:

1. CLI引数: `--state-dir /path/to/dir`
2. 環境変数: `$OPENCLAW_STATE_DIR`
3. XDG準拠: `$XDG_STATE_HOME/openclaw/`
4. デフォルト: `~/.openclaw/`

---

## 10. Claude Code 状態取得経路の詳細（コード確認済み）

> **本セクションの目的**: cmuxが「Claude Codeの状態（Running / Needs input / Completed）」をどのように取得・表示しているかを、コード根拠ベースで詳細に記述する。

### 10.1 全体シーケンス図

```
User launches "claude" in cmux terminal
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Resources/bin/claude  (Bash wrapper script)                │
│                                                             │
│  1. CMUX_SURFACE_ID が設定されているか確認                   │
│  2. PATH上の実際の claude バイナリを特定 (find_real_claude)  │
│  3. --hooks JSON を自動生成・注入                            │
│  4. --session-id を自動生成                                  │
│  5. 実際の claude を exec で実行                              │
└──────────────┬──────────────────────────────────────────────┘
               │ Claude Code が hooks を発火
               │
    ┌──────────┼──────────────────────┐
    │          │                      │
    ▼          ▼                      ▼
SessionStart  Notification           Stop
    │          │                      │
    ▼          ▼                      ▼
┌──────────────────────────────────────────────────────────────┐
│  CLI/cmux.swift  `cmux claude-hook <subcommand>`            │
│                                                              │
│  A. session-start:                                           │
│     sessionStore.upsert(sessionId → workspaceId, surfaceId) │
│     → socket: set_status claude_code Running                 │
│                                                              │
│  B. notification:                                            │
│     sessionStore.lookup(sessionId)                           │
│     → 通知分類 (Permission / Error / Waiting / Attention)    │
│     → socket: set_status claude_code "Needs input"           │
│     → socket: notify_target <wsId> <surfaceId> <payload>     │
│                                                              │
│  C. stop:                                                    │
│     sessionStore.consume(sessionId)                          │
│     → transcript JSONL から完了サマリー生成                   │
│     → socket: clear_status claude_code                       │
│     → socket: notify_target <wsId> <surfaceId> <summary>     │
└──────────────┬───────────────────────────────────────────────┘
               │ Unix Domain Socket (/tmp/cmux.sock)
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Sources/TerminalController.swift                            │
│                                                              │
│  set_status → upsertSidebarMetadata() → tab.statusEntries   │
│  clear_status → tab.statusEntries[key] 削除                  │
│  notify_target → TerminalNotificationStore.addNotification() │
└──────────────┬───────────────────────────────────────────────┘
               │ @Published プロパティ更新
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Sources/ContentView.swift  (Sidebar + Notification Panel)   │
│                                                              │
│  TabItemView: statusEntries["claude_code"] を描画            │
│  NotificationPanel: 通知リスト + 未読バッジ + 青リング       │
└──────────────────────────────────────────────────────────────┘
```

### 10.2 Wrapper スクリプトの詳細

**ファイル**: `Resources/bin/claude`（Bashスクリプト）

#### 起動条件チェック（行10-33）

```bash
find_real_claude() {
    # PATH上の "claude" バイナリを走査し、自分自身（wrapper）を除外して
    # 実際の Claude Code CLI を特定する
}
```

| 条件 | 動作 |
|------|------|
| `CMUX_SURFACE_ID` 未設定 | そのまま本物の claude を実行（pass-through） |
| `CMUX_CLAUDE_HOOKS_DISABLED=1` | そのまま本物の claude を実行 |
| サブコマンドが `mcp`, `config`, `api-key` | hooks未注入で素通し |

#### Hooks JSON の生成（行51-59）

wrapperが自動注入するhooksは以下の3種:

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "cmux claude-hook session-start",
        "timeout": 10
      }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "cmux claude-hook stop",
        "timeout": 10
      }]
    }],
    "Notification": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "cmux claude-hook notification",
        "timeout": 10
      }]
    }]
  }
}
```

#### 環境変数の制御（行35-37）

```bash
unset CLAUDECODE
```

`CLAUDECODE` 環境変数を unset する理由: Claude Code は `CLAUDECODE` が設定されていると「既にセッション内にいる」と判断してネスト防止を行う。cmux terminal は独立セッションとして動くため、この変数を削除する。

#### セッションIDの自動管理（行42-48）

ユーザーが `--resume`, `--session-id`, `--continue` を指定した場合はそのまま使用。
未指定の場合は `uuidgen` で新しいセッションIDを自動生成し `--session-id` として注入。

### 10.3 claude-hook サブコマンドの詳細

**ファイル**: `CLI/cmux.swift`

#### A. セッションストア（ClaudeHookSessionStore, 行231-389）

**責務**: sessionId ↔ (workspaceId, surfaceId) のマッピングを永続化管理

```swift
// ファイルパス: ~/.cmuxterm/claude-hook-sessions.json
// 環境変数上書き: CMUX_CLAUDE_HOOK_STATE_PATH
// 有効期限: 7日間 (maxStateAgeSeconds = 604800)

struct ClaudeHookSessionStoreFile: Codable {
    var version: Int = 1
    var sessions: [String: ClaudeHookSessionRecord] = [:]
}

struct ClaudeHookSessionRecord: Codable {
    var sessionId: String
    var workspaceId: String    // ← CMUX_WORKSPACE_ID から取得
    var surfaceId: String      // ← CMUX_SURFACE_ID から取得
    var cwd: String?
    var lastSubtitle: String?
    var lastBody: String?
    var startedAt: TimeInterval
    var updatedAt: TimeInterval
}
```

**同時アクセス制御**: `flock()` によるファイルロック（ロックファイル: `<statePath>.lock`）

**主要メソッド**:

| メソッド | 行番号 | 用途 |
|---------|--------|------|
| `lookup(sessionId)` | 254-260 | session→workspace/surfaceマッピングの検索 |
| `upsert(sessionId, ...)` | 262-298 | マッピングの追加・更新 |
| `consume(sessionId)` | 300-324 | stop時にマッピングを消費（削除） |

#### B. session-start / active（行5649-5672）

> **注**: `active` は `session-start` のエイリアス（同一処理）。`cmux claude-hook session-start` と `cmux claude-hook active` は同じコードパスを通る。同様に `notify` は `notification` の、`idle` は `stop` のエイリアス。

```
入力: Claude Code が hook 経由で JSON を stdin に渡す
      {"session_id": "...", "cwd": "/path/to/project"}

処理:
  1. parseClaudeHookInput() で session_id, cwd を抽出
  2. CMUX_WORKSPACE_ID, CMUX_SURFACE_ID を環境変数から取得
  3. sessionStore.upsert() でマッピング永続化
  4. socket コマンド送信:
     set_status claude_code Running --icon=bolt.fill --color=#4C8DFF --tab=<workspaceId>
```

#### C. notification / notify（行5703-5746）

```
入力: Claude Code が hook 経由で通知JSON を stdin に渡す
      {"notification_type": "...", "message": "..."}

処理:
  1. parseClaudeHookInput() で sessionId を抽出
  2. sessionStore.lookup(sessionId) で workspace/surface を解決
  3. classifyClaudeNotification() で通知を分類:
     - "permission/approve" → subtitle: "Permission"
     - "error/failed"       → subtitle: "Error"
     - "idle/wait/input"    → subtitle: "Waiting"
     - その他              → subtitle: "Attention"
  4. socket コマンド送信:
     set_status claude_code "Needs input" --icon=bell.fill --color=#4C8DFF --tab=<workspaceId>
     notify_target <workspaceId> <surfaceId> <title>|<subtitle>|<body>
```

#### D. stop / idle（行5674-5701）

```
入力: Claude Code が停止時に hook を発火

処理:
  1. parseClaudeHookInput() で sessionId, transcriptPath を抽出
  2. sessionStore.consume(sessionId) でマッピングを消費
  3. summarizeClaudeHookStop():
     - Transcript JSONL を読み込み
     - 最後のアシスタントメッセージを抽出
     - プロジェクト名を cwd から生成
     → (subtitle: "Completed in <project>", body: "<last message>")
  4. socket コマンド送信:
     clear_status claude_code --tab=<workspaceId>
     notify_target <workspaceId> <surfaceId> Claude Code|<subtitle>|<body>
```

#### E. 入力解析（parseClaudeHookInput, 行5798-5855）

複数のJSON構造に対応するための柔軟な解析:

| フィールド探索対象 | 探索キー |
|-------------------|---------|
| Session ID | `session_id`, `sessionId`, `notification.session_id`, `data.session_id`, `session.id`, `context.session_id` |
| CWD | `cwd`, `working_directory`, `project_dir` |
| Transcript | `transcript_path`, `transcriptPath` |

### 10.4 App側の環境変数設定

**ファイル**: `Sources/GhosttyTerminalView.swift`（行1785-1806）

cmuxが起動する各ターミナルペインに自動設定される環境変数:

```swift
env["CMUX_SURFACE_ID"] = id.uuidString
env["CMUX_WORKSPACE_ID"] = tabId.uuidString
env["CMUX_PANEL_ID"] = id.uuidString        // 後方互換
env["CMUX_TAB_ID"] = tabId.uuidString       // 後方互換
env["CMUX_SOCKET_PATH"] = SocketControlSettings.socketPath()
```

Claude Code hooks 無効化の設定:

```swift
let claudeHooksEnabled = ClaudeCodeIntegrationSettings.hooksEnabled()
if !claudeHooksEnabled {
    env["CMUX_CLAUDE_HOOKS_DISABLED"] = "1"
}
```

**設定UI**: `Sources/cmuxApp.swift`（行3232-3248）

Settings画面に "Claude Code Integration" トグルが存在。

### 10.5 ソケット受信側の処理

**ファイル**: `Sources/TerminalController.swift`

#### set_status の処理経路

```
TerminalController.processCommand()  (行787)
  ├─ case "set_status": → setStatus(args)  (行889-890)
  │   └─ upsertSidebarMetadata()  (行11825-11893)
  │       ├─ parseOptionsNoStop() で key, value, options を解析
  │       ├─ resolveTabIdForSidebarMutation() でタブ特定
  │       └─ DispatchQueue.main.async {
  │            tab.statusEntries[key] = SidebarStatusEntry(...)
  │          }
  └─ case "clear_status": → clearStatus(args)  (行891-892)
      └─ tab.statusEntries.removeValue(forKey: key)
```

#### notify_target の処理経路

```
TerminalController.processCommand()  (行787)
  └─ case "notify_target": → notifyTarget(args)  (行874-875, 10069-10102)
      ├─ 引数解析: <workspace_id> <surface_id> <title>|<subtitle>|<body>
      ├─ resolveTab() でワークスペース特定
      ├─ parseNotificationPayload() でペイロード分解
      └─ DispatchQueue.main.sync {
           TerminalNotificationStore.shared.addNotification(
             tabId:, surfaceId:, title:, subtitle:, body:
           )
         }
```

### 10.6 通知の保存と表示

**ファイル**: `Sources/TerminalNotificationStore.swift`

#### addNotification()（行176-220）

```
1. 同一タブ/surfaceの既存通知を置換（重複排除）
2. フォーカスチェック:
   - アクティブタブかつアクティブパネル → 内部保存をスキップ
     （ユーザーが既に見ているため）
3. ワークスペース自動並び替え（設定による）
4. TerminalNotification インスタンス生成
5. notifications 配列の先頭に挿入
6. macOS システム通知スケジュール (UNMutableNotificationContent)
```

#### UI反映

```swift
@Published private(set) var notifications: [TerminalNotification] = [] {
    didSet {
        indexes = Self.buildIndexes(for: notifications)
        refreshDockBadge()
    }
}
```

通知配列が更新されると:
- `buildIndexes()`: タブごとの未読数、最新未読通知を再計算
- `refreshDockBadge()`: macOS Dockアイコンのバッジを更新
- SwiftUI のリアクティブバインディングで Sidebar の青リング・通知パネルが自動更新

---

## 11. Codex 状態取得について（コード確認済み）

### 11.1 現状: 直接統合は未実装

**根拠**:
- cmuxリポジトリの `TODO.md` 行40: `[ ] Codex integration` が未チェック状態で残存
- ソースコード中に Codex 専用の wrapper スクリプト、hook 実装、状態管理コードは存在しない

### 11.2 推奨される統合方式（ドキュメント記載のみ）

cmuxリポジトリの `docs/notifications.md`（行88-107）に、Codex からの通知をcmuxに送る方法がガイドとして記載されている:

```toml
# ~/.codex/config.toml
notify = ["bash", "-c",
  "command -v cmux &>/dev/null && cmux notify --title Codex --body \"$(echo $1 | jq -r '.\"last-assistant-message\" // \"Turn complete\"' 2>/dev/null | head -c 100)\" || osascript -e 'display notification \"Turn complete\" with title \"Codex\"'",
  "--"]
```

この方式は Claude Code wrapper のような自動フック注入ではなく、**ユーザーが手動で Codex の設定ファイルに記述する必要がある**。

### 11.3 Claude Code統合との差異

| 観点 | Claude Code | Codex |
|------|-------------|-------|
| 統合方式 | Bash wrapper による自動 hook 注入 | ユーザー手動設定 |
| session tracking | あり（sessionStore で永続化） | なし |
| サイドバー status 更新 | `set_status claude_code Running/Needs input` | なし（通知のみ） |
| completion summary | Transcript JSONL から自動生成 | `last-assistant-message` のみ |
| notification 分類 | Permission / Error / Waiting / Attention | なし |
| wrapper script | `Resources/bin/claude` | なし |

---

## 12. 状態更新トリガー条件の一覧

### 12.1 Claude Code 状態遷移

| トリガー | Hook名 | 送信コマンド | サイドバー表示 |
|---------|--------|-------------|---------------|
| Claude Code セッション開始 | `SessionStart` | `set_status claude_code Running --icon=bolt.fill --color=#4C8DFF` | "Running" (青アイコン) |
| 許可リクエスト | `Notification` (permission) | `set_status` + `notify_target` | "Needs input" + 青リング |
| エラー発生 | `Notification` (error) | `set_status` + `notify_target` | "Needs input" + 青リング |
| 入力待ち | `Notification` (idle) | `set_status` + `notify_target` | "Needs input" + 青リング |
| セッション終了 | `Stop` | `clear_status claude_code` + `notify_target` | クリア + 完了通知 |

### 12.2 自動検出 vs 明示的通知

| データ種別 | 取得方式 | トリガー |
|-----------|---------|---------|
| Claude Code状態 (Running等) | **wrapper + hooks** | Claude Code CLI の lifecycle event |
| Git ブランチ | **shell integration** (precmd/preexec) | ディレクトリ変更, .git/HEAD変更, gitコマンド実行後 |
| PR情報 | **shell integration** | 60秒ポーリング + gitコマンド実行後 |
| ポートスキャン | **PortScanner** | コマンド実行>=2秒後, 10秒周期 |
| 作業ディレクトリ | **shell integration** (precmd) | ディレクトリ変更 |

---

## 13. ファイル/関数の責務マップ

### 13.1 Claude Code 状態取得に関わるファイル一覧

| ファイル | 主な責務 | 重要な行番号 |
|---------|---------|-------------|
| `Resources/bin/claude` | Bash wrapper: hooks JSON注入、session ID生成、CLAUDECODE unset | 全体（約60行） |
| `CLI/cmux.swift` (ClaudeHookSessionStore) | session↔workspace/surfaceマッピングの永続化 | 231-389 |
| `CLI/cmux.swift` (claude-hook) | session-start/notification/stop サブコマンド処理 | 5623-5759 |
| `CLI/cmux.swift` (parseClaudeHookInput) | 複数JSONフォーマットからの入力解析 | 5798-5855 |
| `CLI/cmux.swift` (summarizeClaudeHookStop) | Transcript JSONLからの完了サマリー生成 | 5857-5930 |
| `CLI/cmux.swift` (classifyClaudeNotification) | 通知種別の分類ロジック | 5989-6005 |
| `Sources/GhosttyTerminalView.swift` | 環境変数設定（CMUX_SURFACE_ID等） | 1785-1806 |
| `Sources/cmuxApp.swift` (ClaudeCodeIntegrationSettings) | Settings UIトグル、hooks有効/無効 | 2686-2693, 3232-3248 |
| `Sources/TerminalController.swift` (set_status) | ソケットコマンド受信→statusEntries更新 | 11825-11893 |
| `Sources/TerminalController.swift` (notify_target) | ソケットコマンド受信→通知ストア追加 | 10069-10102 |
| `Sources/TerminalNotificationStore.swift` | 通知の保存・インデックス管理・OS通知 | 176-220, 345-378, 448-465 |
| `Sources/ContentView.swift` (TabItemView) | サイドバーでのstatusEntries描画 | 6704-6722 |

### 13.2 テスト

| ファイル | 検証内容 |
|---------|---------|
| `tests/test_claude_hook_session_mapping.py` | session-start→mapping記録、notification→routing、stop→consume |
| `tests/test_claude_hook_missing_socket_error.py` | Socket未接続時のエラーハンドリング |

---

## 14. Linux再実装時の最小模倣ポイント

### 14.1 必須（Claude Code統合を再現するために）

1. **claude wrapper スクリプト**: PATH先頭に配置し、`--hooks` JSONと `--session-id` を自動注入
2. **claude-hook コマンド**: session-start / notification / stop の3サブコマンドを実装
3. **session ストア**: sessionId ↔ workspace マッピングをJSONファイルで永続化
4. **ソケットサーバー**: `set_status`, `clear_status`, `notify_target` コマンドの受信
5. **環境変数の設定**: ターミナル起動時に `CMUX_SURFACE_ID`, `CMUX_WORKSPACE_ID`, `CMUX_SOCKET_PATH` を設定

### 14.2 簡略化可能

| cmuxの実装 | Linux版での簡略化案 |
|-----------|-------------------|
| SwiftUI @Published による即時UI更新 | ポーリング（1秒間隔）で十分 |
| TerminalNotificationStore（OS通知統合） | `notify-send` / `tmux display-message` で代替 |
| classifyClaudeNotification（詳細分類） | 初期はPermission/Otherの2分類で十分 |
| summarizeClaudeHookStop（Transcript解析） | transcript解析は後回し、status clearのみ |
| flock()によるファイルロック | 単一プロセスなら不要 |
| SocketFastPathState（デデュプ） | TUI側の描画スロットリングで代替 |

### 14.3 wrapper実装の最小テンプレート（Linux用）

> **注**: cmuxでは `CMUX_WORKSPACE_ID` を使用するが、Linux版（progress-tui）では独自の環境変数名 `PROGRESS_TUI_WORKSPACE_ID` を使う想定。セクション14.1の「環境変数の設定」はcmux互換の命名を参考として挙げたもので、Linux版では適切にリネームする。

```bash
#!/bin/bash
# progress-tui-claude-wrapper
# PATH先頭に配置: ~/.local/bin/claude → 本wrapperが最初に見つかる

REAL_CLAUDE=$(which -a claude | grep -v "$0" | head -1)
[ -z "$REAL_CLAUDE" ] && echo "claude not found" && exit 1

# progress-tui 環境外なら素通し（PROGRESS_TUI_WORKSPACE_ID はcmuxの CMUX_WORKSPACE_ID に相当）
[ -z "$PROGRESS_TUI_WORKSPACE_ID" ] && exec "$REAL_CLAUDE" "$@"

SESSION_ID=$(uuidgen)

exec "$REAL_CLAUDE" \
  --session-id "$SESSION_ID" \
  --hooks '{
    "hooks": {
      "SessionStart": [{"matcher":"","hooks":[{"type":"command","command":"progress-tui hook session-start","timeout":10}]}],
      "Stop":         [{"matcher":"","hooks":[{"type":"command","command":"progress-tui hook stop","timeout":10}]}],
      "Notification": [{"matcher":"","hooks":[{"type":"command","command":"progress-tui hook notification","timeout":10}]}]
    }
  }' \
  "$@"
```

### 14.4 状態モデルの最小実装

```go
// Claude Code session の状態
type ClaudeSessionState struct {
    SessionID   string    `json:"session_id"`
    WorkspaceID string    `json:"workspace_id"`
    Status      string    `json:"status"` // "running" | "needs_input" | ""
    StartedAt   time.Time `json:"started_at"`
}

// Hook 入力の解析（最小版）
type HookInput struct {
    SessionID        string `json:"session_id"`
    CWD              string `json:"cwd"`
    NotificationType string `json:"notification_type"`
    Message          string `json:"message"`
}
```
