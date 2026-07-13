# BOXP-60: SD Card Image Write Action

## 目的

control-plane ノード（shanghai-*）の SD カード障害時に、復旧用 SD カードを素早く作成するための GitHub Actions ワークフローを実装する。

## 実装内容

### 新規ファイル

- `.github/workflows/write-sdcard-image.yml` — SD カード書き込みワークフロー
- `terraform/aws/github-actions-ansible/iam.tf` — Ansible Apply ロールへの S3 read 権限追加

### ワークフロー概要 (`write-sdcard-image.yml`)

**入力パラメータ:**
| パラメータ | 説明 | デフォルト |
|-----------|------|----------|
| `node_name` | 復旧対象ノード名 (イメージ選択) | `shanghai-2` |
| `worker_node` | SD カードライターを接続した worker ノード | `golyat-4` |
| `device_path` | worker ノード上のブロックデバイスパス | `/dev/sdj` |
| `dry_run` | 書き込まずに確認のみ | `false` |

**処理フロー:**
1. `GitHubActions_Ansible_Apply` IAM ロールで AWS 認証
2. SSM から Cloudflare Access 認証情報を取得
3. GitHub Secret `ANSIBLE_SSH_PRIVATE_KEY` で SSH 鍵を設定
4. Cloudflare bastion 経由で worker ノードに SSH 接続確認
5. **安全チェック**: 対象デバイスが removable かつ unmounted であることを確認
6. S3 から最新イメージをダウンロード (チェックサム検証付き)
7. `xzcat | ssh ... dd` でイメージをストリーミング書き込み
8. `lsblk` でパーティションテーブルを検証

### IAM 変更 (`terraform/aws/github-actions-ansible/iam.tf`)

`GitHubActions_Ansible_Apply` ロールに以下のポリシーを追加:
- `s3:GetObject` on `arn:aws:s3:::arch-orange-pi-images/images/orange-pi-zero3/*`
- `s3:ListBucket` on `arn:aws:s3:::arch-orange-pi-images`

## BOXP-103 での即時利用手順

```
1. GitHub → boxp/arch → Actions → "Write SD Card Image"
2. inputs:
   - node_name: shanghai-2
   - worker_node: golyat-4
   - device_path: /dev/sdj   ← golyat-4 で確認済み (Generic STORAGE DEVICE)
   - dry_run: false (最初は true で確認推奨)
3. 書き込み完了後、SD カードを golyat-4 から抜いて shanghai-2 に挿入
4. Runbook: Incidents/Runbooks/shanghai-control-plane-sdcard-failure を適用
```

## 安全設計

- **removable チェック**: `/sys/block/{dev}/removable = 1` でない場合は中止
- **マウント中チェック**: 対象デバイスのパーティションがマウント中なら中止
- **dry-run モード**: デバイス確認・イメージ情報表示のみ、書き込みなし
- **チェックサム検証**: S3 の `.sha256` ファイルで整合性確認
- **デバイス明示必須**: 自動推測は行わず、必ず指定が必要

## Terraform 適用

Terraform の Apply が必要 (IAM ポリシー追加のため)。ワークフロー実行前に `terraform/aws/github-actions-ansible` を apply すること。
