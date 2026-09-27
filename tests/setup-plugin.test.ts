import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { generatePlugin } from '../scripts/setup-plugin.mjs';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'odin-plugin-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const templateRoot = path.join(root, 'template');
  await mkdir(path.join(templateRoot, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(templateRoot, 'skills', 'odin-memory'), { recursive: true });
  await writeFile(path.join(templateRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'odin-memory', version: '0.1.0', description: 'Odin memory', author: { name: 'Odin' },
    interface: { displayName: 'Odin Memory' },
  }));
  await writeFile(path.join(templateRoot, 'skills', 'odin-memory', 'SKILL.md'), '# Odin memory\n');
  await writeFile(path.join(templateRoot, '.codex-plugin', 'plugin.en.json'), JSON.stringify({
    name: 'odin-memory', version: '0.1.0', description: 'Search and save your Odin records',
    author: { name: 'Odin' }, interface: { displayName: 'Odin Memory' },
  }));
  await writeFile(path.join(templateRoot, 'skills', 'odin-memory', 'SKILL.en.md'), '# Odin memory in English\n');
  await writeFile(path.join(templateRoot, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 Odin\n');
  return { root, templateRoot };
}

const parse = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

test('MCP package uses a canonical endpoint and ZIP contains only the plugin files', async (t) => {
  const { root, templateRoot } = await fixture(t);
  await writeFile(path.join(templateRoot, '.env.local'), 'SECRET=do-not-copy');
  await writeFile(path.join(templateRoot, 'private.txt'), 'do-not-copy');
  const output = path.join(root, 'package');
  const result = await generatePlugin({ url: 'https://odin.example', output, templateRoot });
  assert.equal(result.endpoint, 'https://odin.example/api/mcp');
  const plugin = result.pluginRoot;
  const legacy = await parse(path.join(plugin, '.codex-plugin', 'plugin.json'));
  const portable = await parse(path.join(plugin, 'plugin.json'));
  const mcp = await parse(path.join(plugin, '.mcp.json'));
  const portableMcp = await parse(path.join(plugin, 'mcp.json'));
  assert.equal(legacy.name, 'odin-memory');
  assert.equal(legacy.mcpServers, './.mcp.json');
  assert.equal(legacy.apps, undefined);
  assert.equal(mcp.mcpServers.odin.url, result.endpoint);
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(portable.name, 'odin-memory');
  assert.equal(portable.extensions['com.openai'].apps, undefined);
  assert.equal(portableMcp.mcpServers.odin.type, 'streamable-http');
  assert.equal(portableMcp.mcpServers.odin.url, result.endpoint);
  const archive = unzipSync(new Uint8Array(await readFile(path.join(output, 'odin-memory.zip'))));
  const paths = Object.keys(archive).sort();
  assert.deepEqual(paths, ['.codex-plugin/plugin.json', '.mcp.json', 'LICENSE', 'mcp.json', 'plugin.json', 'skills/odin-memory/SKILL.md'].sort());
  for (const relative of paths) assert.equal(strFromU8(archive[relative]), await readFile(path.join(plugin, relative), 'utf8'));
  assert.equal(await readFile(path.join(plugin, 'LICENSE'), 'utf8'), await readFile(path.join(templateRoot, 'LICENSE'), 'utf8'));
  const marketplace = await parse(path.join(output, '.agents', 'plugins', 'marketplace.json'));
  assert.equal(marketplace.name, 'odin-local');
  assert.equal(marketplace.plugins[0].source.path, './plugins/odin-memory');
  const guide = await readFile(path.join(output, 'README.md'), 'utf8');
  assert.match(guide, /ChatGPT.*OAuth/);
  assert.match(guide, /\(plugins\/odin-memory\/LICENSE\)/);
  assert.equal((await readdir(plugin)).includes('.env.local'), false);
});

test('registered App package preserves its ID and does not duplicate MCP configuration', async (t) => {
  const { root, templateRoot } = await fixture(t);
  const result = await generatePlugin({ url: 'https://odin.example/api/mcp', appId: 'plugin_asdk_app_AbC_123', output: path.join(root, 'package'), templateRoot });
  const plugin = result.pluginRoot;
  const legacy = await parse(path.join(plugin, '.codex-plugin', 'plugin.json'));
  const portable = await parse(path.join(plugin, 'plugin.json'));
  assert.equal(legacy.apps, './.app.json');
  assert.equal(legacy.mcpServers, undefined);
  assert.equal(portable.extensions['com.openai'].apps, './.app.json');
  assert.deepEqual(await parse(path.join(plugin, '.app.json')), { apps: { odin: { id: 'plugin_asdk_app_AbC_123' } } });
  const names = Object.keys(unzipSync(new Uint8Array(await readFile(path.join(result.output, 'odin-memory.zip')))));
  assert.ok(names.includes('.app.json'));
  assert.ok(names.includes('LICENSE'));
  assert.ok(!names.includes('.mcp.json') && !names.includes('mcp.json'));
});

test('English MCP package selects only English templates and keeps standard output names', async (t) => {
  const { root, templateRoot } = await fixture(t);
  await writeFile(path.join(templateRoot, 'secret.txt'), 'private-secret');
  const result = await generatePlugin({ url: 'https://odin.example', output: path.join(root, 'english'), templateRoot, language: 'en' });
  const legacy = await parse(path.join(result.pluginRoot, '.codex-plugin', 'plugin.json'));
  const portable = await parse(path.join(result.pluginRoot, 'plugin.json'));
  assert.equal(legacy.description, 'Search and save your Odin records');
  assert.equal(portable.description, legacy.description);
  assert.equal(legacy.mcpServers, './.mcp.json');
  assert.equal((await readFile(path.join(result.pluginRoot, 'skills', 'odin-memory', 'SKILL.md'), 'utf8')).trim(), '# Odin memory in English');
  const archive = unzipSync(new Uint8Array(await readFile(path.join(result.output, 'odin-memory.zip'))));
  assert.deepEqual(Object.keys(archive).sort(), ['.codex-plugin/plugin.json', '.mcp.json', 'LICENSE', 'mcp.json', 'plugin.json', 'skills/odin-memory/SKILL.md'].sort());
  assert.equal(strFromU8(archive.LICENSE), await readFile(path.join(templateRoot, 'LICENSE'), 'utf8'));
  assert.ok(!Object.values(archive).some((contents) => strFromU8(contents).includes('private-secret')));
  const guide = await readFile(path.join(result.output, 'README.md'), 'utf8');
  assert.match(guide, /Endpoint:.*https:\/\/odin\.example\/api\/mcp/);
  assert.match(guide, /\(plugins\/odin-memory\/LICENSE\)/);
});

test('English App package keeps App mode and English diagnostics', async (t) => {
  const { root, templateRoot } = await fixture(t);
  const result = await generatePlugin({ url: 'https://odin.example', appId: 'asdk_app_English', output: path.join(root, 'english-app'), templateRoot, language: 'en' });
  const legacy = await parse(path.join(result.pluginRoot, '.codex-plugin', 'plugin.json'));
  assert.equal(legacy.apps, './.app.json');
  assert.equal(legacy.mcpServers, undefined);
  assert.match(await readFile(path.join(result.output, 'README.md'), 'utf8'), /Registered App ID: `asdk_app_English`/);
  await assert.rejects(generatePlugin({ url: 'http://odin.example', language: 'en', templateRoot, output: path.join(root, 'bad-url') }), /public HTTPS origin/);
  await assert.rejects(generatePlugin({ url: 'https://odin.example', language: 'fr', templateRoot, output: path.join(root, 'bad-language') }), /Language must be ja or en/);
  await assert.rejects(lstat(path.join(root, 'bad-language')), { code: 'ENOENT' });
});

test('CLI shows English help and rejects an invalid language', () => {
  const script = path.resolve('scripts/setup-plugin.mjs');
  const help = execFileSync(process.execPath, [script, '--language', 'en', '--help'], { encoding: 'utf8' });
  assert.match(help, /^Usage:/);
  assert.match(help, /--language ja\|en/);
  assert.throws(() => execFileSync(process.execPath, [script, '--language', 'invalid'], { encoding: 'utf8', stdio: 'pipe' }), /Language must be ja or en/);
});

test('rejects unsafe URLs and IDs without echoing secret input', async (t) => {
  const { root, templateRoot } = await fixture(t);
  const urls = [
    'http://odin.example', 'https://token-secret@odin.example', 'https://odin.example/?token=secret',
    'https://odin.example/#secret', 'https://odin.example/admin/secret', 'https://localhost/api/mcp',
    'https://127.0.0.1/api/mcp', 'https://odin.example/api/%6dcp',
  ];
  for (const [i, url] of urls.entries()) {
    await assert.rejects(generatePlugin({ url, output: path.join(root, `bad-${i}`), templateRoot }), (error: Error) => {
      assert.doesNotMatch(error.message, /secret|token-secret/);
      return true;
    });
  }
  for (const appId of ['asdk_app_', 'plugin_asdk_app_', 'other_123', 'asdk_app_bad/secret', ' asdk_app_ok']) {
    await assert.rejects(generatePlugin({ url: 'https://odin.example', appId, output: path.join(root, `bad-id-${Math.random()}`), templateRoot }), /App ID/);
  }
});

test('rejects an existing output and symlink ancestor before writing anything', async (t) => {
  const { root, templateRoot } = await fixture(t);
  const existing = path.join(root, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'keep.txt'), 'unchanged');
  await assert.rejects(generatePlugin({ url: 'https://odin.example', output: existing, templateRoot }), /既に存在/);
  assert.equal(await readFile(path.join(existing, 'keep.txt'), 'utf8'), 'unchanged');
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  const link = path.join(root, 'link');
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(generatePlugin({ url: 'https://odin.example', output: path.join(link, 'package'), templateRoot }), /シンボリックリンク|ジャンクション/);
  assert.deepEqual(await readdir(outside), []);
});

