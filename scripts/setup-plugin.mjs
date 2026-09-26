import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { zipSync, strToU8 } from 'fflate';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedTemplateFiles = ['.codex-plugin/plugin.json', 'skills/odin-memory/SKILL.md'];
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function endpointFrom(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('HTTPS の Odin URL を指定してください。');
  let parsed;
  try { parsed = new URL(input); } catch { throw new Error('Odin URL の形式が正しくありません。'); }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.pathname !== '/' && parsed.pathname !== '/api/mcp') ||
      hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' ||
      hostname === '[::1]' || hostname === '::1' || !hostname.includes('.')) {
    throw new Error('HTTPS の公開 origin または /api/mcp の URL を指定してください。');
  }
  return `${parsed.origin}/api/mcp`;
}

function validAppId(input) {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'string' || !/^(?:plugin_)?asdk_app_[A-Za-z0-9_-]+$/.test(input)) {
    throw new Error('App ID は asdk_app_ または plugin_asdk_app_ で始まる有効な ID を指定してください。');
  }
  return input;
}

async function exists(target) {
  try { return await lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function rejectSymlinkAncestors(target) {
  let current = path.resolve(target);
  while (true) {
    const stat = await exists(current);
    if (stat?.isSymbolicLink()) throw new Error('出力先にシンボリックリンクまたはジャンクションを含められません。');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function readTemplate(templateRoot) {
  const contents = new Map();
  for (const relative of allowedTemplateFiles) {
    const target = path.join(templateRoot, ...relative.split('/'));
    await rejectSymlinkAncestors(target);
    const stat = await exists(target);
    if (!stat?.isFile()) throw new Error(`テンプレートの必須ファイルがありません: ${relative}`);
    contents.set(relative, await readFile(target, 'utf8'));
  }
  let manifest;
  try { manifest = JSON.parse(contents.get(allowedTemplateFiles[0])); }
  catch { throw new Error('テンプレートの plugin.json が不正です。'); }
  if (!manifest || manifest.name !== 'odin-memory' || Array.isArray(manifest) || typeof manifest !== 'object') {
    throw new Error('テンプレートの plugin.json は name が odin-memory である必要があります。');
  }
  return { manifest, contents };
}

function quoteShellPath(target) {
  if (process.platform === 'win32') return `'${target.replaceAll("'", "''")}'`;
  return `'${target.replaceAll("'", "'\\''")}'`;
}

function readme(endpoint, appId, output) {
  const mode = appId
    ? `登録済み App ID: \`${appId}\`。この ID が自分の Odin アプリを指していることを確認してください。`
    : 'App ID は未指定です。MCP の OAuth 接続時に利用者ごとの認可が必要です。';
  return `# Odin Memory プラグイン\n\n接続先: \`${endpoint}\`\n\n${mode}\n\n生成コマンドは設定ファイルを作るだけです。プラグインの自動接続、OAuth 認可、外部公開、サーバーへの通信は行いません。URL を指定しただけでは ChatGPT への登録と OAuth 設定は完了しません。導入後、接続先 URL と登録 ID を確認し、必要な OAuth 認可を行ってください。\n\nCodex にローカル marketplace を登録する場合:\n\n\`\`\`sh\ncodex plugin marketplace add ${quoteShellPath(output)}\n\`\`\`\n\n\`odin-memory.zip\` にはプラグイン本体だけを収録しています。\n`;
}

/** Generate a private, reviewable plugin package without connecting to Odin or changing Codex settings. */
export async function generatePlugin({ url, appId, output, templateRoot } = {}) {
  const endpoint = endpointFrom(url);
  const registeredAppId = validAppId(appId);
  const destination = path.resolve(output ?? path.join(repoRoot, '.odin', 'plugin-package'));
  if (await exists(destination)) throw new Error('出力先は既に存在します。新しいディレクトリを指定してください。');
  await rejectSymlinkAncestors(destination);

  let source = templateRoot ? path.resolve(templateRoot) : path.join(repoRoot, 'plugins', 'odin-memory');
  if (!templateRoot && !(await exists(source))) source = path.join(repoRoot, 'release', 'public-template', 'plugins', 'odin-memory');
  const { manifest, contents } = await readTemplate(source);
  const pluginManifest = { ...manifest, name: 'odin-memory', skills: './skills/' };
  delete pluginManifest.apps;
  delete pluginManifest.mcpServers;

  const pluginFiles = new Map();
  pluginFiles.set('skills/odin-memory/SKILL.md', contents.get('skills/odin-memory/SKILL.md'));
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
  await writeFile(path.join(destination, 'README.md'), readme(endpoint, registeredAppId, destination), { flag: 'wx' });
  const zipEntries = Object.fromEntries([...pluginFiles].map(([relative, content]) => [relative, strToU8(content)]));
  await writeFile(path.join(destination, 'odin-memory.zip'), zipSync(zipEntries, { level: 9 }), { flag: 'wx' });
  return { output: destination, endpoint, appId: registeredAppId, pluginRoot };
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--help' || token === '-h') return { help: true };
    const key = { '--url': 'url', '--app-id': 'appId', '--output': 'output' }[token];
    if (!key || options[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('引数が正しくありません。--help で使い方を確認してください。');
    options[key] = args[++i];
  }
  return options;
}

const help = '使い方: npm run setup:plugin -- --url https://your-odin.example [--app-id asdk_app_...|plugin_asdk_app_...] [--output DIRECTORY]\n引数なしでは対話形式で入力します。\n';
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { stdout.write(help); return; }
  if (Object.keys(options).length === 0) {
    if (!stdin.isTTY || !stdout.isTTY) throw new Error(`対話入力には TTY が必要です。\n${help}`);
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      options.url = await prompt.question('Odin の HTTPS URL: ');
      options.appId = (await prompt.question('登録済み App ID（任意、Enter で省略）: ')).trim() || undefined;
    } finally { prompt.close(); }
  }
  const result = await generatePlugin(options);
  stdout.write(`プラグインを生成しました: ${result.output}\nREADME.md で接続先と導入手順を確認してください。\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
