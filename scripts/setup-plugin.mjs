import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { zipSync, strToU8 } from 'fflate';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateFiles = {
  ja: ['.codex-plugin/plugin.json', 'skills/odin-memory/SKILL.md', 'LICENSE'],
  en: ['.codex-plugin/plugin.en.json', 'skills/odin-memory/SKILL.en.md', 'LICENSE'],
};
const outputTemplateFiles = ['.codex-plugin/plugin.json', 'skills/odin-memory/SKILL.md', 'LICENSE'];
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const messages = {
  ja: {
    missingUrl: 'HTTPS の Odin URL を指定してください。', invalidUrl: 'Odin URL の形式が正しくありません。',
    publicUrl: 'HTTPS の公開 origin または /api/mcp の URL を指定してください。',
    appId: 'App ID は asdk_app_ または plugin_asdk_app_ で始まる有効な ID を指定してください。',
    symlink: '出力先にシンボリックリンクまたはジャンクションを含められません。',
    missingTemplate: (file) => `テンプレートの必須ファイルがありません: ${file}`,
    invalidManifest: 'テンプレートの plugin.json が不正です。',
    invalidName: 'テンプレートの plugin.json は name が odin-memory である必要があります。',
    existing: '出力先は既に存在します。新しいディレクトリを指定してください。',
    args: '引数が正しくありません。--help で使い方を確認してください。',
    tty: '対話入力には TTY が必要です。', urlPrompt: 'Odin の HTTPS URL: ',
    appPrompt: '登録済み App ID（任意、Enter で省略）: ',
    success: (output) => `プラグインを生成しました: ${output}\nREADME.md で接続先と導入手順を確認してください。\n`,
    help: '使い方: npm run setup:plugin -- [--language ja|en] --url https://your-odin.example [--app-id asdk_app_...|plugin_asdk_app_...] [--output DIRECTORY]\nURL を省略すると対話形式で入力します。\n',
  },
  en: {
    missingUrl: 'Provide an HTTPS Odin URL.', invalidUrl: 'The Odin URL is invalid.',
    publicUrl: 'Provide a public HTTPS origin or /api/mcp URL.',
    appId: 'Provide a valid App ID beginning with asdk_app_ or plugin_asdk_app_.',
    symlink: 'The output path must not contain a symbolic link or junction.',
    missingTemplate: (file) => `Required template file is missing: ${file}`,
    invalidManifest: 'The template plugin.json is invalid.',
    invalidName: 'The template plugin.json must have name odin-memory.',
    existing: 'The output path already exists. Choose a new directory.',
    args: 'Invalid arguments. Use --help for usage.',
    tty: 'Interactive input requires a TTY.', urlPrompt: 'Odin HTTPS URL: ',
    appPrompt: 'Registered App ID (optional; press Enter to skip): ',
    success: (output) => `Plugin generated: ${output}\nReview README.md for the endpoint and installation steps.\n`,
    help: 'Usage: npm run setup:plugin -- [--language ja|en] --url https://your-odin.example [--app-id asdk_app_...|plugin_asdk_app_...] [--output DIRECTORY]\nOmit the URL for interactive input.\n',
  },
};

function validLanguage(language) {
  if (language === undefined) return 'ja';
  if (language !== 'ja' && language !== 'en') throw new Error('Language must be ja or en. / 言語は ja または en を指定してください。');
  return language;
}

function endpointFrom(input, language) {
  const message = messages[language];
  if (typeof input !== 'string' || !input.trim()) throw new Error(message.missingUrl);
  let parsed;
  try { parsed = new URL(input); } catch { throw new Error(message.invalidUrl); }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.pathname !== '/' && parsed.pathname !== '/api/mcp') ||
      hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' ||
      hostname === '[::1]' || hostname === '::1' || !hostname.includes('.')) {
    throw new Error(message.publicUrl);
  }
  return `${parsed.origin}/api/mcp`;
}

