# Recurring Events

定期的に起票したい作業を、人間が Obsidian で読んで編集できる Markdown ノートとして管理する。

## Layout

- `Infrastructure/Recurring Events/Events/<event-id>.md`: 1イベント1ノート。
- `Infrastructure/Recurring Events/state.edn`: 起票済み occurrence の状態。
- `Templates/Recurring Event.md`: 新規イベント用テンプレート。
- `Infrastructure/Codex Cron/prompts/recurring-events.md`: 日次 dry-run 用 prompt。

## Event Frontmatter

必須フィールド:

- `id`
- `title`
- `description`
- `schedule`
- `time-zone`
- `lead-days`
- `priority`
- `project`
- `initial-lane`
- `ticket-template`
- `enabled`

任意フィールド:

- `repo`
- `assignee`
- `reviewers`
- `labels`
- `source-note`

`time-zone` は IANA timezone 文字列。`lead-days` は0以上の整数。評価日はイベントごとの timezone のローカル日付で判定し、`scheduled-date - lead-days <= today <= scheduled-date` の未起票 occurrence を候補にする。

## Schedule

MVP で扱う形式は2つだけ。

`cron` は `value` に5フィールド cron を持つ。

```yaml
schedule:
  type: cron
  value: "0 9 1 */3 *"
```

cron 由来の occurrence-key は `<event-id>:<scheduled-date>`。

`occurrences` は明示リストを持つ。各 item は `key`, `scheduled-date`, `target-period`, `title-suffix` を持つ。

```yaml
schedule:
  type: occurrences
  items:
    - key: "2026"
      scheduled-date: 2027-02-01
      target-period: "2026 tax year"
      title-suffix: "2026年分"
```

明示 occurrence の occurrence-key は `<event-id>:<items.key>`。

`rrule` は後続拡張。MVP では実装しない。

## State

`state.edn` は手で読める EDN として保存する。

```clojure
{:version 1
 :created-occurrences
 {"<occurrence-key>"
  {:event-id "..."
   :scheduled-date "YYYY-MM-DD"
   :created-ticket "BOXP-N"
   :created-at "..."
   :source-file "Infrastructure/Recurring Events/Events/<event-id>.md"}}}
```

同じ occurrence-key が `state.edn` に存在する場合は再起票しない。state 更新に失敗した場合でも、次回 dry-run は既存 ticket または card を検出して `needs-human-check` とし、自動重複作成しない。

## Draft Promotion

MVP では Obsidian 上で `Templates/Recurring Event.md` を複製し、frontmatter と `## Ticket Template` を手で整形して正式イベントにする。将来の Draft レーン連携や `draft-import` 相当スクリプトは Future 扱い。

## Generated Ticket

新規チケットは `Templates/Ticket.md` 互換の frontmatter を持つ。本文には Summary / Acceptance Criteria / Context / Plan / Notes と、次の情報を含める。

- 元イベントファイル
- event-id
- occurrence-key
- scheduled-date
- target-period
- lead-days
- generated-at
- dry-run候補理由

## Task Board

`initial-lane` にカードを追加する。既定値は `Backlog`。許可レーンは `Backlog` と `Ready` のみ。`Ready` は十分に定型化されたイベントだけに使う。

カード形式:

```markdown
- [ ] [[Tickets/BOXP-N|BOXP-N: タイトル]] #ticket status::<lane> priority::<priority>
```

`repo` がある場合は `repo::owner/repo` を付ける。

## Apply Order

apply は次の順序で行う。

1. 次番号採番
2. ticket本文生成
3. 一時ファイル作成
4. Task Board差し込み
5. ticket本配置
6. state更新

Task Board 更新前に失敗した場合は作成物を残さない。Task Board 更新後に state 更新が失敗した場合は、次回 dry-run で `needs-human-check` として検出する。

## Dry Run

イベントごとに次のいずれかを出す。

- `candidate`
- `not-yet`
- `disabled`
- `already-created`
- `invalid`
- `needs-human-check`

候補の場合は作成予定チケット本文と追加予定レーンを表示する。

## Cron Operation

初期ジョブは日次 dry-run のみ。`enabled: false` の安全設定から始め、ログ確認後に別チケットまたは人間判断で apply を有効化する。
