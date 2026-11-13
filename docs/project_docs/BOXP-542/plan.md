# BOXP-542 vault画像を家の会話へ表示

Owner訂正（TODO rev 7b1c54b5d807）に合わせ、3枚専用ではなくコハコが選んだvault画像を会話の吹き出し・履歴・通知本文に表示する。

- 家の既存Cloudflare Access Owner認証を維持する。verifier/notifier/未認証にはvault画像を返さない。
- コハコは `![説明](kohako-vault:URLエンコードしたvault相対パス)` を返す。画面はこの専用記法だけを同一originの認証付き画像URLへ変換する。外部画像・任意ローカルパス・data URLは表示しない。
- BFFから既存のサーバー間Bearer認証でHermesへ取得依頼する。Hermes側は設定済OBSIDIAN_VAULT_PATH内の通常ファイルのみを開き、各階層のsymlink・隠しパス・絶対パス・親参照を拒否する。openat/O_NOFOLLOWで競合時の境界も維持する。
- 対応はPNG/JPEG/GIF/WebP、各5MiBまで。拡張子とsignatureを照合。SVG/HTML/PDF/動画等はインライン表示対象外。取得失敗・削除時は画像を表示できない旨を明示。保存用コピー・公開URL・認証解除なし。
- 既存3案は成果物としてvaultへ配置（検証メディアではない）。生成APIは呼ばない。検証スクリーンショット等はvault外に保存する。
- Python境界テスト、BFF認可/上限/エラーテスト、Markdown専用記法テスト、ブラウザで3画像の実decodeを確認。PRレビュー/CI後に通常画像ビルド・GitOps配備し本番認証経路で再確認する。

調査委譲: 正規delegate.pyの読取調査結果を親が現行実装と照合。旧worktreeの1000字本文制限という報告は現行では24000字（lastExchangeのみ1000字）であり訂正済。

## ローカル検証結果

- BFF型検査・89テスト、Web型検査・289テスト・production build、Python2テスト成功。
- `codex review --uncommitted`: 明確な不具合指摘なし（P0/P1なし）。
- PlaywrightのローカルBFF + Hermes transport mockでPC/幅412pxの双方に実際の既存3画像を表示し、各896x1200のdecodeを確認。欠落画像のエラー表示、外部画像通信0件、未認証401・verifier403も確認。
- 成果物3JPEGは `attachments/BOXP-542/` へ配置しHermes vaultへ同期済み。再生成なし。検証画像は `/home/boxp/verification-artifacts/BOXP-542/vault-display-local/`。
- 本番は未配備・本人表示未確認。PRのCI/review gate後に通常配備し同一の3画像を家会話へ再提示するまでTD-01は未完了。
