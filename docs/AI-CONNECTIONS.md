# 外部AIからOdinを使う

OdinのWeb画面、REST API、MCPは同じ記録と保存処理を使います。外部AIの分類・要約は各クライアントが担当します。接続できるかは利用するAI製品とアカウントのMCP対応にも依存するため、設定後に実際の検索と保存で確認してください。

## 認証を用意する

MCPにはBearer認証が必須です。自分の `.env.local` に、長くランダムな `ODIN_API_TOKEN` を設定してからOdinを再起動します。トークンには全記録への読み書き権限があるため、会話文やリポジトリへ貼らないでください。インターネット上のOdinでは、Webログイン用の `ODIN_OWNER_PASSWORD` と32バイト以上の独立した `ODIN_SESSION_SECRET` も必要です。

```dotenv
ODIN_API_TOKEN=自分で生成した長いランダムな値
```

## stdio対応のMCPクライアント

先に `npm run dev` でOdinを起動します。stdioコマンドを登録できるMCPクライアントには、リポジトリのルートを作業ディレクトリとして次を設定します。

```text
command: npm
args: run mcp
environment: ODIN_API_TOKEN=<自分のトークン>
```

ブリッジは既定で `http://127.0.0.1:3000/api/mcp` に接続します。別のOdinへつなぐ場合は、クライアントの環境変数に `ODIN_MCP_URL=https://<自分のホスト>/api/mcp` も設定します。リモート接続にはHTTPSが必要です。クライアント側の環境変数の登録方法は製品ごとに異なります。起動後、`odin_status` と `odin_search` で接続を確認してください。

MCPには検索・取得・履歴・作成・更新・完了・ゴミ箱・復元と、会話取り込み用のツールがあります。変更前に記録を取得し、更新時は取得した `revision` を `expectedRevision` として渡します。競合したら読み直してください。会話取り込みの候補提出は正本への保存ではなく、画面で確認してから反映します。

## リモートMCPクライアント

Bearer tokenを設定できるクライアントは、公開済みOdinのHTTPS `/api/mcp` に直接接続できます。OAuthを要求するクライアントには、自分の外部OIDC認可サーバーを用意し、Odin側へ `ODIN_OAUTH_ISSUER`、`ODIN_OAUTH_AUDIENCE`、`ODIN_OAUTH_OWNER_SUB`、`ODIN_PUBLIC_URL` を設定する方法があります。Odin自身は認可サーバーやクライアント登録を提供しません。各AI製品への接続は個別に設定・検証してください。

## コマンドから使う

REST用の補助CLIは、Odin起動後に次のように使えます。`ODIN_URL` は省略すると `http://127.0.0.1:3000` です。公開済みOdinへ接続する場合は自分のHTTPSオリジンを `ODIN_URL` に、認証用の `ODIN_API_TOKEN` を環境変数に設定します。

```sh
npm run memory -- status
npm run memory -- search --query 記録
npm run memory -- fetch --id <記録のUUID>
```

CLIの `create` と `update` は**Driveが正本で、接続・書き込み可能と確認できる場合だけ**実行できます。作成時はUTF-8のJSONファイルと再試行用キー、更新時は直前に取得した版番号を指定します。

```sh
npm run memory -- create --file entry.json --key <再試行で変えないキー>
npm run memory -- update --id <記録のUUID> --file changes.json --revision <取得した版番号>
```

作成JSONには `title`、`kind`、`body`、`tags` が必要です。書き込みがタイムアウトした場合、作成は**同じキーと同じ内容**で再試行し、更新は記録を再取得してください。ローカル保存中の記録編集はWeb画面を使えます。
