# BOXP-506: コハコの家の視覚コンテンツ領域（地図・HTML図表）

## 目的
会話を続けたまま、返答に結び付いた地図や図表を開閉できる領域を kohako-home に加える。

## 構造化された受渡し
- BFF が Hermes へ渡す instructions に、返答末尾へ 1 つまで置ける ```` ```kohako-view ```` JSON ブロックの書式を追加する。
- BFF（`bff/src/views.ts`）がブロックを抜き出して厳格に検証し、本文（吹き出し・読み上げ）から除去して `views` として返す。不正なブロックは捨て、本文から除去する。
- 種類
  - `map`: 目的地の名前・住所（任意で出発地・移動手段）。家側で Google Maps URLs（`https://www.google.com/maps/dir/?api=1&...`、公式・キー不要）を組み立て、外部で開く。
  - `usage`: 数値を持たない。家が既存 `/kohako/api/v1/status`（BOXP-504）の実データで棒グラフを描く（観測時刻・共有/専用・未提供・鮮度を表示）。
  - `html`: モデルが作った HTML。未信頼として `sandbox="allow-scripts"`（allow-same-origin なし）の iframe に srcdoc で表示し、先頭に通信を全部禁じる CSP を置く。

## 地図の制約
- Google Maps の iframe 埋め込みの公式方式は Maps Embed API で、API キー（Google Cloud のプロジェクトと API 契約）が必要。新しい API 契約・課金は承認範囲外のため使わない。
- `google.com/maps` を直接 iframe にするのは X-Frame-Options で拒否され、`output=embed` は非公式なので使わない。
- 代替: 目的地・住所と「Google マップで開く」リンク（Maps URLs）を表示し、開くと目的地（と指定時は出発地）が Google に送られることを明示する。出発地の既定は空（Google 側の現在地）。

## 安全境界
- iframe は opaque origin で親の cookie・storage・API・認証へ届かない。通信・フォーム・ポップアップ・上位遷移を禁止する。親は iframe からのメッセージを受け取らない。
- リンクは `https://www.google.com/maps/...` に限り家側で組み立てる。モデルが書いた URL はそのまま使わない。
- 住所や経路 URL はサーバーログや公開成果物に保存しない。検証には合成の出発地を使う。

## 画面
- 結果カードに「地図を開く」「グラフを開く」「図を開く」を出す。表示領域は PC では右側、スマホでは入力欄の上の下部シートとし、キャラクター・吹き出し・入力・停止・承認を覆わない。閉じるボタンと Esc で閉じる。

## 検証
- 単体: views の抽出と検証（陰性: 不正 JSON、未許可の種類、`javascript:`、長すぎる値）、Maps URL の組み立て、sandbox と CSP の属性。
- 実ブラウザ: PC とスマホで描画と重なりを確認する。悪意ある HTML（親への参照、fetch、top 遷移、cookie）が失敗すること、未認証の拒否、会話・停止・承認・ふれあいの非退行も確認する。
- 配備後: 検証用会話で実 Hermes から地図とグラフを開く。

## rollback
該当 PR を revert し、image-updater で前の image に戻す。
