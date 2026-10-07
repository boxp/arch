# BOXP-219 検証結果

検証日: 2026-10-07 UTC。基準: main `dd342f04a`。

## Pythonとlock

制御環境の最低Pythonを3.11、Ansible community packageの下限を12.2.0に変更。
CIの制御Pythonは3.12、`.python-version`は3.14であり、repo内には3.10継続の設定を確認できない。
ローカル利用者の3.10継続要否は質問済み・未回答のため、マージ前のレビュー確認事項とする。
これは管理対象ノードのPython要件を変更するものではない。
[公式互換表](https://docs.ansible.com/projects/ansible/latest/reference_appendices/release_and_maintenance.html)でcore2.19の制御Python3.11対応を確認。

`uv lock --upgrade-package ansible-core --upgrade-package ansible` で再解決。
Python3.10の解決とその専用依存が除去され、下限変更に伴う他ツールの3.10用分岐も除去された。

| 制御Python | ansible | ansible-core | platform |
| --- | --- | --- | --- |
| 3.11 | 12.3.0 | 2.19.14 | 全lock分岐 |
| >=3.12 | 14.5.0 | 2.21.5 | 全lock分岐 |

lockの全ansible/coreエントリをpackaging.version/SpecifierSetでGitHub advisory APIと照合した。
[GHSA-w8p5-mx5w-cpqj](https://github.com/advisories/GHSA-w8p5-mx5w-cpqj) の全脆弱範囲
`<2.16.19rc1`、`>=2.17.0b1,<2.18.18rc1`、`>=2.19.0b1,<2.19.11rc1`、
`>=2.20.0b1,<2.20.7rc1`、`>=2.21.0b1,<2.21.1rc1` のいずれにも該当しない。
ansibleの全エントリも[GHSA-8ggh-xwr9-3373](https://github.com/advisories/GHSA-8ggh-xwr9-3373)の`<12.2.0`の範囲外。

Python3.12.14 / uv0.12.5 / ansible-lint26.8.0 / Molecule26.8.0 / molecule-plugins26.7.15:

- `uv sync --locked --python 3.12`: 成功。
- `uv run --locked --python 3.12 ansible --version`: core2.21.5、ansible package14.5.0。
- `uv run --locked --python 3.12 ansible-lint`: 成功、69ファイル、0 failure/0 warning。
- `uv run --locked --python 3.12 python -m unittest discover -s tests -p 'test_*.py' -v`: 3テスト成功。

変更前mainのlintはworker-image.yml:61の行長166文字について警告1件（終了0）。
同じ式をfolded scalarへ折り返し、YAML読込後の構造が空白正規化を除いて同一であることも確認。

## Galaxy collection

pip同梱: community.general13.5.0、ansible.posix2.2.2、kubernetes.core6.6.0。
`ansible-galaxy collection install -r requirements.yml -p /tmp/BOXP-219-galaxy --force` で
別パスに外部Galaxy版を実際に取得した結果も同じ版だった。
この別パスは通常の探索パスへ追加せず、外部取得の確認用として使用。
本件Mediumはcommunity.generalのKeycloak資格情報ログ露出に関するもので、ansible packageと
collectionを同一の版数として比較しない。
[上流修正](https://github.com/ansible-collections/community.general/commit/08e56bbb9b57740a879d3057d84cdb02a162b840)
のkeycloak_user `credentials.value` の `no_log=True` が同梱版・外部版の両方に存在することを確認した。

## Molecule

Docker29.8.2 / Linux x86_64 / cgroup v2、privileged、cgroupns=host、
/sys/fs/cgroupの書込とsystemd runningを隔離probeで確認。
CIのARM64との一致は未検証。amd64で全4role/6scenarioを実行し、結果を追記する。
レビューCLIのuv runが共有venvを再作成した初回実行は無効とし、
レビュー用venvを隔離してPython3.12で再実行した結果を採用する。
lock/pyprojectだけの変更では既存CIのrole matrixはskipになる。skipは成功と扱わない。

## video-rotator

Node22.23.3 / npm11.19.0で `npm update source-map-js --package-lock-only` を実行。
差分はsource-map-jsのversion/resolved/integrityのみで、Vite/TypeScriptの変更なし。

- `npm ci`: 成功。
- `npm run build`: 成功。
- `npm ls source-map-js`: vite8.2.2 → postcss8.5.26 → source-map-js1.2.2。
- `npm audit --json`: 終了0、脆弱性0件、[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)残存なし。

## Renovate・マージ後確認

[Dashboard #18](https://github.com/boxp/arch/issues/18) はansible v12 security pendingを維持し、
lock maintenanceはRate-Limited。
[PR #13367](https://github.com/boxp/arch/pull/13367)は2026-10-07 05:11:31Zにmerge済みだが、Python3.10分岐は残っていた。
[PR #13388](https://github.com/boxp/arch/pull/13388)は06:40:02Zにmerge済みで、別アプリlolice-member-portal向け。
現在のopen PR一覧では本件対象の独立修正は確認できなかった。
ansible-coreはpyprojectの直接依存ではなく、video-rotatorのsource-map-jsも推移依存で、
Dashboardの直接検出一覧に独立項目がない。独立更新PRが作られる保証は確認できない。
再確認はDashboardのlock maintenance状態、open/merged PRのmanifest差分、
lockの実際の版数、Dependabot APIを照合する。

PR作成前の対象#29/#15/#1はopen。マージ後に
`gh api 'repos/boxp/arch/dependabot/alerts?state=open&per_page=100'` と各alert APIを確認し、
日時付きでチケットNotesへ追記する。非同期更新待ちは保留とする。dismissは行っていない。

## セキュリティ走査・レビュー

Trivy0.75.0の `trivy config .` はチェック定義ダウンロードが5分以上進まず停止した。
`--skip-check-update` で内蔵チェックへfallbackして全体を走査し、生成された.venv/.ansible/node_modulesを除外したJSON結果も取得。
LOW8/HIGH5の計13件を検出。変更前mainのgit archiveを同じ内蔵チェックで走査し、13件すべて一致、新規指摘0件と確認した。
最新チェック定義での検証はできていないため、この制約をレビューに残す。
GitHub Actionsの変更はない。

codex-review: Codex CLI gpt-5.6-terraによる差分レビューは指摘なし。
codex-review-file: PR本文のMolecule検証中表現を明確にする指摘を受け、最終結果と未達条件を記載して対応。
