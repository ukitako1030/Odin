# Connect the Odin plugin to your own instance

[日本語](PLUGIN-SETUP.md) | English

The distribution includes Odin's storage rules and a **template that generates connection files**. Enter the URL of your own Odin instance to generate a plugin directory, ZIP, and local marketplace listing. You do not need to write plugin code.

This does not connect to the author's Odin or Drive. Each owner must grant Google Drive access, authenticate with their own Odin instance, and register their own ChatGPT connection. Generating a ZIP does not complete those steps.

## 1. Prepare your Odin instance

Follow [Setup](SETUP.en.md) to run your own Odin over HTTPS with Drive storage. For ChatGPT, also complete the OAuth steps in [Connect AI clients](AI-CONNECTIONS.en.md#use-from-chatgpt-public-https-odin).

Two permissions are involved:

- **Google authorization:** lets your Odin instance store records in your Drive.
- **Odin login:** lets ChatGPT or another client operate your Odin instance.

Do not put a password, API token, or Google secret in the plugin. The generator does not read those values.

## 2. Register a ChatGPT connection

Enable ChatGPT Developer mode and register `https://your-odin.example/api/mcp` under Plugins. Sign in as the owner through OAuth, then confirm that status and search work. Follow the [screen-by-screen connection steps](AI-CONNECTIONS.en.md#use-from-chatgpt-public-https-odin).

Copy **your connection ID** from the registered connection's page URL. It begins with `plugin_asdk_app_...`; the generator also accepts the `asdk_app_...` form shown in some management screens. Do not use someone else's ID.

The ChatGPT connection alone gives you access to Odin's MCP tools. The next steps package it together with the storage rules as a plugin.

## 3. Generate your plugin

From the Odin repository root, install dependencies with Node.js 24 or later:

```sh
npm ci
```

Start the interactive generator in English:

```sh
npm run setup:plugin -- --language en
```

Enter your own Odin HTTPS URL and the connection ID from step 2 when prompted. You may enter the site origin or a URL ending in `/api/mcp`. To provide the values on the command line instead, replace the examples below:

```sh
npm run setup:plugin -- --language en --url https://your-odin.example --app-id plugin_asdk_app_YOUR_CONNECTION_ID
```

The output directory is `.odin/plugin-package/`.

| Generated item | Purpose |
| --- | --- |
| `plugins/odin-memory/` | Plugin with connection configuration and storage rules |
| `odin-memory.zip` | ZIP of the same plugin, for environments that support ZIP import |
| `.agents/plugins/marketplace.json` | Listing for compatible local clients |
| `README.md` | Instructions for your own connection and installation |

The generator does not overwrite an existing output directory. To generate again, choose another path, such as `--output .odin/plugin-package-v2`. Output contains your connection URL and ID, so do not add it to the distribution source.

## 4. Add it to a compatible local client

Where Codex CLI is available, run this from the repository root:

```sh
codex plugin marketplace add ./.odin/plugin-package
```

Restart a compatible desktop app, then install **Odin Memory** from the local **Odin** source under Plugins. This installs it for your own environment; it does not publish it to an official directory or your whole organization.

Support for local sources and ZIP import varies by product and screen. **Attaching the ZIP to a ChatGPT web conversation does not install it.** If your client cannot use local plugins, select the Odin connection registered in step 2. The MCP server also provides the basic storage rules.

In a new conversation, select Odin and ask it to check status, save a short fictional note, and read the saved body back. Confirm that the same record appears in the web UI.

## Connect Codex or another client directly over HTTPS MCP

Generate files with only the URL, omitting the ChatGPT connection ID:

```sh
npm run setup:plugin -- --language en --url https://your-odin.example
```

This generates an HTTPS MCP configuration instead of a reference to a registered ChatGPT connection. Complete OAuth authorization in your client. For API-token access or use only on your computer, see the [Codex connection settings](AI-CONNECTIONS.en.md#use-from-codex).

## Package contents and verification

The template is in [plugins/odin-memory](../plugins/odin-memory/README.en.md), and the generator is `scripts/setup-plugin.mjs`. Generation only creates files. It does not configure authentication, install or publish a plugin, or write to Drive.

Automated tests cover generated files, ZIP contents, input validation, and protection of existing files. Verify actual ChatGPT installation, OAuth login, and saving with your own connection using the steps above.

References: [OpenAI plugin creation and local installation](https://developers.openai.com/plugins/build/plugins) and [connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt).
