# BOXP-617: lolice architecture の Kohako Studio 収録不足と定期更新の見逃しの是正

## 問題
- 全体図は Studio を G2 と同じ「Kohako / even-g2」に束ねていた。日常のメイン画面である家 (kohako-home.b0xp.io) の入口と責務が読めなかった。
- 定期更新は資源の増減しか事実にしていなかった。そのため、既存の NetworkPolicy への許可先の追加や、env に書く接続先 URL の追加 (例: BOXP-504 で家の状態表示から codex-workspace への接続を追加) が差分にならなかった。
- kohako-home の hostname は BOXP-509 で差分として届いた。しかし「Studio と同じ Service の別 hostname」と監査されて、独立した要素にならなかった。

## 方針
1. `iac_facts.bb` は、NetworkPolicy の通信相手 (`lolice:netpol:*`) と、クラスタ内 Service の DNS 参照 (`*:svc-ref:*`) も事実として集める。
2. `rules.edn` の必須表記に「Kohako の家」と `kohako-home.b0xp.io` を加え、家を図から消した版は配備されないようにする。
3. README の図の規則に、入口や責務が違う画面は同じ Service でも書き分けることを明記する。
4. 両図 (vault の正本) で、家 / Studio を G2 と別のノードにし、状態表示・通知・TokenReview の接続とフロー「コハコの家で話す」を足す。
5. 基準には、今回監査した Kohako 関係の接続事実 32 件だけを入れる。残りの接続事実 165 件は、次の定期チェックが差分として起票し、通常の監査で扱う。

## 検証
- lolice の BOXP-504 の前後で比べると、旧ロジックは no-change、新ロジックは changed (+2 netpol) になる。
- `publish.bb build` は、lineage 80/80、全体図 83/83 の検査を通る。
- 配備後に両図の公開 URL の hash が build と一致することを確かめ、定期 workflow の結果を確認する。

## レビュー指摘への対応

- NetworkPolicy の事実に policy の対象 Pod (`[<対象>]`) を含め、対象の変更も差分にする。
- Kubernetes の LabelSelector は matchLabels に加えて matchExpressions も表し、式だけの selector を「全部」と同じ事実にしない。
- 基準の監査済み netpol 事実 24 件は同じ通信を新しい形式へ置き換えただけで、未監査の事実は加えない (現行 lolice で added 165 / removed 0 のまま)。
