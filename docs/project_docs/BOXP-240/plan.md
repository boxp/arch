# BOXP-240 実装計画

## 目的

SD.Next IPEX イメージで必須の組込み submodule `extensions-builtin/sdnq` が未取得のままになる問題を、固定済み SD.Next 親コミットの gitlink に従って修復する。

## 根拠

- SD.Next の固定親コミットは `b7dcb0ce870181a40d1246fde1febbff5593a750`。
- GitHub API で当該親ツリーの gitlink が `extensions-builtin/sdnq` → `8aa3dace09237873bbb0ed8ca89e6a81a754da85` であることを確認した。
- 同じ親コミットの `installer.py` の `sdnq_target` も `8aa3dace09237873bbb0ed8ca89e6a81a754da85` であり、`register_sdnq()` は `src/sdnq/__init__.py` を無条件で読み込む。

## 変更方針

1. 既存の大きな installer 実行レイヤーの後に、小さな `RUN` レイヤーを追加する。
2. 固定親コミットであることを検証し、親ツリーの gitlink から期待する `sdnq` コミットを取得する。
3. `extensions-builtin/sdnq` だけを `git submodule update --init --checkout` で取得し、gitlink・HEAD・必須の `__init__.py` を検証する。

## 非対象

- 他の submodule の取得
- torch または依存関係の更新
- installer の挙動変更
- 終了コード 139 の許容範囲変更

## 検証と反映

隔離cloneで対象submoduleの固定commit/必須ファイルを検証し、PR build・コードレビュー・CI後に通常mergeする。main publishとImageUpdaterの固定digest更新を確認する。GPU試験は元のLLM復旧確認後に改めてアイドルを確認して既存切替workflowで実施する。offline設定を一時適用し既存モデルから画像を生成、終了後SD/cloudflaredを停止してLLM Ready/health/短い推論と元configのbyte一致を確認する。実測正本はObsidianのProjects/BOXP-236/sdnext-ipex-gpu-verification.md。
