# BOXP-219 実装計画

## 対象と判断

Dependabot #29/#15/#1 を依存定義・lock・説明の更新で解消する。
2026-10-07 UTC に open 3件と最新 main dd342f04a を確認した。
制御側 Python は最低3.11、ansible は最低12.2.0へ変更する。
CI は3.12、既定ローカルPythonは3.14であり、repo内には3.10の継続利用設定がない。
ローカル利用者の3.10継続要否は質問済み・未回答。PRレビュー時に確認する。
管理対象ノードのPython要件は制御側と区別する。

## 作業

1. 最新mainに追従し、変更前lintとGitHub advisoryの全脆弱範囲を記録。
2. pyproject/README/DEPLOYMENTを更新し、ansibleとansible-coreを対象指定で再解決。
3. Python3.12でlocked sync、実行版数、lintと全lock分岐を検証。
4. Galaxy collectionの実際の解決版を記録し、同梱版と区別する。
5. Docker privileged/systemd/cgroup環境で4 role・6 scenarioのmolecule test --allを実施。amd64とCI ARM64の差を記録。
6. video-rotatorのsource-map-jsのみlock更新し、Node22でci/build/ls/auditを検証。
7. trivy config、指定Codex reviewを実施し、ログ要約と未達条件をPRへ記載。
8. merge後の対象alert閉鎖を再確認する。PR時点のopenを解消済みとは扱わない。

## 範囲

本番playbook適用、クラスタ変更、Kubernetes/CRI-O更新、Renovate全体の再設計は行わない。
lock変更だけでは既存CIのMoleculeがskipになるため、skipを成功とせずローカル結果を記録する。

## レビューゲート再試行

worker-image.ymlの置換文字列に関する指摘をAnsible実テンプレートで再検証する。
先頭へ接頭辞を追加する式に変更して後方参照のエスケープを不要にし、
実プレイブックのAPT引数を空・単一・複数カーネルで検証する回帰テストを追加する。
lint・セキュリティ走査・Codexレビューと既存PRの最終CI結果を確認する。
