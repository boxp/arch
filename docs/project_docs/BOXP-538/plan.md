# BOXP-538: golyat-4 Longhorn DiskPressure の恒久対策 (kubelet イメージ GC)

## 原因 (2026-11-13 実測)

- Longhorn disk `default-disk-228a0a653393f00a` (golyat-4, `/var/lib/longhorn/`) が
  `CurrentAvailable 495.14GB <= MinimalAvailable 496.27GB (25%)` で DiskPressure / unschedulable。
- golyat-4 はルート FS `/dev/nvme0n1p3` (1.98TB) 1 本に Longhorn・コンテナイメージ・LLM モデル・SD データが同居。
- 実使用 (`du -s -B1 -x`): `/var/lib/containers` 764.5GB (イメージ 836 個、codex-workspace だけで 280 世代)、
  `/var/lib/local-llm/models` 397.5GB、Longhorn replicas 224.7GB、`/mnt/ssd` 72.9GB。
- 空きは 7 日で 818GB → 495GB。Renovate/Image Updater による頻繁な digest 更新で旧イメージが残り続けた。
- kubelet のイメージ GC は既定 high 85% でしか動かず、Longhorn の 25% 空き条件 (使用 75%) が先に効く。

## 即時対応 (実施済み、手動)

- 稼働中/全 workload spec 参照中/各 repo 最新 2 世代/24h 以内を保護し、Renovate 更新系 repo の旧イメージ 616 個を `crictl rmi`。
- GPU/LLM/ゲーム系 (sdnext, comfyui, llama-sycl, whisper, palserver 等) は対象外。
- 空き 494.5GB → 1034.1GB。Longhorn disk Schedulable=True (07:25:55Z)。

## 恒久対策 (この PR)

- worker 専用 role `worker_kubelet_image_gc` を追加し `worker-image.yml` から呼ぶ。
  - `/etc/kubernetes/kubelet.conf.d/50-image-gc.conf`: `imageGCHighThresholdPercent: 70`,
    `imageGCLowThresholdPercent: 65`, `imageMaximumGCAge: 168h`。
  - `/etc/systemd/system/kubelet.service.d/20-kubelet-config-dir.conf`: `KUBELET_CONFIG_ARGS` に `--config-dir` を追加
    (10-kubeadm.conf より後に読まれる)。
  - 変更時のみ kubelet を restart し healthz を待つ。失敗時は drop-in を消して元設定で restart し fail。
- 共有 role `kubernetes_components` は変更しないため、apply-ansible の対象は golyat-4 のみ (control plane へ Apply しない)。
- Longhorn の閾値 (storage-minimal-available-percentage 等) は変更しない。

## 検証

- `tests/test_worker_kubelet_image_gc.py` (描画・冪等・不正値拒否・check mode・playbook 組込み)。
- merge 後: Apply Ansible run の matrix が golyat-4 のみ、kubelet 再起動後 Ready、drop-in の実効、
  Longhorn disk Schedulable、全 volume healthy、golyat-4 Pod 正常を確認。

## Rollback

- role を playbook から外すだけでは drop-in は残るため、node 上の 2 ファイルを削除し `systemctl daemon-reload && systemctl restart kubelet`。
