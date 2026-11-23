# BOXP-670: Renovate 更新を止める Terraform 恒常差分の原因調査と収束

## 背景
BOXP-651 で「tfaction が plan 差分を検出したら automerge を止める」制御が本番で効くようになった。
その結果、aqua-registry 更新の Renovate PR のうち、毎回同じ差分が出る 3 ディレクトリ
（arch#15513 even-g2-lab / #15517 k8s / #15528 video-rotator）が止まって溜まるようになった。

## 原因（根拠）
| dir | 差分 | 原因 | 根拠 |
| --- | --- | --- | --- |
| k8s | `warp_include.policy_id` → known after apply | provider 5.28.0 では `policy_id` が Computed のみで UseStateForUnknown がなく、plan のたびに unknown になる | provider v5.29.0 で `UseNonNullStateForUnknown` 追加（CHANGELOG "keep policy_id from state in plans"）。lock を 5.29.0 にした #15543 の k8s plan は No changes |
| even-g2-lab | `require_gateway` の `+ description` / `+ enabled (known after apply)` | `type = "gateway"` の posture rule は API が description を GET で返さず、refresh で state が null に戻る | upstream issue cloudflare/terraform-provider-cloudflare#7461（修正は 5.29.0 より後のリリース）。#15543（5.29.0）でも同じ差分。過去 apply は毎回 1 changed で成功し、次の plan で再発 |
| video-rotator | Pages の `build_config` / `build_image_auto_upgrade` known after apply | provider 側で `deployment_configs` の提案値が prior state と異なると判定され、computed 属性が unknown になる | upstream issue #7449（修正は 5.29.0 より後のリリース）。#15543（5.29.0）でも同じ差分 |

## 方針
- 差分を隠す設定（`ignore_changes`、判定 skip、tfaction 制御の緩和）は使わない。
- k8s: cloudflare provider lock を 5.29.0 に上げる（Renovate が #15543 で生成した lock と同一 blob）。
- even-g2-lab: API が保持を返さない `description` を設定から外す（upstream の推奨 workaround）。Optional+Computed のため API 呼び出しは発生せず、判定に使われる `type` は不変。
- video-rotator: 設定側で安全に収束させる手段がない（`deployment_configs` を明示すると本番 Pages 設定の変更になる）。provider の次リリース（#7449 修正入り）を待って lock を上げる。

## 確認
- この PR の tfaction plan で k8s / even-g2-lab がともに `No changes` であること。
- merge 後の apply が 0 変更であること、Renovate PR #15513/#15517 が rebase 後 No changes になり通常経路で merge されること。
- video-rotator は provider 次リリース後に再 plan で収束を確認する。
