# v23 髪の分割

後ろ髪と左右の横髪を肩線で分割し、上部は頭に追従、下部は体に留めます。`V23_Y0` / `V23_Y1` で分割範囲を指定でき、既定値は 365 / 425、境界は 15px でぼかします。

`capture.py TAG` は9ポーズと inspect JSON を出力します。`band.py PROJECT TAG` は `project_open` 後に肩周辺を描画します。`zoom.py` と `make_compare.py` は比較 JPEG を作ります。描画は物理シミュレーションなしの静止ポーズで、画像生成は使用しません。
