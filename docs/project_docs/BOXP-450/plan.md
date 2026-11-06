# BOXP-450: ゲート失敗予算を ticket pool に統一

- BOXP-448 の実 PR 登録・重複排除・他票所有と Owner 除外、旧 grant の下限および ticket の追加 grant を維持する。
- precheck、予約時の再確認、失敗後、再起動後の停止、CLI と通知を ticket pool のみで判定する。同一 PR の別 ticket 同時実行排他は維持する。
- PR の失敗数、旧上限、grant、イベントは監査に残す。CLI の PR `:exhausted?` は false、`:legacy-limit-reached?` は旧上限到達を示す。PR grant は ticket に加算しない。
- 実 PR 2 件で PR 10/10 超でも継続、ticket 枯渇で停止、旧 ledger・grant・成功後・同 run 再処理、並行予約と停止/grant の競合、再起動、短期 retry・CI/review gate を回帰検証する。
- CI と独立レビューの後に親担当が merge、runner 配備、稼働 SHA と CLI の readback および元票の復帰を判断する。
