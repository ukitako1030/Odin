# Connect AI clients to Odin

[日本語](AI-CONNECTIONS.md) | English

Odin's web UI, REST API, and MCP work with the same records. The connected AI handles classification and summaries. Before writing from an AI client to a public Odin instance, run `odin_status` and confirm `provider=drive`, `connected=true`, and `writable=true`. Local development can save with `provider=local`; that is not a substitute for checking Drive storage in a public deployment.

**Using the distributable plugin?** Register your own connection below first, then generate connection files using the [plugin setup guide](PLUGIN-SETUP.en.md). You do not need to write a plugin from scratch.

The creator built Odin to capture notes, tasks, and shopping lists without interrupting a GPT Live conversation. An equivalent voice workflow with other AI products has not been verified.

## Use from ChatGPT (public HTTPS Odin)

ChatGPT MCP access requires an Odin instance on public HTTPS and a separate OAuth authorization server. Do not paste `ODIN_API_TOKEN` into ChatGPT. Odin validates access tokens as an OAuth **resource server**; it does not provide OAuth login screens, token issuance, or client registration. Use a service such as Auth0. The web login password (`ODIN_OWNER_PASSWORD`) is separate from OAuth login. See [Setup](SETUP.en.md) for deployment.

1. Deploy your Odin instance over HTTPS with Drive storage and a shared write lock. Set `ODIN_PUBLIC_URL=https://your-odin.example`. Its MCP URL is `https://your-odin.example/api/mcp`.
2. In Auth0, open **Applications → APIs → Create API**. Set the API **Identifier** to the exact MCP URL, `https://your-odin.example/api/mcp`, and choose **RS256** signing, which Odin accepts. Enable **Resource Parameter Compatibility Profile** under **Settings → Advanced** so Auth0 treats ChatGPT's `resource` parameter as the API audience.
3. Under **Applications → Applications → Create Application**, create a ChatGPT client; **Regular Web Applications** is an example application type. Allow **Authorization Code** in its **Settings** and authorize with PKCE (S256), which ChatGPT uses. Enable the login connection for this application and access to the API from step 2. Under **User Management → Users**, open your own user and copy the **User ID** (for example, `auth0|123...`); this is the token's `sub`, not your email address. Disable public sign-up if you do not use it. Add the callback URL after opening ChatGPT's connection screen in step 6; do not guess it now.
4. Set the following environment variables on your Odin host and redeploy. Replace the examples with your host and Auth0 tenant. `ODIN_OAUTH_ISSUER` must exactly match `issuer` in Auth0's `/.well-known/openid-configuration`. `ODIN_OAUTH_OWNER_SUB` is the User ID from step 3.

   ```dotenv
   ODIN_PUBLIC_URL=https://your-odin.example
   ODIN_OAUTH_ISSUER=https://your-tenant.us.auth0.com/
   ODIN_OAUTH_AUDIENCE=https://your-odin.example/api/mcp
   ODIN_OAUTH_OWNER_SUB=auth0|your-user-id
   ```

   Keep real values in your host's environment settings. Do not put secrets or tokens in a conversation or public repository.