function validAppId(input, language) {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'string' || !/^(?:plugin_)?asdk_app_[A-Za-z0-9_-]+$/.test(input)) {
    throw new Error(messages[language].appId);
  }
  return input;
}

async function exists(target) {
  try { return await lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function rejectSymlinkAncestors(target, language) {
  let current = path.resolve(target);
  while (true) {
    const stat = await exists(current);
    if (stat?.isSymbolicLink()) throw new Error(messages[language].symlink);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function readTemplate(templateRoot, language) {
  const contents = new Map();
  for (const [index, relative] of templateFiles[language].entries()) {
    const target = path.join(templateRoot, ...relative.split('/'));
    await rejectSymlinkAncestors(target, language);
    const stat = await exists(target);
    if (!stat?.isFile()) throw new Error(messages[language].missingTemplate(relative));
    contents.set(outputTemplateFiles[index], await readFile(target, 'utf8'));
  }
  let manifest;
  try { manifest = JSON.parse(contents.get(outputTemplateFiles[0])); }
  catch { throw new Error(messages[language].invalidManifest); }
  if (!manifest || manifest.name !== 'odin-memory' || Array.isArray(manifest) || typeof manifest !== 'object') {
    throw new Error(messages[language].invalidName);
  }
  return { manifest, contents };
}

function quoteShellPath(target) {
  if (process.platform === 'win32') return `'${target.replaceAll("'", "''")}'`;
  return `'${target.replaceAll("'", "'\\''")}'`;
}

function readme(endpoint, appId, output, language) {
  if (language === 'en') {
    const mode = appId
      ? `Registered App ID: \`${appId}\`. Confirm that it points to your own Odin app.`
      : 'No App ID was provided. Each user must authorize the MCP OAuth connection.';
    return `# Odin Memory plugin\n\nEndpoint: \`${endpoint}\`\n\n${mode}\n\nGeneration only creates configuration files. It does not install or connect the plugin, grant OAuth authorization, publish anything, or contact your server. Supplying a URL does not complete ChatGPT registration or OAuth setup. After installation, verify the endpoint and registered ID, then complete the required OAuth authorization.\n\nTo add the local marketplace to Codex:\n\n\`\`\`sh\ncodex plugin marketplace add ${quoteShellPath(output)}\n\`\`\`\n\n\`odin-memory.zip\` contains only the plugin files, including the [MIT license](plugins/odin-memory/LICENSE).\n`;
  }
  const mode = appId
    ? `登録済み App ID: \`${appId}\`。この ID が自分の Odin アプリを指していることを確認してください。`
    : 'App ID は未指定です。MCP の OAuth 接続時に利用者ごとの認可が必要です。';
  return `# Odin Memory プラグイン\n\n接続先: \`${endpoint}\`\n\n${mode}\n\n生成コマンドは設定ファイルを作るだけです。プラグインの自動接続、OAuth 認可、外部公開、サーバーへの通信は行いません。URL を指定しただけでは ChatGPT への登録と OAuth 設定は完了しません。導入後、接続先 URL と登録 ID を確認し、必要な OAuth 認可を行ってください。\n\nCodex にローカル marketplace を登録する場合:\n\n\`\`\`sh\ncodex plugin marketplace add ${quoteShellPath(output)}\n\`\`\`\n\n\`odin-memory.zip\` には[MITライセンス](plugins/odin-memory/LICENSE)を含むプラグイン本体だけを収録しています。\n`;
}

/** Generate a private, reviewable plugin package without connecting to Odin or changing Codex settings. */
export async function generatePlugin({ url, appId, output, templateRoot, language } = {}) {
  language = validLanguage(language);
  const endpoint = endpointFrom(url, language);
  const registeredAppId = validAppId(appId, language);
  const destination = path.resolve(output ?? path.join(repoRoot, '.odin', 'plugin-package'));
  if (await exists(destination)) throw new Error(messages[language].existing);
  await rejectSymlinkAncestors(destination, language);

  let source = templateRoot ? path.resolve(templateRoot) : path.join(repoRoot, 'plugins', 'odin-memory');
  if (!templateRoot && !(await exists(source))) source = path.join(repoRoot, 'release', 'public-template', 'plugins', 'odin-memory');
  const { manifest, contents } = await readTemplate(source, language);
  const pluginManifest = { ...manifest, name: 'odin-memory', skills: './skills/' };
  delete pluginManifest.apps;
  delete pluginManifest.mcpServers;

  const pluginFiles = new Map();
  pluginFiles.set('skills/odin-memory/SKILL.md', contents.get('skills/odin-memory/SKILL.md'));
  pluginFiles.set('LICENSE', contents.get('LICENSE'));
  if (registeredAppId) {
    pluginManifest.apps = './.app.json';
    pluginFiles.set('.app.json', json({ apps: { odin: { id: registeredAppId } } }));
  } else {
    pluginManifest.mcpServers = './.mcp.json';
    pluginFiles.set('.mcp.json', json({ mcpServers: { odin: { type: 'http', url: endpoint } } }));
  }
  pluginFiles.set('.codex-plugin/plugin.json', json(pluginManifest));
  const portableManifest = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'odin-memory',
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    extensions: { 'com.openai': {
      interface: manifest.interface,
      ...(registeredAppId ? { apps: './.app.json' } : {}),
    } },
  };
  pluginFiles.set('plugin.json', json(portableManifest));
  if (!registeredAppId) pluginFiles.set('mcp.json', json({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { odin: { type: 'streamable-http', url: endpoint } } }));

  await mkdir(path.dirname(destination), { recursive: true });
  // Claim a new directory exclusively, including when another run wins a race.
  await mkdir(destination);
  const pluginRoot = path.join(destination, 'plugins', 'odin-memory');
  for (const [relative, content] of pluginFiles) {
    const target = path.join(pluginRoot, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
  }
  const marketplace = {
    name: 'odin-local', interface: { displayName: 'Odin' },
    plugins: [{ name: 'odin-memory', source: { source: 'local', path: './plugins/odin-memory' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
  };
  await mkdir(path.join(destination, '.agents', 'plugins'), { recursive: true });
  await writeFile(path.join(destination, '.agents', 'plugins', 'marketplace.json'), json(marketplace), { flag: 'wx' });
  await writeFile(path.join(destination, 'README.md'), readme(endpoint, registeredAppId, destination, language), { flag: 'wx' });
  const zipEntries = Object.fromEntries([...pluginFiles].map(([relative, content]) => [relative, strToU8(content)]));
  await writeFile(path.join(destination, 'odin-memory.zip'), zipSync(zipEntries, { level: 9 }), { flag: 'wx' });
  return { output: destination, endpoint, appId: registeredAppId, pluginRoot };
}

function parseArgs(args) {
  const options = {};
  const requestedLanguage = args.indexOf('--language');
  if (requestedLanguage !== -1) options.language = validLanguage(args[requestedLanguage + 1]);
  const message = messages[options.language ?? 'ja'];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--help' || token === '-h') return { help: true, language: options.language ?? 'ja' };
    const key = { '--url': 'url', '--app-id': 'appId', '--output': 'output', '--language': 'language' }[token];
    if (!key || (key !== 'language' && options[key] !== undefined) || (key === 'language' && i !== requestedLanguage) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(message.args);
    options[key] = args[++i];
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const language = validLanguage(options.language);
  const message = messages[language];
  if (options.help) { stdout.write(message.help); return; }
  if (!options.url) {
    if (!stdin.isTTY || !stdout.isTTY) throw new Error(`${message.tty}\n${message.help}`);
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      options.url = await prompt.question(message.urlPrompt);
      if (options.appId === undefined) options.appId = (await prompt.question(message.appPrompt)).trim() || undefined;
    } finally { prompt.close(); }
  }
  const result = await generatePlugin(options);
  stdout.write(message.success(result.output));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
