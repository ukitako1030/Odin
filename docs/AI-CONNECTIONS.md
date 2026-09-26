# 外部AIからOdinを使う

OdinのWeb画面、REST API、MCPは同じ記録を扱います。AIによる分類・要約は接続したAI側が担当します。公開版をDriveの正本へ保存するときは、最初に `odin_status` で `provider=drive`、`connected=true`、`writable=true` を確認してください。ローカル開発では `provider=local` の保存も可能ですが、公開版のAI連携でDrive保存の代わりにはしません。

**配布用プラグインを使う場合：** まず下記で自分の接続を登録し、[プラグイン導入ガイド](PLUGIN-SETUP.md)で接続用ファイルを生成してください。プラグインを一から作る必要はありません。

## ChatGPTから使う（公開HTTPSのOdin）

ChatGPTのMCP接続には、公開HTTPSのOdinとOAuthの認証サーバーが必要です。`ODIN_API_TOKEN` をChatGPTへ貼る設定ではありません。OdinはOAuthの**リソースサーバー**としてアクセストークンを検証します。ログイン画面、トークン発行、OAuthクライアント登録は提供しないため、Auth0などを別に用意します。Webログイン用の `ODIN_OWNER_PASSWORD` とOAuthログインは別物です。公開配置の全体手順は [SETUP.md](SETUP.md) を参照してください。

1. Odinを自分のHTTPSホストに配置し、Drive接続と書き込み用の共有ロックを設定します。公開オリジンを `ODIN_PUBLIC_URL=https://your-odin.example` とします。接続先は `https://your-odin.example/api/mcp` です。
2. Auth0の **Applications → APIs → Create API** でOdin用APIを作り、**Identifier** を接続先と同じ `https://your-odin.example/api/mcp` にします。署名方式は **RS256** を選びます。Odinが受け付ける方式です。Auth0の **Settings → Advanced** で **Resource Parameter Compatibility Profile** を有効にします。ChatGPTが送る `resource` をAuth0がAPIのaudienceとして扱うために必要です。
3. Auth0の **Applications → Applications → Create Application** でChatGPT用クライアントを作り、例として **Regular Web Applications** を選びます。Applicationの **Settings** で **Authorization Code** を許可し、ChatGPTが使うPKCE（S256）で認可します。使うログイン接続をこのApplicationに有効化し、手順2のAPIを呼べるようにします。**User Management → Users** で本人ユーザーを開き、詳細の **User ID**（例：`auth0|123...`）を控えます。この値がトークンの `sub` に相当します。公開サインアップを使わない場合は無効にしてください。Callback URLは手順6でChatGPTの接続画面を開いてから設定します。この段階では推測して入力しないでください。
4. Odinの配置先に次の4項目を環境変数として設定し、再配置します。値は例なので自分のホストとAuth0 tenantに置き換えてください。`ODIN_OAUTH_ISSUER` はAuth0の `/.well-known/openid-configuration` の `issuer` と完全一致させます。`ODIN_OAUTH_OWNER_SUB` は手順3のUser IDで、メールアドレスではありません。

   ```dotenv
   ODIN_PUBLIC_URL=https://your-odin.example
   ODIN_OAUTH_ISSUER=https://your-tenant.us.auth0.com/
   ODIN_OAUTH_AUDIENCE=https://your-odin.example/api/mcp
   ODIN_OAUTH_OWNER_SUB=auth0|your-user-id
   ```

   実値はホスティングサービスの環境変数設定へ保存します。秘密値やトークンを会話・公開リポジトリへ書かないでください。
