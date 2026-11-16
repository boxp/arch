# BOXP-267 恒久対策計画

## 目的と根拠

codex-workspace-home の Longhorn iSCSI デバイスを golyat-4 の multipathd が取り込み、CSI による ext4 mount を妨げた問題に対し、Longhorn (tgt) が公開するデバイスだけを multipath から除外する。

実機証拠（golyat-4 journal）:

- 2026-10-11 02:23:45 に 50GiB の `IET VIRTUAL-DISK` (sdb 8:16) が接続された同秒に multipathd が `mpatha` を作成し `/etc/multipath/wwids` に WWID `360000000000000000e00000000010001` を記録。02:37:14 に owner が `multipath -f mpatha` で手動解消したが wwids は残った。
- 2026-10-22 05:12:06 / 05:25:16 に codex-workspace-home が同 WWID（tgt target ID 1 の再利用）で接続され即座に `mpatha` へ取り込まれ、kubelet/CSI の mount が exit 32 で反復失敗。05:37:51 の detach で map は自然解放。
- 2026-10-22 06:06:43 に本番 PVC を使わない 1Gi scratch volume を golyat-4 へ接続したところ、同じ WWID (target ID 1) で再現（`DM_MULTIPATH_DEVICE_PATH=1`、mke2fs "apparently in use by the system"）。
- golyat-3 も wwids に別 WWID (`...60001`) を保持し 2026-10-10 に別 volume を addmap した同種の潜在状態。

WWID は tgt の target ID 由来で PVC 固有ではないため、exact WWID の除外では target ID が変わった時点で再発し得る。Longhorn v1 data engine のデバイスは常に vendor `IET` / product `VIRTUAL-DISK` を名乗るので、この組だけを blacklist する。実ディスク（nvme、USB sd*）や root 設定、他の WWID は対象外。golyat-4 には multipath map も multipath 依存ストレージも存在しない（`dmsetup ls --target multipath` = No devices found、root は nvme0n1p3）。

## 実装

1. `ansible/files/longhorn-multipath.conf`: `blacklist { device { vendor "^IET$" product "^VIRTUAL-DISK$" } }` のみ。
2. `ansible/playbooks/worker-image.yml`: `/etc/multipath/conf.d/90-longhorn.conf` としてイメージ/ノードへ配置（tag `multipath`）。配置前に `multipath -t` の実効設定を verify で検査（check-mode でも実行、fail closed）し、配置後は block/rescue 内で候補設定を `--require-blacklist` で検査する。検査失敗時は旧 drop-in を復元（無ければ新 drop-in を削除）して play を失敗させ、handler には到達させない。`multipath -t` は daemon/udev/デバイス不要なので chroot ビルドでも検証する（`multipath` バイナリが無い環境では検証を skip）。handler は `multipathd reconfigure` のみで、multipathd 非稼働なら skip、既存 map があれば fail、chroot では実行しない。既に drop-in が存在し稼働 daemon に未反映なら handler を通知して再同期する。stop/restart/flush はしない。
3. `ansible/playbooks/longhorn-multipath.yml`: 1 ノード限定の手動適用用。`--limit <worker> -e longhorn_multipath_confirm=true` を必須にし、既存 map なし・daemon active・`multipath -t` の実効設定検査→drop-in 配置→候補設定検査（失敗時は元へ戻す）→map 再確認→`multipathd reconfigure`→`multipathd show config` 検査の順に進む。後半（map 再確認・reconfigure・daemon 実効設定検査）も block/rescue で覆い、失敗時は旧 drop-in を復元（無ければ新 drop-in を削除）し、reconfigure が実行済みの場合のみ復元後の設定を `multipathd reconfigure` で再読込する（stop/restart/flush はしない）。map 再確認で止まった場合は daemon が候補を読んでいないため再読込しない。
4. `ansible/files/verify_longhorn_multipath.py`: 実効設定を解析し、非標準 `config_dir`、WWID/IET の blacklist_exceptions を fail closed、`--require-blacklist` で anchored な IET/VIRTUAL-DISK device blacklist の存在を要求。
5. `ansible/tests/test_longhorn_multipath.py`: drop-in の内容、実効設定の受理/拒否、worker-image への配線と handler の安全条件を回帰テスト。limited-apply playbook の 2 つの mutation phase がいずれも rescue で drop-in を復元すること、rollback reload が reconfigure 実行後のみ走ること、stop/restart/flush を含まないことも構造テストで固定。

## 検証と反映

- unittest / syntax-check / ansible-lint / 既存 CI。
- apply-ansible は 2026-10-19 以降 shanghai-2 の armbian apt Release 欠落で失敗し golyat-4 job は cancel されるため、merge だけでは golyat-4 に届かない。認可済み SSH 経路から `longhorn-multipath.yml --limit golyat-4` を手動適用する（CI が使うのと同じ playbook/inventory）。
- 検証は本番 PVC を動かさず、golyat-4 上の scratch Longhorn volume で「修正前: FailedMount + mpatha」→「修正後: Running、/data read/write、map なし、`DM_MULTIPATH_DEVICE_PATH=0`」を確認する。
- lolice の `kubernetes.io/hostname: golyat-3` は golyat-4 検証後に別 PR で撤去する（`kubernetes.io/arch: amd64` は維持）。merge すると Recreate で workspace Pod が作り直されるため、同 Pod 上の他 run がない時に merge する。

## 切戻し

再発時は lolice の golyat-3 固定を再適用して復旧を優先する。drop-in の切戻しは、対象ノードに multipath map がないことを確認してから `/etc/multipath/conf.d/90-longhorn.conf` を削除し `multipathd reconfigure`。不明な map の flush、強制 detach、共有サービス再起動、ノード再起動など承認外の操作は行わない。golyat-3 の同種潜在状態は同じ playbook で `--limit golyat-3` 適用可能だが、本票では golyat-3 を現行の復旧ノードとして触らず、別判断とする。