test('concurrent generation claims the output once and leaves a complete archive', async (t) => {
  const { root, templateRoot } = await fixture(t);
  const options = { url: 'https://odin.example', output: path.join(root, 'package'), templateRoot };
  const outcomes = await Promise.allSettled([generatePlugin(options), generatePlugin(options)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
  const archive = unzipSync(new Uint8Array(await readFile(path.join(options.output, 'odin-memory.zip'))));
  assert.ok(archive['.codex-plugin/plugin.json']);
  assert.ok(archive.LICENSE);
  assert.ok(archive['plugin.json']);
  assert.ok(archive['skills/odin-memory/SKILL.md']);
  for (const [relative, data] of Object.entries(archive)) {
    assert.equal(strFromU8(data), await readFile(path.join(options.output, 'plugins', 'odin-memory', relative), 'utf8'));
  }
});

test('missing or linked LICENSE fails before creating output', async (t) => {
  const { root, templateRoot } = await fixture(t);
  const license = path.join(templateRoot, 'LICENSE');
  await rm(license);
  const missingOutput = path.join(root, 'missing-license');
  await assert.rejects(generatePlugin({ url: 'https://odin.example', output: missingOutput, templateRoot, language: 'en' }), /LICENSE/);
  await assert.rejects(lstat(missingOutput), { code: 'ENOENT' });
  const outside = path.join(root, 'outside-license');
  await writeFile(outside, 'private');
  await symlink(outside, license, 'file');
  const linkedOutput = path.join(root, 'linked-license');
  await assert.rejects(generatePlugin({ url: 'https://odin.example', output: linkedOutput, templateRoot }), /シンボリックリンク|ジャンクション/);
  await assert.rejects(lstat(linkedOutput), { code: 'ENOENT' });
});

test('README quotes shell metacharacters in the output path', async (t) => {
  const { root, templateRoot } = await fixture(t);
  const output = path.join(root, "package $`' name");
  await generatePlugin({ url: 'https://odin.example', output, templateRoot });
  const guide = await readFile(path.join(output, 'README.md'), 'utf8');
  const quoted = process.platform === 'win32'
    ? `'${output.replaceAll("'", "''")}'`
    : `'${output.replaceAll("'", "'\\''")}'`;
  assert.ok(guide.includes(`codex plugin marketplace add ${quoted}`));
});

test('rejects a linked template file and invalid URL before creating output', async (t) => {
  const { root, templateRoot } = await fixture(t);
  const skill = path.join(templateRoot, 'skills', 'odin-memory', 'SKILL.md');
  const source = path.join(root, 'outside.md');
  await writeFile(source, '# outside\n');
  await rm(skill);
  await symlink(source, skill, 'file');
  const linkedOutput = path.join(root, 'linked-output');
  await assert.rejects(generatePlugin({ url: 'https://odin.example', output: linkedOutput, templateRoot }), /シンボリックリンク|ジャンクション/);
  await assert.rejects(lstat(linkedOutput), { code: 'ENOENT' });

  const invalidOutput = path.join(root, 'invalid-output');
  await assert.rejects(generatePlugin({ url: 'https://odin.example/?secret=hidden', output: invalidOutput, templateRoot }), /HTTPS/);
  await assert.rejects(lstat(invalidOutput), { code: 'ENOENT' });
});
