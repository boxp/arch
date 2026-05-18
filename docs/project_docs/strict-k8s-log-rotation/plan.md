# strict-k8s-log-rotation

## 背景

Orange Pi control plane nodes の `/var/log` は Armbian の zram 上にあり、容量が小さい。Kubernetes/CRI-O の pod log が無制限またはデフォルトの大きめの上限で残ると、障害時の高頻度ログで `/var/log` が埋まり、kubelet/CRI-O の復旧を妨げる。

## 計画

1. `kubernetes_components` role に container log rotation のデフォルト値を追加する。
2. kubelet config template に `containerLogMaxSize` と `containerLogMaxFiles` を出力する。
3. CRI-O drop-in に `log_size_max` を設定して runtime 側でも 1MiB 上限を持たせる。
4. Molecule verify で kubelet/CRI-O の設定ファイル内容を確認する。
5. `ansible-lint` を実行し、既存 role の品質チェックを通す。