5. Open `https://your-odin.example/.well-known/oauth-protected-resource/api/mcp`. Confirm that `resource` matches your MCP URL and `authorization_servers` identifies the Auth0 issuer. An unauthenticated request to `/api/mcp` should return `401` with `WWW-Authenticate`.
6. Enable **Settings → Security and login → Developer mode** in ChatGPT. Open [Plugins](https://chatgpt.com/plugins) and use **＋** to add an MCP connection. Enter a name, description, and `https://your-odin.example/api/mcp`. If the form requests OAuth client information, use the client from step 3. Register the redirect URI displayed by ChatGPT in Auth0, then sign in as your owner user. Available menus depend on your account and workspace.
7. Select Odin from the tools menu in a new conversation. Ask it to check Odin's status, save one short fictional note, find it with `odin_search`, and read its body with `odin_fetch`. Check the same record in the web UI. For updates, pass the fetched `revision` as `expectedRevision`; fetch again after a conflict.

These steps create a Developer mode **MCP connection**. Packaging and review for a publicly distributed Plugin are separate. Verify actual tool calls in any voice mode you intend to use; availability varies by product and mode.

## Use from Codex

For local Odin, run `npm ci` and `npm run dev` in the repository. Set a random `ODIN_API_TOKEN` for the Odin server and restart it. Pass the **same** `ODIN_API_TOKEN` to the environment that launches Codex. Node.js 24 or later is required. Add the following to `~/.codex/config.toml` (usually `%USERPROFILE%\.codex\config.toml` on Windows). Replace `C:/path/to/Odin` with the repository's absolute path.

```toml
[mcp_servers.odin]
command = "node"
args = ["C:/path/to/Odin/scripts/odin-mcp.ts"]
env_vars = ["ODIN_API_TOKEN", "ODIN_MCP_URL"]
```

The Odin server reads `.env.local`; this stdio bridge **does not read it automatically**. For example, start Codex CLI from PowerShell, entering the token into a secure prompt rather than putting it in command history or TOML. Remove the environment variable from that PowerShell session afterward.

```powershell
$secureToken = Read-Host "ODIN_API_TOKEN" -AsSecureString
$env:ODIN_API_TOKEN = [System.Net.NetworkCredential]::new("", $secureToken).Password
codex
Remove-Item Env:ODIN_API_TOKEN
```

This passes the value to the running process. A desktop app launched separately from its icon does not inherit this PowerShell session's variables. Node 24 can run the bridge's TypeScript directly. Do not use `npm run mcp` for this stdio configuration: npm startup text can contaminate MCP standard output. The default target is `http://127.0.0.1:3000/api/mcp`. For another Odin instance, also set `ODIN_MCP_URL=https://your-odin.example/api/mcp` in Codex's launch environment; remote access requires HTTPS. Restart Codex, confirm registration with `codex mcp list` or `/mcp`, then try `odin_status` and `odin_search`. The bridge cannot start if Codex does not inherit the token.

Codex can also connect directly to a remote Odin over HTTP without the stdio bridge. This configuration uses `ODIN_API_TOKEN` from Codex's launch environment in the Authorization header. For OAuth instead, omit `bearer_token_env_var` and run `codex mcp login odin`.

```toml
[mcp_servers.odin]
url = "https://your-odin.example/api/mcp"
bearer_token_env_var = "ODIN_API_TOKEN"
```

## Common operations for other AI clients

Odin exposes MCP, so the same Odin can also hold conversation highlights and decisions made while coding.

- **Claude**: register the public HTTPS `/api/mcp` URL as a [custom connector](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) and configure OAuth.
- **Claude Code**: connect over HTTP or stdio using its [MCP settings](https://code.claude.com/docs/en/mcp).
- **Codex**: use the HTTP or stdio configuration in “Use from Codex” above.

These options follow the clients’ documented MCP support and Odin’s interfaces. They do not mean every client or voice mode has been tested with Odin. After connecting, run `odin_status`, save a fictional record, and read it back.

This guide does not provide direct saving during conversations in the Gemini app or Gemini Live. The separate [Gemini CLI supports MCP](https://geminicli.com/docs/tools/mcp-server/), so this is not a claim that all Gemini products lack connectivity. Manually copying text into Odin is a separate workflow from saving directly during a conversation.

Odin MCP offers status, search, fetch, history, create, update, completion, trash, restore, and conversation-import tools. When retrying creation, use the same `idempotencyKey` and the same content. If the outcome is unclear, do not retry with a new key. Conversation import candidates do not enter the primary store until you confirm them in the review screen.

To use the REST CLI in the Odin repository, set `ODIN_API_TOKEN` in the environment. For a public instance, also set `ODIN_URL=https://your-odin.example`.

```sh
npm run memory -- status
npm run memory -- search --query notes
npm run memory -- fetch --id <record-uuid>
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| ChatGPT's add-connection screen is missing | Developer mode and availability for your account and workspace. |
| OAuth login does not appear | Public HTTPS `/api/mcp`, protected-resource metadata, and unauthenticated `401` with `WWW-Authenticate`. |
| Auth0 reports an audience or userinfo error | API Identifier and `ODIN_OAUTH_AUDIENCE` must match the MCP URL; Resource Parameter Compatibility Profile must be enabled. |
| `401` after login | Compare Auth0 issuer, API audience, your user's `sub`, and Odin's three OAuth variables. The redirect URI must exactly match the one shown by ChatGPT. |
| `odin_status` works but writing fails | `provider=drive`, `connected`, `writable`, Drive configuration, and the shared lock. |
| MCP fails to start in Codex | Node 24+, the absolute path, an inherited `ODIN_API_TOKEN`, and a running Odin server. |

References: [OpenAI MCP connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt), [OAuth requirements](https://developers.openai.com/plugins/build/auth), [Codex MCP configuration](https://developers.openai.com/codex/mcp), [Auth0 resource setting](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0), [creating an Auth0 application](https://auth0.com/docs/get-started/auth0-overview/create-applications/regular-web-apps), and [Auth0 User ID and `sub`](https://support.auth0.com/center/s/article/Documentation-regard-ID-Token-sub-claim-is-unclear).
