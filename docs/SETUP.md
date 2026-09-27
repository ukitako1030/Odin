**日本語** | [English](SETUP.en.md)

# セットアップ

Odinは単一の所有者が使うアプリです。まずローカルで起動し、必要になった場合だけDriveや外部AIを接続してください。

## ローカルで起動

Node.js 24以上とnpmを用意し、リポジトリのルートで実行します。

```sh
npm ci
npm run dev
```

`http://127.0.0.1:3000` を開きます。開発サーバーはループバックで起動します。標準の保存先はプロジェクト直下の `.odin/vault` です。初回はサンプル記録が作られます。不要な場合は、起動前に `.env.example` を `.env.local` にコピーし、`ODIN_SEED_EXAMPLES=0` に変更してください。既存のサンプルを消す設定ではありません。

`.odin/` には個人データが入ります。保管庫を定期的にバックアップし、公開リポジトリへ追加しないでください。保存場所を変える場合は `.env.local` の `ODIN_VAULT_DIR` に自分のPCの永続ディレクトリを指定できます。

## Google Driveを保存先にする

ローカル保存のまま使う場合、この設定は不要です。Driveに保存する場合は、自分のGoogleアカウントとGoogle Cloudプロジェクトを使って、次の順に設定します。Googleの画面名や手順は[Drive APIの公式ガイド](https://developers.google.com/workspace/drive/api/quickstart/nodejs)も参照してください。

1. [Google Cloudコンソール](https://console.cloud.google.com/)でプロジェクトを作成または選択し、**Google Drive API**を有効にします。
2. **Google Auth Platform → Branding**でアプリ名、サポート用メールアドレス、連絡先メールアドレスを設定します。**Audience**では、個人のGoogleアカウントで使う場合は **External** を選び、テスト中なら自分のアカウントを**テストユーザー**に追加します。Google Workspace組織内だけで使う場合は **Internal** も選べます。[同意画面の公式手順](https://developers.google.com/workspace/guides/configure-oauth-consent)を参照してください。
3. **Data Access**に `https://www.googleapis.com/auth/drive.file` を追加します。Odinはこの権限で、自身が作成したDriveファイルを扱います。Drive全体への権限は設定しません。
4. **Clients → Create Client**でアプリケーションの種類を**Desktop app（デスクトップ アプリ）**にし、作成されたクライアントIDとシークレットを控えます。公式ガイドにある `credentials.json` のダウンロードは、このOdinの設定スクリプトには不要です。

リポジトリのルートで `.env.example` を `.env.local` にコピーし、次の2項目を自分の値に変更します。すでに `.env.local` がある場合は、内容を消さずに2項目を追加・更新してください。値や作成したファイルはGitへ登録しません。

```dotenv
GOOGLE_CLIENT_ID=自分のクライアントID
GOOGLE_CLIENT_SECRET=自分のクライアントシークレット
```

同じPCで次を実行します。ターミナルに表示された認可URLをブラウザーで開き、自分のGoogleアカウントで許可します。**ExternalかつTesting**の場合は、テストユーザーに追加したアカウントを選んでください。OdinがこのPCの `127.0.0.1` に一時的な受け口を開くため、認証が終わるまでコマンドを終了しないでください。

```sh
npm run setup:drive
```

成功するとOdin用フォルダーを作成または再利用し、更新トークンとフォルダーIDを `.env.local` に保存して `ODIN_STORAGE=drive` に切り替えます。`Odin` フォルダーが複数見つかって停止した場合は、使うフォルダーのIDを `GOOGLE_DRIVE_FOLDER_ID` に指定して再実行してください。

**ExternalかつTesting**の認可で発行された更新トークンは、Googleの仕様で原則7日後に失効します。長期利用ではGoogle Auth PlatformのAudienceでOAuthアプリの公開ステータスを **In production** に切り替えることを検討し、Googleが求める確認・審査の要否に従ってください。これはOdinのGitHubリポジトリを公開する操作とは別です。詳しくは[公開ステータスと認証要件](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)を確認してください。接続が切れたら認証状態を確認し、必要に応じて `npm run setup:drive` を再実行します。

既存のローカル記録を移す場合は、アプリや外部AIからの書き込みを止め、`.odin/vault` または `ODIN_VAULT_DIR` で指定した保管庫をバックアップしてから実行します。まず件数を確認し、その後に移行します。

```sh
npm run migrate:drive -- --dry-run
npm run migrate:drive
```

移行コマンドはOdinの管理ファイルを対象とし、Driveに異なる内容の同名ファイルがあれば上書きせず停止します。移行後にアプリを再起動し、設定画面または `/api/status` で `provider: drive`、`connected: true`、`writable: true` を確認してください。記録の本文と履歴も実際に開いて確認します。移行元のローカル保管庫は残りますが、その後の変更をDriveと自動同期しません。Driveで失敗した保存はローカルへ自動的に切り替わりません。

## 外部AIと接続する場合（任意）

REST APIとMCPは記録の共通保存処理を利用します。stdio MCPに対応するローカルクライアントでは、Node.js 24以上で `scripts/odin-mcp.ts` を直接起動できます。クライアントへの登録方法は[AI接続ガイド](AI-CONNECTIONS.md#codexから使う)を参照してください。リモートAI製品からの接続には、各製品の対応と、必要に応じて自分のOIDC認可サーバー設定が別途必要です。接続設定だけで連携済みとは判断せず、実際の読み書きを確認してください。

MCPブリッジでは `ODIN_API_TOKEN` が必須で、接続先の指定には `ODIN_MCP_URL` を使います。REST用CLIの接続先は `ODIN_URL` です。設定例は[AI接続ガイド](AI-CONNECTIONS.md)を参照してください。

会話取り込みでは、書き出しファイルやローカルCodex履歴から対象を選びます。候補の分類・要約は外部AIで行い、Odin画面で根拠と内容を確認して保存します。Odinには自動課金される内蔵AI APIはありません。

## インターネット上で使う場合

公開環境では、自分で長くランダムな `ODIN_OWNER_PASSWORD` と、独立した32バイト以上の `ODIN_SESSION_SECRET` を設定してください。秘密値は `.env.local` またはホスティング環境の環境変数だけに置き、リポジトリに含めないでください。認証未設定の公開環境はデータアクセスを拒否します。永続ディスクのないホスティング環境ではローカル保管庫を使えません。

### Vercelで公開する例

1. [Vercel](https://vercel.com/docs/deployments/git)でこのリポジトリをインポートし、Framework Presetを **Next.js**、Node.js Versionを **24.x** に設定します。ルートディレクトリは `package.json` がある場所です。[Node.jsバージョンの設定](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)を参照してください。
2. ローカルで前節の `npm run setup:drive` を済ませます。既存の記録があれば移行と読み戻しも確認します。Vercelに設定するGoogleの4項目は、このとき `.env.local` に保存された値を使います。
3. Vercelプロジェクトの **Settings → Environment Variables** に、次の値を **Production** 用に登録します。`ODIN_PUBLIC_URL` は実際に使うHTTPSの公開オリジン（例: `https://your-odin.example`）です。末尾に `/api/mcp` を付けません。認証情報は公開リポジトリやチャットへ貼らないでください。

| 変数 | 設定する値 |
| --- | --- |
| `ODIN_STORAGE` | `drive` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ローカルのDrive設定で使ったOAuthクライアントの値 |
| `GOOGLE_REFRESH_TOKEN` / `GOOGLE_DRIVE_FOLDER_ID` | `setup:drive` が `.env.local` に保存した値 |
| `ODIN_OWNER_PASSWORD` | Webログイン用の長くランダムなパスワード |
| `ODIN_SESSION_SECRET` | パスワードとは別に生成した32バイト以上のランダムな値 |
| `ODIN_PUBLIC_URL` | 利用するHTTPSの公開オリジン |
| `ODIN_SEED_EXAMPLES` | `0`（公開用のサンプル記録を作らない） |
| `ODIN_LOCK_REDIS_URL` / `ODIN_LOCK_REDIS_TOKEN` | 共有ロック用RedisのHTTPS REST URLと書き込み可能なトークン |

4. Redisは[Upstash RedisのREST接続情報](https://upstash.com/docs/redis/features/restapi)などを利用できます。Upstashの場合、**Connect → REST** にある `UPSTASH_REDIS_REST_URL` の値を `ODIN_LOCK_REDIS_URL` に、`UPSTASH_REDIS_REST_TOKEN` の値を `ODIN_LOCK_REDIS_TOKEN` に入れます。読み取り専用トークンではロックを取得できません。同じDriveフォルダーへ書き込むOdinは、ローカルを含め**すべて同じRedisとトークン**を設定してください。外部エディターの直接編集はこのロックに参加しないため、同じDriveファイルを同時に編集しないでください。
5. Productionへデプロイします。環境変数を追加・変更した場合は、[新しいデプロイが必要です](https://vercel.com/docs/environment-variables)。公開URLで所有者としてログインし、設定画面または `/api/status` の `provider: drive`、`connected: true`、`writable: true` を確認します。短い架空の記録を1件保存し、ページを再読込して本文を読み戻してください。

AI接続も使う場合は `ODIN_API_TOKEN` または[AI接続ガイド](AI-CONNECTIONS.md)のOIDC用3変数（`ODIN_OAUTH_ISSUER`、`ODIN_OAUTH_AUDIENCE`、`ODIN_OAUTH_OWNER_SUB`）を追加します。ChatGPTのOAuth接続には別の認証サーバーが必要です。Webログイン用のパスワードをAI接続に流用しません。

Vercel以外で自分のサーバーにホストする場合も、HTTPSと上記の認証・Drive設定を用意してください。書き込み元が複数なら共有ロックを設定します。ホスト側のネットワーク設定とレート制限も必要です。

ローカルで本番ビルドを確認して起動するコマンドは次のとおりです。

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm start` はループバックに限定されます。公開用リポジトリ自体はまだ準備中です。状態は[公開準備の状態](RELEASE-STATUS.md)を確認してください。
