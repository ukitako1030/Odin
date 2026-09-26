/** Stdio bridge for MCP clients that launch a local command. */
import { createInterface } from 'node:readline';

const endpoint = process.env.ODIN_MCP_URL ?? 'http://127.0.0.1:3000/api/mcp';
const token = process.env.ODIN_API_TOKEN;
if (!token) { process.stderr.write('ODIN_API_TOKEN が必要です。\n'); process.exit(1); }
const url = new URL(endpoint);
if (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
  process.stderr.write('リモート MCP URL には HTTPS が必要です。\n'); process.exit(1);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let message: { id?: string | number; method?: string };
  try { message = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
  try {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: line });
    if (message.id === undefined) continue;
    if (!response.ok) throw new Error(`Gateway HTTP ${response.status}: ${await response.text()}`);
    if (response.status === 202) continue;
    const result = await response.text();
    if (result) process.stdout.write(result.trim() + '\n');
  } catch (error) {
    if (message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : 'Gateway unavailable' } }) + '\n');
  }
}
