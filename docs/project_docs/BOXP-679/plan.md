# BOXP-679: 読書実習用の本人専用ブラウザ VS Code・Lean 環境

## 目的

本『コンパイラ証明技法』のコード（サポート repo y-taka-23/lean-verified-compiler）を、
スマホを含むブラウザから再現しながら読める本人専用の永続環境を用意する。

## 方式の比較と選定

| 候補 | 評価 |
| --- | --- |
| code-server（Coder） | 採用。公式 image（amd64/arm64）、Open VSX から Lean 4 拡張（leanprover.lean4）が入る、`--auth none` で外側の認証に任せられる、スマホ/PWA の利用実績が多い、`--disable-proxy` などで機能を絞れる |
| OpenVSCode Server（Gitpod） | 同等に動くが、スマホ向けの調整や運用の選択肢が少ない。差は小さいので一般的な方を選んだ |
| live.lean-lang.org 等の Web エディタ | 永続ワークスペースや lake build、本の repo 全体の再現ができない |
| codex-workspace に相乗り | 秘密情報・vault・runner がある環境なので、本人の読書用端末にはしない（権限を限定する要件に反する） |

## 構成

- 入口: `https://lean-reading.b0xp.io`。Cloudflare Access（Owner の email ＋ 既存 GitHub IdP のログイン必須、kohako-studio と同じ方式。WARP 不要）。tunnel の ingress でも Access JWT（AUD）を検証。
- boxp/arch `terraform/cloudflare/b0xp.io/lean-reading/`: Access application/policy、専用 tunnel、DNS（Access と ingress の後に作成）、tunnel token を SSM `lean-reading-tunnel-token` へ。
- boxp/lolice `argoproj/lean-reading/`: namespace、cloudflared、code-server（4.146.0、digest 固定）、Longhorn PVC 20Gi（/home/coder）、Calico NetworkPolicy。
- 初期化（initContainer `seed/seed.sh`）: elan v4.4.0（sha256 検証）、`leanprover/lean4:v4.35.0`（本の lean-toolchain と同じ）、Lean 拡張 0.0.243、本の repo の clone、練習用 Lake プロジェクトと案内の雛形。既存ファイルは上書きしない。
- 権限の限定: code-server Pod に Secret・ServiceAccount token・vault を mount しない。ingress は cloudflared と検証用 codex-workspace のみ、egress は DNS とクラスタ外 HTTPS のみ。

## 練習用と完成コードの区別

- `~/workspace/lean-verified-compiler/`: 本の完成コード（参照用）。
- `~/workspace/practice/`: 本人が書く場所。InfoView 確認用の本とは無関係な小さな例だけを置き、演習の答えは入れない。

## 検証の区別

- 自動試験: terraform validate、kustomize build と policy、seed.sh を手元で実行（v4.35.0 で練習用と本のコードが build、#eval 結果、再実行で既存ファイルを保持）。
- 実ブラウザ: 配備後に codex-workspace から Service へ直接つなぎ、headless Chromium（PC 幅とスマホ幅）で編集と InfoView（型・評価結果・ゴール）を確認。Access を通した経路は未認証で Access のログインへ転送されることだけを確認できる。
- 本人端末: 本人の GitHub ログインとスマホ実機での確認は本人受入として残る。

## Lean 形式モデル

状態や順序の規則を持たない設定と配備の変更なので、仕様→Lean モデルの手順は適用しない（Projects/lean-spec-driven-testing/standard.md の適用外: 設定・文書のみ）。

## 配備順

1. arch PR を merge → tfaction apply（SSM の tunnel token が先にできる）。
2. lolice PR を merge → Argo CD が同期。
3. 実ブラウザ検証 → Obsidian の現行設計と平易な入口へ納品。
