# Setup

[日本語](SETUP.md) | English

Odin is an app for one owner. Start it locally, then connect Google Drive or an external AI only if you need them.

## Run locally

Install Node.js 24 or later and npm. From the repository root, run:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. The development server listens on loopback. By default, Markdown records are stored in `.odin/vault`, and sample records are created on first launch. To skip the initial samples, copy `.env.example` to `.env.local` **before** starting Odin and set `ODIN_SEED_EXAMPLES=0`. This setting does not remove samples that already exist.

`.odin/` contains personal data. Back up your vault regularly and keep it out of public repositories. To use another persistent directory on your computer, set `ODIN_VAULT_DIR` in `.env.local`.

The login and settings screens offer an **English** language switch. Your choice is saved in a browser cookie. Titles, record bodies, tags, and other saved content are not translated.

## Use Google Drive for storage

Skip this section if local storage is enough. To store records in Drive, use your own Google account and Google Cloud project. Google's screen labels may change; see the [official Drive API guide](https://developers.google.com/workspace/drive/api/quickstart/nodejs).

1. Create or select a project in the [Google Cloud console](https://console.cloud.google.com/) and enable the **Google Drive API**.
2. Under **Google Auth Platform → Branding**, set an app name, support email, and contact email. Under **Audience**, choose **External** for a personal Google account and add your account as a **test user** while testing. For use only within a Google Workspace organization, **Internal** is also an option. See [Google's consent-screen guide](https://developers.google.com/workspace/guides/configure-oauth-consent).
3. Under **Data Access**, add `https://www.googleapis.com/auth/drive.file`. This lets Odin manage Drive files it creates; do not grant access to your entire Drive.
4. Under **Clients → Create Client**, select **Desktop app**. Copy the client ID and client secret. This Odin setup script does not need the `credentials.json` download mentioned in Google's guide.

Copy `.env.example` to `.env.local` at the repository root and replace these two values. If `.env.local` already exists, update those entries without deleting the others. Do not commit the file or its values.

```dotenv
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

On the same computer, run:

```sh
npm run setup:drive
```

The setup script currently prints Japanese prompts. Open the authorization URL shown in the terminal, sign in with your Google account, and grant access. If the OAuth app is **External** and **Testing**, use an account you added as a test user. Keep the command running during authorization: Odin temporarily listens on `127.0.0.1` for the callback. The script may ask you to choose an Odin folder or supply its ID.

On success, the script creates or reuses an Odin folder, saves the refresh token and folder ID to `.env.local`, and sets `ODIN_STORAGE=drive`. If it stops because it found multiple `Odin` folders, set `GOOGLE_DRIVE_FOLDER_ID` to the folder you want and rerun it.

Refresh tokens issued while an **External** OAuth app is in **Testing** generally expire after seven days under Google's rules. For long-term use, consider switching its OAuth publishing status under Audience to **In production**, subject to Google's verification requirements. This is separate from making the Odin GitHub repository public. See [Google's publishing and verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview). If the connection stops working, check its authorization status and rerun `npm run setup:drive` if needed.

To move existing local records, first stop writes from Odin and connected AI clients, then back up `.odin/vault` or the directory set by `ODIN_VAULT_DIR`. Preview the file count before migrating:

```sh
npm run migrate:drive -- --dry-run
npm run migrate:drive
```

The migration handles Odin-managed files. If a file with the same name but different contents exists in Drive, it stops instead of overwriting it. Restart Odin, then check `provider: drive`, `connected: true`, and `writable: true` in Settings or `/api/status`. Open a record and its history to verify the contents. The old local vault remains, but later changes are not synchronized with Drive. A failed Drive save does not automatically fall back to local storage.

## Connect an external AI (optional)

The REST API and MCP use the same record storage logic. A local client that supports stdio MCP can run `scripts/odin-mcp.ts` directly with Node.js 24 or later. See [Connect AI clients](AI-CONNECTIONS.en.md#use-from-codex) for registration. Remote AI products require product support and, where applicable, your own OIDC authorization server. Verify an actual write and read; a completed connection form alone does not establish that storage works.

The MCP bridge requires `ODIN_API_TOKEN`; its target is set with `ODIN_MCP_URL`. The REST CLI uses `ODIN_URL`. See the [AI connection guide](AI-CONNECTIONS.en.md) for examples.

For conversation import, select an export file or local Codex history. An external AI classifies and summarizes candidates; review their source and contents in Odin before saving. Odin does not contain a built-in AI API that automatically incurs charges.

## Use Odin over the internet

For a public deployment, set a long, random `ODIN_OWNER_PASSWORD` and a separate, random `ODIN_SESSION_SECRET` of at least 32 bytes. Store secrets only in `.env.local` or your host's environment variables, never in the repository. A public deployment without authentication configuration denies data access. Local storage cannot be used on a host without persistent disk.

### Example: deploy on Vercel

1. [Import the repository into Vercel](https://vercel.com/docs/deployments/git). Set **Framework Preset** to **Next.js** and **Node.js Version** to **24.x**. The root directory is the one containing `package.json`. See [Vercel's Node.js version settings](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
2. Run `npm run setup:drive` locally as described above. If you have existing records, migrate and read them back. Use the four Google values saved in `.env.local` for the Vercel configuration.
3. Under **Settings → Environment Variables**, set these values for **Production**. `ODIN_PUBLIC_URL` is your actual HTTPS origin, for example `https://your-odin.example`, without `/api/mcp`. Do not paste credentials into a public repository or chat.

| Variable | Value |
| --- | --- |
| `ODIN_STORAGE` | `drive` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | The OAuth client used for local Drive setup |
| `GOOGLE_REFRESH_TOKEN` / `GOOGLE_DRIVE_FOLDER_ID` | Values saved by `setup:drive` in `.env.local` |
| `ODIN_OWNER_PASSWORD` | A long, random password for web login |
| `ODIN_SESSION_SECRET` | A separate random value of at least 32 bytes |
| `ODIN_PUBLIC_URL` | Your HTTPS public origin |
| `ODIN_SEED_EXAMPLES` | `0` (no sample records in production) |
| `ODIN_LOCK_REDIS_URL` / `ODIN_LOCK_REDIS_TOKEN` | HTTPS REST URL and write-capable token for a shared Redis lock |

4. You can use [Upstash Redis REST credentials](https://upstash.com/docs/redis/features/restapi). Copy `UPSTASH_REDIS_REST_URL` from **Connect → REST** to `ODIN_LOCK_REDIS_URL`, and `UPSTASH_REDIS_REST_TOKEN` to `ODIN_LOCK_REDIS_TOKEN`. A read-only token cannot acquire the lock. **Every Odin instance writing to the same Drive folder, including a local instance, must use the same Redis and token.** External editors do not participate in this lock, so avoid editing the same Drive file at the same time.
5. Deploy to Production. [Environment-variable changes require a new deployment](https://vercel.com/docs/environment-variables). Sign in as the owner at your public URL and check `provider: drive`, `connected: true`, and `writable: true` in Settings or `/api/status`. Save one short fictional record, reload the page, and read its body back.

For AI connections, also set `ODIN_API_TOKEN` or the three OIDC variables (`ODIN_OAUTH_ISSUER`, `ODIN_OAUTH_AUDIENCE`, `ODIN_OAUTH_OWNER_SUB`) described in [Connect AI clients](AI-CONNECTIONS.en.md). ChatGPT OAuth needs a separate authorization server. Do not reuse the web login password for AI access.

On another host, provide HTTPS, the same authentication and Drive configuration, and a shared lock when multiple instances can write. Configure network access and rate limits on that host.

To check a production build locally:

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm start` listens on loopback. See [Release status and usage terms](RELEASE-STATUS.en.md).