5. `https://your-odin.example/.well-known/oauth-protected-resource/api/mcp` にアクセスし、`resource` が接続先URL、`authorization_servers` がAuth0のissuerか確認します。未認証の `/api/mcp` は `401` と `WWW-Authenticate` を返すのが正常です。
6. ChatGPTの **Settings → Security and login → Developer mode** を有効化し、[Plugins](https://chatgpt.com/plugins) で **＋** からMCP接続を追加します。名前と説明、接続先 `https://your-odin.example/api/mcp` を入力します。OAuthクライアント情報の入力欄がある場合は手順3のクライアント情報を指定します。接続画面が示すredirect URIをAuth0に登録した後、本人としてログインします。利用できるメニューはアカウント・ワークスペース設定に左右されます。
7. 新しい会話のツールメニューでOdinを選び、まず「Odinの状態を確認して」と依頼します。次に架空の短いメモを1件保存し、`odin_search` で探して `odin_fetch` で本文を読み戻します。最後にWeb画面でも同じ記録を確認します。更新する場合は取得した `revision` を `expectedRevision` に渡し、競合時は再取得します。

この手順は開発者モードの**MCP接続**を作るものです。公開配布するPluginのパッケージ作成・審査とは別です。音声会話での利用は製品・モードごとに実際のツール呼び出しを確認してください。

## Codexから使う

ローカルOdinを使う場合はリポジトリで `npm ci` と `npm run dev` を済ませ、Odin側にランダムな `ODIN_API_TOKEN` を設定して再起動します。Codexを起動する環境にも**同じ** `ODIN_API_TOKEN` を渡します。Node.js 24以上が必要です。以下は `~/.codex/config.toml`（Windowsでは通常 `%USERPROFILE%\.codex\config.toml`）に記す例です。`C:/path/to/Odin` を実際のリポジトリの絶対パスへ置き換えてください。

```toml
[mcp_servers.odin]
command = "node"
args = ["C:/path/to/Odin/scripts/odin-mcp.ts"]
env_vars = ["ODIN_API_TOKEN", "ODIN_MCP_URL"]
```

Odinサーバーは `.env.local` を読みますが、このstdioブリッジは**自動では読みません**。WindowsのPowerShellからCodex CLIを起動する例です。トークンをコマンド履歴やTOMLに直書きせず、入力欄に貼り付けます。終了後はこのPowerShellから環境変数を消します。

```powershell
$secureToken = Read-Host "ODIN_API_TOKEN" -AsSecureString
$env:ODIN_API_TOKEN = [System.Net.NetworkCredential]::new("", $secureToken).Password
codex
Remove-Item Env:ODIN_API_TOKEN
```

この操作で値は起動中のプロセス環境へ渡ります。デスクトップアプリを別途アイコンから起動した場合、このPowerShellの環境変数は継承されません。Node 24はこのブリッジのTypeScriptを直接実行できます。`npm run mcp` はnpmの起動表示がMCPの標準出力に混ざる環境があるため、この設定では使いません。既定の接続先は `http://127.0.0.1:3000/api/mcp` です。別のOdinなら、Codex起動環境に `ODIN_MCP_URL=https://your-odin.example/api/mcp` も設定します。リモート接続にはHTTPSが必要です。Codexを再起動し、`codex mcp list` または `/mcp` で登録を確認し、`odin_status` と `odin_search` を試します。Codexが継承する環境変数にトークンがない場合、ブリッジは起動できません。

リモートOdinへ直接HTTP接続するCodexでは、次の設定も選べます。この場合はstdioブリッジを使わず、Codex起動環境の `ODIN_API_TOKEN` をAuthorizationヘッダーに使います。OAuthで接続する場合は `bearer_token_env_var` を外し、`codex mcp login odin` でログインします。

```toml
[mcp_servers.odin]
url = "https://your-odin.example/api/mcp"
bearer_token_env_var = "ODIN_API_TOKEN"
```

## ほかのAIと共通の操作

MCP対応クライアントは、公開HTTPSの `/api/mcp` とOAuth、またはクライアントが許す場合はBearer tokenで接続できます。各製品の対応状況や設定画面は個別に確認してください。GeminiなどMCP接続を使わない環境では、会話を整理してOdinのWeb画面やREST用CLIへ渡す方法もあります。どの製品でも、接続できたことと保存・読み戻しできたことは分けて確認します。

OdinのMCPには状態確認、検索、取得、履歴、作成、更新、完了、ゴミ箱、復元、会話取り込み用のツールがあります。作成の再試行には同じ `idempotencyKey` と同じ内容を使い、応答が不明なまま新しいキーで再作成しないでください。会話取り込みの候補提出は、確認画面で反映するまで正本へ保存されません。

REST用CLIはOdinリポジトリで `ODIN_API_TOKEN` を環境変数に設定して使います。公開先を使う場合は `ODIN_URL=https://your-odin.example` も設定します。

```sh
npm run memory -- status
npm run memory -- search --query 記録
npm run memory -- fetch --id <記録のUUID>
```

## つながらないとき

| 状態 | 確認すること |
| --- | --- |
| ChatGPTの追加画面が見つからない | Developer modeとアカウント・ワークスペースでの利用可否を確認する。 |
| OAuthのログイン画面が出ない | 公開HTTPSの `/api/mcp`、保護リソースmetadata、未認証時の `401` と `WWW-Authenticate` を確認する。 |
| Auth0でaudience/userinfoのエラー | API Identifierと `ODIN_OAUTH_AUDIENCE` がMCP URLに一致するか、Resource Parameter Compatibility Profileが有効か確認する。 |
| ログイン後に `401` | Auth0のissuer、API audience、本人の `sub` とOdinの3環境変数を照合する。redirect URIも画面表示と完全一致させる。 |
| `odin_status` は使えるが書き込めない | `provider=drive`、`connected`、`writable`、Drive設定、共有ロックを確認する。 |
| CodexでMCPが起動しない | Node 24以上、絶対パス、Codexが継承する `ODIN_API_TOKEN`、Odinサーバーの起動を確認する。 |

参考：[OpenAIのMCP接続手順](https://developers.openai.com/plugins/deploy/connect-chatgpt)、[OAuth要件](https://developers.openai.com/plugins/build/auth)、[CodexのMCP設定](https://developers.openai.com/codex/mcp)、[Auth0のresource設定](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0)、[Auth0のApplication作成](https://auth0.com/docs/get-started/auth0-overview/create-applications/regular-web-apps)、[Auth0のUser IDとsub](https://support.auth0.com/center/s/article/Documentation-regard-ID-Token-sub-claim-is-unclear)。
