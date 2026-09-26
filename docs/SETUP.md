# セットアップ

Odinは単一の所有者が使うアプリです。まずローカルで起動し、必要になった場合だけDriveや外部AIを接続してください。

## 1. ローカルで起動

Node.js 24以上とnpmを用意し、リポジトリのルートで実行します。

```sh
npm ci
npm run dev
```

`http://127.0.0.1:3000` を開きます。開発サーバーはループバックで起動します。標準の保存先はプロジェクト直下の `.odin/vault` です。初回はサンプル記録が作られます。不要な場合は、起動前に `.env.example` を `.env.local` にコピーし、`ODIN_SEED_EXAMPLES=0` に変更してください。既存のサンプルを消す設定ではありません。

`.odin/` には個人データが入ります。保管庫を定期的にバックアップし、公開リポジトリへ追加しないでください。保存場所を変える場合は `.env.local` の `ODIN_VAULT_DIR` に自分のPCの永続ディレクトリを指定できます。

## 2. Google Driveを使う場合（任意）

ローカル保存のまま使う場合、この設定は不要です。Driveを使う場合は、自分のGoogle CloudプロジェクトでDrive APIを有効にし、`drive.file` スコープを使う**デスクトップアプリ**のOAuthクライアントを作成します。自分の `.env.local` に次を設定します。

```dotenv
GOOGLE_CLIENT_ID=自分のクライアントID
GOOGLE_CLIENT_SECRET=自分のクライアントシークレット
```

次に実行し、表示された認可URLで自分のGoogleアカウントを許可します。

```sh
npm run setup:drive
```

セットアップはOdin用フォルダーを作成または再利用し、更新トークンとフォルダーIDを `.env.local` に保存して `ODIN_STORAGE=drive` に切り替えます。既存のローカル記録を移す場合は、アプリや外部AIからの書き込みを止め、保管庫をバックアップしてから実行します。

```sh
npm run migrate:drive -- --dry-run
npm run migrate:drive
```

移行後にアプリを再起動し、設定画面または `/api/status` で `provider: drive`、`connected: true`、`writable: true` を確認してください。記録の本文と履歴も読み戻します。移行元のローカル保管庫は残りますが、その後の変更をDriveと自動同期しません。Driveで失敗した保存はローカルへ自動的に切り替わりません。

## 3. 外部AIと接続する場合（任意）

REST APIとMCPは記録の共通保存処理を利用します。stdio MCPに対応するローカルクライアントでは `npm run mcp` を接続コマンドとして登録できます。リモートAI製品からの接続には、各製品の対応と、必要に応じて自分のOIDC認可サーバー設定が別途必要です。接続設定だけで連携済みとは判断せず、実際の読み書きを確認してください。

MCPブリッジでは `ODIN_API_TOKEN` が必須で、接続先の指定には `ODIN_MCP_URL` を使います。REST用CLIの接続先は `ODIN_URL` です。設定例は[AI接続ガイド](AI-CONNECTIONS.md)を参照してください。

会話取り込みでは、書き出しファイルやローカルCodex履歴から対象を選びます。候補の分類・要約は外部AIで行い、Odin画面で根拠と内容を確認して保存します。Odinには自動課金される内蔵AI APIはありません。

## 4. インターネット上で使う場合

公開環境では、自分で長くランダムな `ODIN_OWNER_PASSWORD` と、独立した32バイト以上の `ODIN_SESSION_SECRET` を設定してください。AI接続を使う場合は `ODIN_API_TOKEN` またはOIDC設定も必要です。秘密値は `.env.local` またはホスティング環境の環境変数だけに置き、リポジトリに含めないでください。認証未設定の公開環境はデータアクセスを拒否します。

永続ディスクのないホスティング環境ではローカル保管庫を使えません。VercelでDriveへ書き込む場合は、上記のGoogle認証情報と `ODIN_STORAGE=drive` に加え、共有書き込み調整用の `ODIN_LOCK_REDIS_URL` / `ODIN_LOCK_REDIS_TOKEN` が必要です。外部エディターの直接編集はこのロックに参加しないため、同じDriveファイルを同時に編集しないでください。

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm start` はループバックに限定されます。外部公開はホスト側のネットワーク設定、HTTPS、レート制限を含めて構成してください。公開用リポジトリ自体はまだ準備中です。状態は[公開準備の状態](RELEASE-STATUS.md)を確認してください。
