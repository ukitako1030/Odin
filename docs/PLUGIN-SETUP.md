**日本語** | [English](PLUGIN-SETUP.en.md)

# Odinプラグインを自分の環境に接続する

配布するのは、Odinの保存ルールと**接続用ファイルを作るテンプレート**です。自分のOdinのURLを入力すれば、プラグインのフォルダー・ZIP・ローカル用の登録一覧を生成できます。プラグインのコードを書く必要はありません。

作者のOdinやDriveには接続しません。Google Driveの許可、Odinの本人認証、ChatGPTへの接続登録は利用者ごとに行います。ZIPを作るだけでこれらの設定が済むわけではありません。

## 1. 自分のOdinを用意する

[セットアップガイド](SETUP.md)に従って、Driveへ保存できるOdinをHTTPSで動かします。ChatGPTから使う場合は、[AI接続ガイド](AI-CONNECTIONS.md#chatgptから使う公開httpsのodin)のOAuth設定も済ませます。

認証には次の二つがあります。

- **Googleの許可**：自分のOdinから、自分のDriveへ保存するため。
- **Odinへのログイン**：ChatGPTなどが、自分のOdinを操作するため。

パスワード・APIトークン・Googleのシークレットをプラグインに入れる必要はありません。生成コマンドもこれらを読み込みません。

## 2. ChatGPTで接続を登録する

ChatGPTの開発者モードを有効にし、Pluginsの追加画面へ、自分のOdinの `https://自分のホスト/api/mcp` を登録します。OAuthで本人としてログインし、まず状態確認と検索ができることを確認します。[画面ごとの手順](AI-CONNECTIONS.md#chatgptから使う公開httpsのodin)

登録した接続の画面URLから、`plugin_asdk_app_...` で始まる**自分の接続ID**を控えます。管理画面等で `asdk_app_...` と表示される形式にも生成コマンドは対応します。別の人のIDは使いません。

ChatGPTの接続登録だけでもOdinのMCPツールは使えます。以下では保存ルールも含めたプラグインとしてまとめます。

## 3. プラグインを生成する

取得したOdinリポジトリで、Node.js 24以上を使って実行します。

```sh
npm ci
npm run setup:plugin
```

質問に、自分のOdinのHTTPS URLと、手順2で取得した接続IDを入力します。URLはサイトのトップ、または `/api/mcp` まで入力できます。接続IDを使うChatGPT向けの例は次のとおりです。値は自分のものへ置き換えてください。

```sh
npm run setup:plugin -- --url https://your-odin.example --app-id plugin_asdk_app_YOUR_CONNECTION_ID
```

出力先は `.odin/plugin-package/` です。

| 生成物 | 用途 |
| --- | --- |
| `plugins/odin-memory/` | 接続設定と保存ルールを含むプラグイン本体 |
| `odin-memory.zip` | 同じプラグイン本体のZIP。ZIP取込を提供する環境向け |
| `.agents/plugins/marketplace.json` | 対応するローカルクライアントにプラグインを表示する一覧 |
| `README.md` | 自分の接続先と導入方法の案内 |

既存の出力は上書きしません。作り直す場合は、たとえば `--output .odin/plugin-package-v2` を付けて別のフォルダーに生成します。生成物は自分の接続先・接続IDを含むため、配布用の正本へ追加しないでください。

## 4. 対応するローカルクライアントに追加する

Codex CLIが使える環境で、リポジトリのルートから実行します。

```sh
codex plugin marketplace add ./.odin/plugin-package
```

対応するデスクトップアプリを再起動し、Pluginsのローカルソース **Odin** から **Odin Memory** をインストールします。これは自分の環境への導入です。公式ディレクトリへの公開や、組織全体への公開操作は必要ありません。

ローカルソースの表示・ZIP取込の対応は製品・利用画面によって異なります。**ChatGPTのWeb版へZIPを添付するだけでインストールできる、という意味ではありません。** ローカルプラグインを扱えない環境では、手順2で登録したOdinの接続を選んで使います。MCPサーバーからも基本の保存ルールが渡されます。

新しい会話でOdinを選び、「状態を確認して」→「接続テストというメモを保存して」→「保存した本文を読み戻して」の順に確認します。Web画面で同じ記録が見えれば、保存まで確認できています。

## CodexなどへHTTPSのMCPで直接つなぐ場合

接続IDを指定せず、URLだけで生成します。

```sh
npm run setup:plugin -- --url https://your-odin.example
```

この場合は登録済みChatGPT接続への参照ではなく、HTTPSのMCP設定を生成します。利用するクライアントでOAuth認証を完了してください。APIトークンを使いたい場合や、PC内だけで使う場合は[Codexの接続設定](AI-CONNECTIONS.md#codexから使う)を利用できます。

## 配布内容と検証範囲

テンプレートは [plugins/odin-memory](../plugins/odin-memory/README.md)、生成処理は [scripts/setup-plugin.mjs](../scripts/setup-plugin.mjs) にあります。生成処理はファイルを作るだけで、認証設定・プラグインのインストール・公開・Driveへの書き込みは行いません。

生成ファイルとZIPの内容、入力チェック、既存ファイルの保護を自動テストします。実際のChatGPTへのインストール・OAuthログイン・保存は、利用者の接続先で上記の確認を行ってください。

仕様の参照先：[OpenAIのプラグイン作成・ローカル導入](https://developers.openai.com/plugins/build/plugins)、[接続テスト](https://developers.openai.com/plugins/deploy/connect-chatgpt)。
