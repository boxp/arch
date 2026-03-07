# T-20260302-010: cmuxコード調査とLinux向け進捗TUI実装方針まとめ

## 概要
cmux (manaflow-ai/cmux) の進捗表示機能を調査し、Linux/WSL向けの進捗モニタリングTUIの実装方針を具体化する。

## 成果物
- `docs/cmux-progress-view-analysis.md` - 調査結果と実装方針の包括的ドキュメント

## 調査結果サマリー
1. cmuxはSwift/macOSネイティブアプリで、Unix Domain Socket経由のテキスト/JSON-RPCプロトコルで状態を管理
2. 状態モデルはWorkspaceクラスの@Publishedプロパティ群（progress, gitBranch, pullRequest, logEntries, statusEntries等）
3. シェル統合（zsh/bash precmd/preexec）でgitブランチ・PWD・ポートを自動検出
4. サイドバーはSwiftUIでリアクティブに描画

## Linux/WSL向け実装方針
- **技術選定**: Go + Bubble Tea + Lip Gloss（シングルバイナリ、TUI向き）
- **データソース**: progressファイル監視 + gwq status + git CLI + gh CLI
- **Phase 1 MVP**: ファイル監視ベースの読み取り専用モニター（1〜2日）
- **Phase 2**: cmux互換Socket API + シェル統合（2〜3日追加）
- **Phase 3**: PR/ポートスキャン/永続化/tmux統合（3〜5日追加）

## 完了条件
- [x] cmuxの進捗表示の全体像を文書化
- [x] データフロー詳細を文書化
- [x] 状態モデル詳細を文書化
- [x] Linux向け再設計（互換/非互換ポイント）を整理
- [x] MVP設計を文書化
- [x] 実装チェックリストを作成
- [x] 参照ファイル一覧を作成
