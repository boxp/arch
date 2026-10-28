# 閉じた合成画像評価ハーネス

既存 Board、モデル、外部 API、クラスタへの接続はありません。固定された架空の Task / Novel 各1件だけを受け付け、画像は各1枚までです。fake の 1×1 PNG はテスト用であり Qwen の実画像ではありません。実画像の評価実績は **0枚**です。独立した Linux ファイルシステム上の専用ディレクトリを指定してください。機密・既存 vault を指定しないでください。root は信頼できる単一ユーザー専用で、他者によるファイルや symlink の変更がないことが前提です。ローカルの `flock`、SQLite、`renameat2(RENAME_NOREPLACE)` と同一ファイルシステムを使用します。NFS や複数ホストの調停は対象外です。

```sh
python3 docker/codex-workspace/qwen-eval/harness.py --root /tmp/qwen-eval submit task-board
python3 docker/codex-workspace/qwen-eval/harness.py --root /tmp/qwen-eval run task-board --fake
python3 docker/codex-workspace/qwen-eval/harness.py --root /tmp/qwen-eval status task-board
python3 -m unittest discover -s tests/qwen-eval -v
```

`novel-board` も同じ操作です。`--fake` を省くと実アダプターが存在しないため fail closed します。公開先は root 内 `vault/qwen-synthetic-evaluation/{board}/`、相対リンク付きノートと PNG、メタデータを一体で公開します。出力先を既存 Board や正本に接続しないでください。状態と時刻は SQLite の `jobs` と `events` に記録します。途中でプロセスが停止した場合、次回は `recovery-needed` となり再生成や受付再開はしません。公開直後に停止した場合も状態と出力を人手で照合してください。失敗画像のリンクは作られません。復旧操作や自動 retry は提供しません。

## 将来のアダプター契約（未実装）

実環境へ接続するには別途実装・レビューが必要です。`fence_and_drain` は Board 以外の直接クライアント・LAN を含む全文章入口と自動投入を封鎖し、既存要求と slot を drain し、未管理入口や GPU 利用者がないことを証明する。`stop_gemma_and_prove_gpu_free` は承認済み GitOps で desired state を変更し、Gemma 停止と GPU 解放を確認する。`start_qwen` と `generate` は隔離されたローカル workload のみを使用する。完了・失敗時とも `stop_qwen_and_prove_gpu_free` を実行し、`restore_gemma_verify` は元の desired state・自動投入、health、短い推論を検証する。その成功後にのみ `reopen` が入口を再開する。初期フェンスまたはGPU解放の証明に失敗した場合は未知のworkloadを停止・復帰せず、`recovery-needed`で後続ジョブを遮断する。いずれかの証明が欠ければ例外を返し封鎖を維持する。プロセス停止時は実状態と履歴を照合し、明示的な復旧が必要であり、未確定の生成を再試行してはならない。呼び出し側の真偽値だけを安全性の証拠として扱ってはならない。

参照検証関数は許可 root 内の相対パス、全コンポーネントの symlink、SHA-256 と PNG を検査する。固定合成ジョブは参照なしであり、実素材を受け付けない。固定契約を拡張して実参照を使用することは今回の対象外。fake アダプターは実際のフェンス、排他、GPU 解放を証明しない。
