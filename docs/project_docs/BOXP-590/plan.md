# BOXP-590: arch の Renovate 滞留 PR を片付け、更新を止めている版だけを一時抑止して解除を監視する

## 目的

boxp/arch で滞留している Renovate PR を原則 0 件にする。

- 対応できる更新は、互換修正、build/test/CI、merge、配備の確認まで済ませる。
- 本当に止まっている更新は、阻害している版だけを Renovate の対象から一時的に外す。
  外した更新は日次の watch で解除条件を監視し、条件を満たしたら通常の更新に戻す。

## 着手時の open Renovate PR（9件。Search API の total_count と ID 集合が一致）

| PR | 内容 | 判定 | 対応 |
| --- | --- | --- | --- |
| #14252 | kubectl 1.37.1→1.37.2（codex-workspace） | patch。クラスタ 1.36 との skew は +1 で許容範囲。CI はすべて pass | merge する |
| #15212 / #14515 / #14516 | kohako-studio の Node runtime 26 と @types/node 26（bff/web） | Node 26 は LTS。実際に build/test して互換性を確認し、revert で戻せる | 統合 build を検証してから merge し、配備を確認する |
| #14518 | TypeScript 7（kohako-studio bff） | CI pass | 統合 build を検証してから merge する |
| #14519 | TypeScript 7（kohako-studio web） | CSS の side-effect import の型（`vite/client`）と、`hidden` の型変更による 1 件で失敗 | 修正を push し、CI を通してから merge する |
| #13832 | TypeScript 7（portfolio） | `@astrojs/check` が TS7 を peer として許可していないため、上流の対応待ち | TS7-PORTFOLIO として抑止する（Renovate の autoclose で閉じる） |
| #13804 | Python 3.15（ansible） | ansible-core 2.21 が Python 3.15 で動かない。対応版は community ansible 15 が GA になるまで出ない | PY-315 として抑止する |
| #13440 | Kubernetes / CRI-O 1.37（ansible/playbooks） | 手動のクラスタ upgrade の承認境界 | K8S-137 として抑止する。1.36.x の patch は従来の Dashboard 承認のまま |

抑止の詳細は [blockers.md](./blockers.md) にまとめた。

## 監視

既存の定期処理と重複しないことを確認した。

- BOXP-459 の日次整理（Hermes cron）は PR の分類と操作をするもので、上流の解除条件は見ていない。
- weekly-stale-pr-audit は分類だけをする。
- CVE watch は別の CVE が対象。

そのため、Codex Cron に新しい command job `arch-renovate-blocker-watch` を追加した（毎日 13:30 JST、LLM なし）。
スクリプトと状態ファイルは Obsidian vault の `Projects/github-pr-hygiene/renovate-blocker-watch/` に置き、vault の外へは書き込まない。

## 安全境界

次のことはしない。

- 本番の Ansible / Terraform の手動操作、クラスタの upgrade
- CI の検証を弱めること、branch 保護の bypass、gate を確認しない merge
- `enabled:false` や major 更新の全面停止のような広い抑止
