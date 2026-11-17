# BOXP-590: Renovate 一時抑止の台帳

更新が技術的に止まっている依存や、手動のクラスタ更新の境界にかかる依存は、
`renovate.json5` の `allowedVersions` を使って **阻害している版だけ** を一時的に外す。
いま使っている系列の patch / security 更新は止めない。
抑止は PR 番号ではなく、依存の内容（manager / file / package / 版の範囲）で管理する。

解除条件は、Renovate とは別の日次 watch が公式の情報源を読んで判定する。
watch は Codex Cron の command job `arch-renovate-blocker-watch` で、毎日 13:30 JST に動き、LLM は使わない。
解除条件を満たすと、watch は Task Board に「抑止解除」票を作る。その票で rule を削除する PR を出し、
Renovate の通常の PR と CI に戻す。

| ID | 対象 (manager / file / package) | 抑止範囲 | 止めずに続ける更新 | 阻害の根拠 | 解除条件 (watch の監視先) | 抑止時に閉じた PR |
| --- | --- | --- | --- | --- | --- | --- |
| PY-315 | pyenv / `ansible/.python-version` / `python` | 3.15 以上 | 3.14.x | ansible 14.x が依存する ansible-core 2.21 は、Python 3.15 で削除された `dataclasses._is_type` を import 時に参照するため落ちる（#13804 の lint と plan が失敗）。Python 3.15 に対応する ansible-core 2.22 は、community `ansible` 15 の rc にしか入っていない | PyPI `ansible` の最新安定版が ansible-core 2.22 以上を要求し、かつその ansible-core が Python 3.15 の classifier を持つこと | #13804 |
| TS7-PORTFOLIO | npm / `apps/portfolio/package.json` / `typescript` | 7.0.0 以上 | 5.x と 6.x | `astro check` が使う `@astrojs/check` 0.9.12 の peerDependencies が `typescript: ^5.0.0 \|\| ^6.0.0` のため、Renovate が lock を更新できない（#13832 の build が `npm ci` で失敗） | npm `@astrojs/check@latest` の peerDependencies.typescript が 7 系を許可すること | #13832 |
| K8S-HOLD（旧 K8S-137） | custom.regex / `ansible/playbooks/**` / `kubernetes/kubernetes`, `cri-o/cri-o` | 現行版より新しい版すべて（kubernetes `<=1.36.5`、cri-o `<=1.36.6` のみ許可）。2026-11-17 の Owner 選択 B で 1.36.x patch も今回は見送る | なし（クラスタ版は Owner 承認まで固定） | クラスタ本体の更新は、minor も patch も手動 upgrade（`upgrade-k8s.yml`）の承認境界。main への merge で apply-ansible が本番に反映され得るうえ、`kubernetes_package_version` / `crio_package_version` は Renovate の管理外なので test も失敗する | Owner が patch または minor の upgrade を承認すること（その票で上限を上げるか rule を削除する）。watch は main の版、1.36 の EOL（endoflife.date）、1.36 の最新 patch を毎日読み、EOL の 90 日前に 1 回だけ通知する。main の版が固定値から変わったら、rule の上限更新が必要だと通知する | #13440（1.37→1.36.6/1.36.8 patch。Owner 選択 B で Close） |

## 運用

- 抑止 rule を merge すると、該当する既存 PR は Renovate が `autoclosed` として閉じる。
  手動で Close しないので、その版が ignore されることはない。rule を外せば、同じ更新の PR がもう一度作られる。
- watch の挙動
  - 状態が変わったときだけ通知する。通知は BOXP-590 の Notes に追記し、Hermes がそれを中継する。
  - 取得に失敗した回は blocked とも解消とも扱わない。2 回続けて失敗したら 1 回だけ通知し、回復したときも 1 回通知する。
  - 02:00–09:00 JST は静音時間で、通知と起票は次の回に回す。
- K8S-HOLD だけは、条件を満たしても票を自動では作らない（Owner の判断が必要なため）。
- 解除後にまた阻害が見つかった場合は、rule を戻し、この台帳と watch を更新する。

## 2026-11-17 Owner 選択 B（K8S-137 → K8S-HOLD）

- K8S-137 の 1.37 抑止だけを入れたあと、#13440 は Kubernetes 1.36.6 / CRI-O 1.36.8 の patch PR に変わった。
  main へ merge すると apply-ansible が本番クラスタに反映され得るため、Owner の判断を仰いだ。
- Owner は B を選んだ。今回はクラスタの patch 更新も見送り、その更新を一時的に抑止して #13440 を Close する。
- 対応として、`allowedVersions` を main の現行版（kubernetes 1.36.5 / cri-o 1.36.6）以下に固定した。
  BOXP-459 TD-04 の Dashboard 承認 rule はそのまま残す。上限を上げたあとに PR を作るかどうかは、従来どおり Owner がチェックして決める。
- 本番クラスタへの upgrade と Ansible の適用は行っていない。
