# Task Board の Terra 委任契約

高コスト親（codex-sol/full/astra と reasoning suffix、fable、claude-fable/opus）は、生成promptに示す `python3 /opt/codex-workspace/task-board/delegate.py run` へ子タスクを標準入力で渡す。子は現在の作業ディレクトリを継承する。既定モデルは `gpt-6.1-terra`、明示 `CODEX_TASK_BOARD_MODEL` は維持する。Sonnetなど独自の担当方針は維持する。

helperは既存のChatGPT認証を使い、OpenAI providerとChatGPT loginを明示してAPI key環境変数を除去する。新規鍵・API fallbackは使わない。親と同じrunner process group内で一度だけ子CLIを起動し、30秒ごとに生存ログを出す。子には再帰委任を禁止し、1800秒でtimeoutとする。

子CLIの終了コード、JSONのthread.started/turn.completed/失敗イベント、thread IDに対応する保存sessionのID・全turn_contextモデル・task_completeを照合する。runnerも成功受理前に再検証する。証拠欠落、利用不能、異常終了、モデル不一致は成功にしない。失敗後の再実行や免除への切替もhelperは受け付けない。通常の計画停止・idle再試行は従来のライフサイクルを維持する。

全体が小作業、共有文脈、追加権限、最終判断、親の全推論を要する場合は `exempt <reason>` で限定理由を記録する。免除は親の自己申告であり、委任の実行証拠とは区別する。証拠ファイルやsessionは同じUIDから変更可能なので、これは協調するagentの欠落・異常を検知する契約であり、悪意ある改ざんを防ぐセキュリティ境界ではない。実行モデルのmetadata確認は作業内容の正しさを保証しない。

名前付きterra_workerはCLI0.164.0で登録引数を明示してもhosted collaborationから unavailable を返した。config/readで同じ設定の受理は確認したが、別プロセスの観測でありサーバ内部の原因は未確定。正式な契約は対応済みのモデル明示CLIであり、名前付きroleの成功とは扱わない。最低CLI版は未確定。保存session形式が変われば保守的に失敗する。

通常の子はrunnerのgroup終了処理で回収する。timeout時の/procによる子孫回収はスナップショットであり、自らgroupを離脱する任意のプロセスまで保証しない。既存稼働runの強制killやlock削除は行わない。問題時は通常PRで本変更をrevertし、正規image updater/Argo CD経路で配備する。
