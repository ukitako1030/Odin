import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: { command: 'npm run dev -- --port 3100', url: 'http://127.0.0.1:3100', timeout: 90000, reuseExistingServer: false,
    env: { ODIN_VAULT_DIR: resolve('.odin', 'e2e', String(Date.now())), ODIN_NEXT_DIST_DIR: '.next-e2e', ODIN_STORAGE: 'local', ODIN_SEED_EXAMPLES: '1', ODIN_OWNER_PASSWORD: '', ODIN_SESSION_SECRET: '', ODIN_API_TOKEN: '', ODIN_CODEX_IMPORT_ENABLED: '0' },
  },
});
