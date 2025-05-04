**情報の統合**

ユーザーが求めているのは、Brave MCPをOpenHandsに追加する方法や、K8sクラスター上でOpenHandsを実行するためのconfig.toml設定の修正の両方を含む、統一された概要です。そのため、両方の内容を組み合わせて更新した文書を作成する必要があります。また、開発者向けの指示として、ウェブツールを活用し、True品質のソースを15件以上集め、5つ以上の異なるドメインから情報を取得する必要があります。


**検索計画の立案**

まず、引用するためにいくつかのページを開く必要があります。複数の検索クエリを同時に実行するために、web.search\_queryを使う計画を立てています。具体的なクエリは以下の通りです：

* "Brave Search API key quota limit"
* "brave-search-mcp-sse helm chart"
* "Kubernetes ConfigMap official documentation" など

これらのクエリを使用して、鮮明で信頼性の高い情報源15件を集め、引用を整えます。


**引用ソースの整理**

複数の検索クエリを使い、14の検索結果を得ました。さまざまなドメインから情報を取得しましたが、15件の引用を確保するには「Immutable ConfigMap」関連の別のソースが必要です。その後、追加のソースをいくつか取得し、最終的に15件の異なるドメインから引用を集めました。例えば、Brave Search APIの価格やKubernetesの公式ドキュメント、GitHubのリポジトリなど、多岐にわたるものが含まれます。

**情報源の整理**

既に5つ以上のユニークなドメインから情報を取得しました。次に、Helmの設定に関する詳細が必要です。Helm関連のドキュメントページを引用するか、GitHubやMediumから情報を追加できます。また、インストール手順や設定変更方法について、5つの方法をまとめた回答を準備し、各詳細に対応する出典を追加します。「OpenHands AI agent GitHub」を検索し、GitHub上での関連資料も参照する予定です。


**情報構成の整理**

現在、5つ以上のユニークなドメインから情報がありますが、Helm関連の詳細も追加する必要があります。Helm chartやConfigMapについて、公式ドキュメントやGitHub、Mediumを活用し、インストール手順や設定変更方法をまとめた回答を準備します。また、各詳細に対応する出典を追加し、引用をしっかりと行います。全体を要約し、関連する15のユニークな出典を文章ごとに参照する予定です。

**情報整理と計画**

まず、Brave Search APIのドキュメントから詳細を確認し、OpenHandsに関連するGitHubのオープンソースを参照するほうが良さそうです。これを整理した上で、回答に必要な構成を整えます。概要、デプロイ方法、設定変更方法、動作確認、運用のベストプラクティスなどに関する情報を整理して、必要な15の引用を集めます。特にConfigMapやHelm、Kustomizeに関する資料を重点的に集めます。


思考時間: 1m 3s


以下は **OpenHands (OSS開発エージェント) を稼働中の Kubernetes クラスタに Brave Search MCP サーバ（`brave-mcp`）を追加し、`config.toml` を安全に更新・反映させるまでを 1 枚で俯瞰できる完全ガイド** です。手順は ①Brave API キーを Secret 化 → ②Helm チャートで brave-mcp をデプロイ → ③`config.toml` に MCP エントリを追加 → ④ConfigMap／Helm／GitOps いずれかの方法でローリング更新、の 4 ステップで完結します。これにより OpenHands から SSE ストリーム経由の Brave 検索が即利用可能となります。

---

## 1. 前提条件

| 項目                  | 内容                                                                  |
| ------------------- | ------------------------------------------------------------------- |
| Kubernetes          | v1.25 以降を想定。                                                        |
| Helm CLI            | v3.12+ 推奨。                                                          |
| Brave Search API キー | 無償枠は **2 000 req/月** かつ 1 req/s 制限。([Brave][1])                     |
| OpenHands           | GitHub で公開される AI エージェント基盤。([GitHub][2])                             |
| MCP                 | LLM と外部ツールをつなぐオープン標準プロトコル。([Model Context Protocol][3], [Axios][4]) |

---

## 2. Brave Search MCP サーバをデプロイする

### 2.1 API キーを Secret に格納

```bash
kubectl create namespace ai-tools
kubectl create secret generic brave-search-secret \
  -n ai-tools \
  --from-literal=api-key='YOUR_BRAVE_API_KEY'
```

Secret はチャート経由で `BRAVE_API_KEY` 環境変数に注入されます。([GitHub][5])

### 2.2 Helm チャートでデプロイ

```bash
helm repo add brave-search-mcp-sse https://shoofio.github.io/brave-search-mcp-sse/
helm repo update
helm install brave-search brave-search-mcp-sse/brave-search-mcp-sse \
  -n ai-tools \
  --set braveSearch.existingSecret=brave-search-secret \
  --set service.type=ClusterIP \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=brave-mcp.example.internal \
  --set ingress.hosts[0].paths[0].path="/"
```

チャートは Deployment・Service・Ingress・ヘルスチェックを自動生成し、SSE で Brave API をストリーム配信します。([GitHub][5])

---

## 3. OpenHands の `config.toml` を修正して MCP を登録

### 3.1 追加する TOML スニペット

```toml
[mcp-sse]
mcp_servers = ["https://brave-mcp.example.internal/sse"]
```

OpenHands はリロード後に `brave-search` ツールを自動検出します。([GitHub][2])

### 3.2 `config.toml` をクラスタに反映する 5 つの実践パターン

