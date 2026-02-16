# AIエージェントを作る

以下のようなエージェントを作りたい

- 愛玩・日常的な用途の汎用エージェント
- vrmモデルを使った3dモデルを持っており、three.jsを使ってアバターの姿をweb画面で確認できる。またチャット・音声入力・アバターへのタッチによってインタラクションが可能
- mcpサーバー連携が可能
- k8sクラスター上でホスティング可能

## 技術スタック

- **MCPクライアントSDKの利用**: AIエージェントがMCP（Model Context Protocol）を活用するために、MCPクライアントSDKを使用する。
- **ClojureScriptとShadow CLJSの採用**: TypeScriptの代替として、ClojureScriptとShadow CLJSを使用してフロントエンドを開発する。
- **Redisによるコンテキストのバックエンド管理**: ユーザーセッションやコンテキスト情報をバックエンドで保持し、Kubernetes上で冗長化されたRedisを利用する。

**1. フロントエンド:**

- **ClojureScript + Shadow CLJS**: ClojureScriptはClojureの方言であり、JavaScriptにコンパイルされる言語です。Shadow CLJSは、ClojureScriptのビルドツールで、npmパッケージとの統合やモジュール管理を容易にします。これにより、Three.jsなどのJavaScriptライブラリをClojureScriptから利用できます。

- **Three.js**: VRM形式の3DアバターをWeb上で表示・操作するためのJavaScriptライブラリです。Shadow CLJSを介してClojureScriptから利用可能です。

- **Reagent**: ClojureScript向けのReactラッパーで、ReactコンポーネントをClojureScriptで記述できます。Three.jsとの組み合わせで、3Dアバターの表示や操作を効率的に実装できます。

- **音声入力・出力:**
  - **Web Speech API**: ブラウザ内で音声認識と音声合成を行うためのAPIです。ClojureScriptからも利用可能です。
  - **Microsoft Azure Speech SDK**: 高精度な音声認識と合成を提供し、多言語対応も可能です。ClojureScriptからJavaScriptインターフェースを介して利用できます。

**2. バックエンド:**

- **Node.js**: サーバーサイドのロジックを実装するためのJavaScriptランタイムです。ClojureScriptはNode.js環境でも動作するため、バックエンドの一部をClojureScriptで実装することも可能です。

- **Express.js**: Node.js上で動作する軽量なWebアプリケーションフレームワークで、APIの構築に適しています。

- **MCPクライアントSDK**: AIエージェントがMCPサーバーと通信するためのSDKです。TypeScript版が公式に提供されていますが、ClojureScriptから利用する場合、以下の方法が考えられます。
  - **ClojureScriptからのJavaScript利用**: Shadow CLJSを使用して、TypeScriptで提供されているMCPクライアントSDKを直接利用します。Shadow CLJSはnpmパッケージとの統合が容易であるため、TypeScript製のSDKもClojureScriptから呼び出すことが可能です。

- **Redisによるコンテキスト管理**: ユーザーセッションやコンテキスト情報をバックエンドで保持するために、Redisを利用します。Kubernetes上でRedisをデプロイし、冗長化と高可用性を確保します。

**3. AIモデル:**

- **Gemini Pro 2.5**: 高性能な大規模言語モデルで、ユーザーとの対話を実現します。バックエンドからAPI経由で呼び出し、ユーザー入力に応じた応答を生成します。

**4. デプロイメント:**

- **Docker**: アプリケーションのコンテナ化を行い、一貫した実行環境を提供します。

- **Kubernetes (k8s)**: コンテナ化されたアプリケーションのオーケストレーションを行い、スケーラビリティと可用性を確保します。

- **Redisのデプロイ**: Kubernetes上でRedisをデプロイし、StatefulSetを使用して永続的なストレージと一意のネットワークIDを各Podに割り当てます。これにより、データの一貫性と可用性を確保します。

- **監視とロギング**: PrometheusやGrafanaを使用して、システムのパフォーマンス監視とログ管理を行い、障害検出とトラブルシューティングを容易にします。
