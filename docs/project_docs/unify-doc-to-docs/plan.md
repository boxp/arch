# doc/ と docs/ の統合計画

## 背景

リポジトリ内に `doc/` と `docs/` の2つのドキュメントディレクトリが存在し、参照が分散していた。
`docs/` に統一することで、参照切れの解消とディレクトリ構造の整理を行う。

## 実施内容

### 1. ファイル移動

| 移動元 | 移動先 |
|--------|--------|
| `doc/project-spec.md` | `docs/project-spec.md` |
| `doc/project-structure.md` | `docs/project-structure.md` |
| `doc/ORANGE_PI_DEPLOYMENT.md` | `docs/ORANGE_PI_DEPLOYMENT.md` |
| `doc/system-architecture.drawio.svg` | `docs/system-architecture.drawio.svg` |
| `doc/project_doc/*` (11ディレクトリ) | `docs/project_docs/*` (命名を `project_docs` に統一) |

### 2. 参照更新

| ファイル | 変更内容 |
|----------|----------|
| `README.md` | `doc/system-architecture.drawio.svg` → `docs/system-architecture.drawio.svg` |
| `.openhands/microagents/repo.md` | `doc/project-structure.md`, `doc/project-spec.md` → `docs/` |
| `.cursor/rules/common.mdc` | `@doc/project-structure.md`, `@doc/project-spec.md` → `@docs/` |
| `CLAUDE.md` | `@doc/project-structure.md`, `@doc/project-spec.md` → `@docs/` |
| `docs/project-structure.md` | ディレクトリツリー内の `doc/` → `docs/` |
| `docs/project-spec.md` | ディレクトリツリー内の `doc/` → `docs/`, `project_doc/` → `project_docs/` |

### 3. ディレクトリ削除

- `doc/` ディレクトリを完全に削除

## 結果

- すべてのドキュメントが `docs/` 配下に統一
- `project_doc` → `project_docs` に命名統一（`docs/project_docs/` に既存のものと合流）
- リポジトリ内のすべての参照が更新済み
