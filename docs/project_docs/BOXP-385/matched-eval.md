# 固定課題の有限matched eval（2026-11-03）

実モデルを呼び出した公開合成2課題で、取得した同一referenceの24重複を1件へ減らす変更だけを比較した。個人本文・実会話は使わず、raw返答・reasoning・tool引数結果は保存しない。固定課題は再現用コードにあり、既存業務promptを収集したものではない。

| CLI route（要求モデル） | 適合 前→後 | 総token 前→後 | 削減 | 合計wall時間 前→後 |
|---|---:|---:|---:|---:|
| Codex / gpt-6.1-sol | 2/2→2/2 | 40,744→39,092 | 4.1% | 10.200→10.768秒 |
| Claude / claude-fable-5-1 | 2/2→2/2 | 2,756→1,376 | 50.1% | 7.742→9.357秒 |

全8件は同じJSON正解に適合した。失敗・中断は0件で、発生時は判明した消費とunknown状態を残して即停止する設計（timeout/CLI異常の消費は取得不能のことがある）。上の分母は固定課題適合件数であり、実作業の受入・Owner救援なし完了ではない。成功した合成課題1件あたりtokenはSol 20,372→19,546、Fable 1,378→688。失敗時も同variant総消費の分子から除かない。

入力された取得資料は各課題24→1レコード、2課題合計入力bytesは4,572→616（86.5%減）。これはCLI内部のsystem/tool contextを含まない。Solのcache-readは前0、後は1課題7,168/もう1課題0で、cache状態を揃えた試験ではない。前後で初期contextの変動もある。SolとClaudeでは初期harness量・tokenizer・cache定義が違い、Fableのtokenが少ないことをモデル固有の効率・実作業の品質の優劣とはしない。順序は課題ごとにrouteを交互にしたが、variantはbefore→afterの順。反復1回/層2件で、時間差はノイズも含む。**時間の改善は観測していない。**

Codexのinputはcache内数込み、outputはreasoning内数込みなのでinput+outputだけをtotalとする。Claudeはinput・cache-read・cache-creationが別枠なのでそれらとoutputを足す。今回未保持/未取得のcache-write/reasoningやTTFTはnull。初回evalのdecoderはCodexの任意の詳細内数を保持しなかったため、nullをproviderが未提供だった証拠とはしない。再現用decoderは公式usage keyがある場合に保持するよう対応したが、予算を守るため実LLM evalの追加実行はしない。API価格換算・請求額・subscription枯渇予測は行わない。要求modelとeffortは記録したがprovider側返却modelの照合は未実施のためobserved_modelはnull。CLI版はCodex 0.166.0 / Claude Code 2.1.316。

## 上限と改善自身の使用量

evalは最大8呼出し、eval内同時1、retry0、各call timeout120秒、開始前の時間チェック600秒、開始前の観測tokenチェック100,000。時間/tokenチェックは実行中callを打ち切る厳密quotaではない。今回は8件・83,968 tokenで完走した。課金APIへのfallbackはせずsubscription CLIを使った。実行時は親・調査子・evalが重なり、全体の最大同時数は3。次batchは調査を終えてからevalを直列実行し全体1に抑える。

調査子のCLI実値はinput 1,218,009（うちcached 1,153,280）、output 12,261、total 1,230,270。evalを合わせた既知使用量は**1,314,238 token以上**。親の全呼出し・後続reviewは別で、改善全体の総量はunknown。重複除去で得た合成課題4件分の差3,032 tokenをこの改善コストに対する純益とは報告しない。次の上位無駄候補は、調査子へ渡す長い既存文書とtool結果の反復である。先に機械抽出し固定keyだけを読ませる変更を1件に絞る。

新しいbatchは自動開始しない。次batch案は全体同時1・追加call最大8・retry0・review最大1、総量は調査/review込みで観測し、unknownや上限超過時は次callを止める。公式window観測が15分超古い/expired/unknown、必須運用予備を下回る、P0/P1、安全境界逸脱、品質低下が1件でも出たら停止する。windowの予備率20%・消費速度予測は暫定案で、実運用への自動適用はしていない。

## 再現

```sh
# 明示実行時だけ最大8回のsubscription呼出し。出力は数値metadataのみ。
python3 scripts/ai-observability-matched-eval.py --execute --out /tmp/boxp385-matched-eval.json
```

`matched-eval-2026-11-03.json`に今回の数値証跡を保存した。結果はlive状態とcacheにより変わる。本番のretrieval実装やroutingへこの合成変更を自動適用したわけではない。通常PR/gate後も独立offlineツールであり、runner/Hermes再起動・新サーバ・scheduler増設を必要としない。

## 最終検証

unit testはHermes用2件を加えて計6件成功。custom Codex reviewは最初sandbox起動不能で読取り未実施（107,683 token）、差分/ノートの直接入力方式へ切替えた実reviewはP0/P1なし（36,056 token）。P2は非blockingとして記録し、失敗時の消費保持は判明分のみ、未取得はunknownであることを本文で明確にした。review後に追加したHermes読取りadapterは親が確認し、通常PR gateで全差分を再確認する。既知の改善使用量下限は **1,457,977 token**、親全体は未確定。これは初期下限1,314,238に両review分を足した更新値である。
