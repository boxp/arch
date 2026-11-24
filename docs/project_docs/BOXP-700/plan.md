# BOXP-700: コハコから Nature Remo 公式 API でエアコン・シーリングファンを扱う準備

現行仕様: Obsidian vault `Projects/kohako-nature-remo/spec.md`

## 構成

| 役割 | 置き場 |
|---|---|
| トークン置き場（SSM SecureString、初期値ダミー、値は本人が入れる） | arch `terraform/aws/codex-workspace/ssm.tf` → `/lolice/hermes-agent/nature-remo-token` |
| ExternalSecret → `NATURE_REMO_TOKEN`（optional） | lolice `argoproj/hermes-agent/external-secret-nature-remo.yaml` |
| CLI（bb、公式 API を直接呼ぶ） | lolice `argoproj/hermes-agent/scripts/nature-remo/nature_remo.clj` → `/opt/data/scripts/nature_remo.sh` |
| コハコ向けスキル | 同 `SKILL.md` → `/opt/data/skills/smart-home/nature-remo/SKILL.md` |
| 送信許可リスト（読み取り専用、初期は空） | 同 `allowlist.edn` → `/etc/nature-remo/allowlist.edn` |

## 安全条件（要旨）

- 読み取り（`list` / `sensors`）だけが今回の実 API 利用範囲。送信は本人の個別指示まで行わない。
- 送信は許可リスト照合 → `--execute` なしは確認表示のみ → 送信ロック → 家電ごとの待ち時間 → POST 1 回（自動再試行なし）。
- 「送信受付」は Remo API が受け付けたことだけで、実機状態は未確認と必ず表示。
- 新 MCP / Home Assistant / 新課金 / 権限追加なし。

## 本人に残る操作

1. https://home.nature.global でアクセストークンを発行。
2. `aws ssm put-parameter --name /lolice/hermes-agent/nature-remo-token --type SecureString --overwrite --value '<トークン>'`
   （シェル履歴に残さない方法で。External Secrets の反映は最大 1 時間、Pod の再起動で env が更新される）。
3. コハコに `nature_remo.sh list` を頼み、エアコン・シーリングファンの id を確認。
4. 送信を許可する家電・信号を lolice の `allowlist.edn` に PR で追加。
