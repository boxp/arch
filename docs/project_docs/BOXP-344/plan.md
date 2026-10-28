# BOXP-344 合成評価の実装計画と状況

合成設定1件・合成小説1件・各1枚の隔離評価。正本/既存作品/通常Boardは変更しない。外部画像API fallback、新credential/RBAC、強制kill/lock解除なし。

1. 共通arbiter、永続契約・状態、冪等性、参照/PNG検証、非上書きの専用ノート公開を実装する。
2. fake統合で両Board同時投入・timeout/OOM・再起動・不正参照・出力重複・復帰失敗を検証する。
3. loliceに全Service共通の受付gate、raw APIのloopback化、読取専用のdrain観測と固定復帰probeを準備する。
4. 独立レビューとCI後にGitOps配備/readbackする。限定実機controllerは各段階をPRとして提出し、全入口封鎖・loaded slots idle・GPU FD・Pod UIDを実確認してから進む。
5. 2件を1回のGPU切替で生成し、成功/失敗ともQwen停止/GPU解放→Gemma復帰/短文推論→受付再開を確認する。実PNGとリンクを目視しvaultのboard-pilot.mdへ記録する。

実装・試験と実機証拠は分けて記録する。fakeを実画像2枚として扱わず、未確認が残れば完了としない。
