# BOXP-267 恒久対策計画

## 目的と根拠

codex-workspace-home の Longhorn iSCSI デバイスを golyat-4 の multipathd が取り込み、CSI による ext4 mount を妨げた問題に対し、確認済み WWID だけを同ノードのブラックリストに加える。

調査者の確認記録では、対象 PVC `pvc-f81b80fe-11e7-4539-b36a-dbe28416f524` が 05:25:16 に major/minor `8:32` (`sdc`) として作成され、同秒 multipathd が `mpatha` に追加した。05:37:51 の detach 後に map は自然解放されている。golyat-3 の対象デバイスの scsi_id と golyat-4 の multipath 履歴は WWID `360000000000000000e00000000010001` で一致する。詳細な RCA、時刻、未確認事項、実機反映記録の正本は Obsidian `Projects/BOXP-267/` とする。この文書自体は本番反映済みを意味しない。

WWID は Longhorn tgt の target ID 由来であり、PVC 専有の安定識別子ではない（instance-manager の target ID 1 の確保ログと対応）。今回の対策は golyat-4 の記憶済み WWID 10001 が引き起こした再取り込みを防ぐ範囲に限定する。他の Longhorn ボリュームで同じ target ID が再利用された場合もこの除外が効く一方、将来この PVC の target ID が変わる場合や別 WWID のデバイスは保護対象にならない。したがって golyat-4 の実機検証で割当 WWID と除外適用を再確認し、将来のストレージ変更では Longhorn デバイスと multipath 依存の対応を再調査する。全 Longhorn を恒久的に保護したとの判断はしない。

## 実装

1. 独立した playbook `ansible/playbooks/longhorn-multipath.yml` を golyat-4 のみへ実行する。既存の node 全体構築・upgrade playbook は実行しない。
2. 実行者が WWID と対象 PVC の対応、および golyat-4 からの detach を確認してから、`longhorn_multipath_identity_verified=true` と `longhorn_multipath_volume_detached=true` を明示する。guard は証拠確認を代行しない。
3. 既存 multipath map が一つでもある場合は変更を止める。multipathd が既に動作中であることも確認する。停止・起動・flush をしない。
4. `multipath -t` の実パーサーで有効設定を読み、標準 config_dir と WWID 例外を検査する。例外がある環境は別途検討する。プロパティ例外は保持する。
5. `/etc/multipath/conf.d/90-longhorn-codex-workspace.conf` に anchored exact WWID のみを追加。root 設定と他 WWID は保持する。全体設定で当該ブラックリストが有効でなければ drop-in を元に戻し、daemon には反映しない。
6. 成功時だけ `multipathd reconfigure` を実行し、`multipathd show config` で daemon 実効設定も検査する。再起動・map flush は実施しない。reconfigure 後の失敗は成功扱いせず運用者へ返す。

## 検証と反映

- 回帰テストで WWID の違い・非 anchored パターン・WWID 例外・非標準 config_dir・壊れた設定を拒否することを確認。既存 Ansible CI の unittest discovery が自動実行する。
- Ansible syntax-check と ansible-lint、実機の読み取り専用 `multipath -t` 出力を verifier へ渡す検証を実施する。
- review/merge ゲートを守って正本 revision を決め、認可済み SSH/Ansible 経路で限定適用する。独立実行経路、同時利用防止、競合作業の調整が揃うまで対象 PVC を移動しない。
- golyat-4 上で対象 PVC の正常 mount と最小限の一時ファイルの読書きを確認できてから lolice の今回の golyat-3 固定のみを撤去する。既存 amd64 条件を保持する。Pod Ready、workspace 接続、Board/Cron/同期の起動と安定性を確認し、既存処理は重複実行しない。

## 切戻し

対象 mount の検証で再発した場合は golyat-3 固定で復旧を優先する。drop-in の切戻しは対象が golyat-4 から安全に detach 済み、既存 multipath map なしを確認後、管理ファイルを削除（以前から存在した場合はその内容へ復元）して `multipathd reconfigure`。不明な map の flush、強制 detach、共有サービス再起動、ノード再起動など承認外の操作は行わない。
