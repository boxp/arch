# 検証記録

合成fixtureによる13試験で日付・方向・列車・設備、凡例とノビノビ除外、案内不可/欠損/HTMLエラー、ツイン料金文、重複継続/満席復帰/再空席、再起動、partial fail、検索別障害抑制、期限、排他、旧履歴移行と配送未確認journalを確認した。月日を部分一致させる不具合は、異なる月のfixtureを追加して失敗を再現した後、日付セルの数値比較へ修正した。

実行: `python3 -m unittest discover -s tests/sunrise -v`。activeな監視のmainでも正常時と再起動後のstdoutが空で、同じ空席が続く場合も再通知しない。期限終了とlock競合でもstdoutは空。

公式の4検索種別×往復を各1回、GETのみで取得した。8件ともHTTP 200、そのうち6件は日付・方向・列車・出発時刻・設備分類のDOM照合が成功し、14設備が残席なしだった。2件は公式の混雑案内で、4設備をunknownとした。ツインの実結果表は未取得であり、合成試験の成功を実サイトの全件安定取得とは扱わない。保存HTMLを親担当でも再判定した。公式入口のJavaScriptの列車種別mappingも照合した。実日程・URL・HTML・移行候補はprivateで保管する。

Python標準HTMLParserを採用し、実行時の追加依存とLLM呼出しはない。Hermes現物のno_agent経路はLLM import前に分岐し、空stdoutをsilent成功として処理する。ただし、これは本番切替後の実tickの証拠ではない。正規配備、既存job切替、最新state移行、実tick確認はレビュー/CI後の工程として残っている。

`actionlint` と `ghalint run` は成功。全体の `trivy config` はchecks更新待ちが継続したため中断し、既存キャッシュのchecks（bundle取得日: 2026-10-16）で全体走査を完了した。既存設定には指摘があり、Hermes DockerfileではUSER未指定(HIGH)とHEALTHCHECK未指定(LOW)を報告している。今回のCOPY/chmod追加でこれらの設定は変更していない。最新checksを取得できたという意味での成功とは扱わない。