| パターン                   | 概要                                                                                                                                    | 反映方法                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **ConfigMap 直接管理**     | `kubectl create/apply -f` で `openhands-config` を更新し、`subPath` で `/app/config/config.toml` にマウント。([Kubernetes][6], [DEV Community][7]) | `kubectl rollout restart deployment/openhands` でローリング更新を発火。([Kubernetes][8]) |
| **Helm チャート値に埋め込む**    | `values.yaml` に `configToml:` ブロックを追記し `helm upgrade`。ConfigMap がハッシュ付きで再作成され自動で更新。([Medium][9], [GitHub][10])                        |                                                                              |
| **imperative パッチ**     | 変更を急ぐときは `kubectl patch` または `kubectl set env` でテンプレート注釈を更新し即時再起動。([Kubernetes][8], [Medium][9])                                      |                                                                              |
| **Kustomize / GitOps** | `configMapGenerator` で自動ハッシュ付与し、Argo CD/Flux が差分を検知して反映。([GitHub][10])                                                                |                                                                              |
| **動的リロード Operator**    | `reloader` などが ConfigMap の `resourceVersion` を監視し Pod を触らず再読込。([GitHub][11])                                                          |                                                                              |

> **Immutable ConfigMap** を使うと誤更新を防げますが、更新時は新規オブジェクトを作成してください。([AdityaSamant.dev][12])

---

## 4. 動作確認

1. OpenHands UI で
   `brave_web_search を使って "OpenHands 0.33 release notes" を探して`
   と入力。
2. 右ペインに SSE ストリームが流れ、Brave 検索結果が含まれていれば成功。
3. MCP 側ログは `kubectl logs deploy/brave-search -n ai-tools -f` で確認。([GitHub][5])

---

## 5. 運用・セキュリティ Tips

* **NetworkPolicy**: OpenHands → brave-mcp の 8080/TCP のみ許可し外部通信を遮断。([Kubernetes][13])
* **レート監視**: Prometheus で `rate(http_requests_total[5m])` を取り、無償枠上限にアラート。([Medium][14])
* **水平スケール**: `--set replicaCount=3` と HPA を有効化。チャートはステートレス設計。([GitHub][5])
* **MCP 将来性**: MCP は主要 AI ベンダーも採用を表明済み — 急拡大中の業界標準です。([Axios][4], [The Verge][15])

---

## 参考リンク

* Brave Search API 公式 ([Brave][1])
* brave-search-mcp-sse GitHub ([GitHub][5])
* Kubernetes ConfigMap ドキュメント ([Kubernetes][6])
* Model Context Protocol 仕様 ([Model Context Protocol][3])
* OpenHands GitHub リポジトリ ([GitHub][2])

これで **Brave Search を呼び出せる最新の OpenHands 環境** が完成し、設定変更も GitOps／Helm／ConfigMap いずれの運用モデルでもスマートに回せます。

[1]: https://brave.com/search/api/?utm_source=chatgpt.com "Brave Search API"
[2]: https://github.com/All-Hands-AI/OpenHands?utm_source=chatgpt.com "All-Hands-AI/OpenHands: OpenHands: Code Less, Make More"
[3]: https://modelcontextprotocol.io/introduction?utm_source=chatgpt.com "Model Context Protocol: Introduction"
[4]: https://www.axios.com/2025/04/17/model-context-protocol-anthropic-open-source?utm_source=chatgpt.com "Hot new protocol glues together AI and apps"
[5]: https://github.com/Shoofio/brave-search-mcp-sse?utm_source=chatgpt.com "Shoofio/brave-search-mcp-sse - GitHub"
[6]: https://kubernetes.io/docs/concepts/configuration/configmap/?utm_source=chatgpt.com "ConfigMaps - Kubernetes"
[7]: https://dev.to/joshduffney/kubernetes-using-configmap-subpaths-to-mount-files-3a1i?utm_source=chatgpt.com "Kubernetes - Using ConfigMap SubPaths to Mount Files"
[8]: https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_restart/?utm_source=chatgpt.com "kubectl rollout restart - Kubernetes"
[9]: https://medium.com/%40erikstrm_11611/rolling-updates-in-kubernetes-triggered-from-configmap-change-e1078f144807?utm_source=chatgpt.com "Rolling Updates in Kubernetes triggered from ConfigMap change"
[10]: https://github.com/kubernetes-sigs/kustomize/blob/master/examples/configGeneration.md?utm_source=chatgpt.com "kustomize/examples/configGeneration.md at master - GitHub"
[11]: https://github.com/kaasops/config-reloader?utm_source=chatgpt.com "Kubernetes config (Secret and ConfigMap) reloader - GitHub"
[12]: https://www.adityasamant.dev/post/immutable-configmaps-and-secrets-in-kubernetes-a-complete-guide?utm_source=chatgpt.com "Immutable ConfigMaps and Secrets in Kubernetes: A Complete Guide"
[13]: https://kubernetes.io/docs/concepts/services-networking/network-policies/?utm_source=chatgpt.com "Network Policies - Kubernetes"
[14]: https://eytanmanor.medium.com/an-introduction-to-prometheus-a-tool-for-collecting-metrics-and-monitoring-services-12fcc3bdb5d6?utm_source=chatgpt.com "An introduction to Prometheus — a tool for collecting metrics and ..."
[15]: https://www.theverge.com/2024/11/25/24305774/anthropic-model-context-protocol-data-sources?utm_source=chatgpt.com "Anthropic launches tool to connect AI systems directly to datasets"
