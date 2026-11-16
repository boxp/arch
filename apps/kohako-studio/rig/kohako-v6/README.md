# v6 作成手順

`create_parts.py` は `/tmp/boxp441/v5b/layout/` を入力とし、`/tmp/boxp441/v6/layout/` に素材を作る。画像生成は行わない。psd2live の headless MCP と Python クライアントを v5 と同様に起動し、`/tmp/boxp441/v6/` にこれらのスクリプトと `mcp_proxy.py` を配置する。

実行順は `build.py`（legacy-standard、髪物理・クリップ）→ `opacity.py` → `iris.py` → `mid.py` → `mouth.py` → `mouth_open.py` → `finalize.py`。各操作は `PSD2LIVE_MCP_TOKEN` とローカル MCP を使用する。最後に CLI の `export ... --target p2lrt` で出力する。保存後のリグの目・口には素材以外に明示的な不透明度キーがあるため、素材と manifest だけで v6 を再現することはできない。

評価上の未解決点は、半開き時の口の上下線の分離。`REPORT.md`（作業成果物）も参照。
