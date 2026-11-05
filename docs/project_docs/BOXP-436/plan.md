# BOXP-436 両図とサムネイルの定期更新

Owner が承認した `arch scheduled workflow → 既存 task runner → agent 意味監査 → 通常 CI/配備` を実装する。

## 経路

```text
GitHub Actions (1 日 1 回 + 手動)            codex-cron-scheduler (非 agent, 1 時間ごと)
  schedule-infra-diagram-refresh.yml                      infra-diagram-refresh/refresh.bb
  ├ arch + lolice の公開 IaC を正規化           ├ main の watch run と artifact を検証
  ├ 基準 (docs/infra-diagram-refresh) と比較              ├ allowlist の live metadata を収集・比較
  └ 結果を digest と項目で artifact へ   ───▶   ├ 差分 0: 記録だけで終了 (agent 起動なし)
                                               └ 差分/異常: task-board helper で起票か既存票へ集約
                                                    │
                     既存 task-board-runner ◀───────┘ (claim, 予算, 担当, gate は既存のまま)
                       └ agent が根拠を読み意味監査
                          └ infra-diagram-refresh/publish.bb
                             staging で生成 → 検査 → 既存 deploy workflow → 実 URL 照合
                             → 基準更新 PR と vault への昇格
```

## 判断

- **live 収集を CI から分離する。** GitHub-hosted runner に cluster への読取経路はなく、新規資格は承認外。public repo の Actions log と artifact に live 値を載せないためにも、live の比較は scheduler コンテナの既存 kubeconfig で行い、値は私的 vault の外へ出さない。
- **CI から runner への入口は pull。** 新しい受信 API や資格を作らない。intake が既存の `gh` 資格で、main 上の `schedule` か `workflow_dispatch` で動いた run の artifact だけを読む。public repo の issue は誰でも書けるので入力に使わない。artifact は schema を厳格に検査し、自由文を票へ渡さない。
- **起票は既存 helper だけで行う。** 票の本文の marker を正本にして open な票を探すので、state が消えても重複しない。
- **基準を先に進めない。** IaC の基準は配備確認後の通常 PR、live の基準は同じ段階の vault 更新でだけ進む。途中で失敗すれば次回も差分として残る。
- **生成は staging で行う。** vault の正本と配信中の Worker は、検査と配備確認が通るまで置き換えない。
- **普段の揺れを差分にしない。** tag、digest、時刻、PID、Pod 配置、status は比較対象から除く。

## 収集失敗の扱い

- 取得できなかった section は「消えた」と扱わない。基準の行を残して比較し、異常として報告する。
- 基準から項目が 30% を超えて減る、または 5 件以上あった種類が丸ごと消える場合は、収集異常として扱う。解析できない manifest がある場合も同じ。
- 異常は agent へ渡すが、基準は進めない。同じ内容の再起票は 2 回までとし、超えたら Backlog の通知カードに切り替える。

## 公開境界

自動処理が変更しないもの: architecture の Access 保護、portfolio 本番切替、元インフラ、モデル設定。新しい公開要素や範囲が必要なら、票を Blocked にして Owner へ相談する。

## 実装の順序

1. arch PR: 正規化比較、workflow、intake、refresh、テスト。
2. image 更新の lolice PR (既存 sidecar の image 更新のみ)。
3. vault に基準、job、日本語の運用入口を配置。
4. canary は架空の構成を使わない。基準を配信中の図の生成時点 (arch d78cbfe, lolice c173da0) に置くと、その後に入った実際の変更 (Langfuse の OIDC など 8 件) が実差分になる。これを workflow → refresh → runner → 意味監査 → 実配備 → 実 URL に通す。
5. 故障試験: 無差分、構成差分、新分類、収集失敗、重複 tick、runner 再起動、監査失敗、render/CI/配備失敗。
6. 実 schedule の 1 回を観測し、運用入口へ記録。

## 435 との調整

サムネイル配備は merge 済みの arch#14490 の stage 構成を使う。同じ deploy workflow が動いている間は配備を始めない。vault の正本が staging 後に変わっていたら promote を止める。
