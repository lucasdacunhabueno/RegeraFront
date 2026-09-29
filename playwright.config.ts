import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'https://localhost',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'celular',
      use: {
        ...devices['Pixel 7'],
        // Chromium recusa registrar service worker sobre certificado TLS inválido
        // (a CA interna do Caddy) mesmo com ignoreHTTPSErrors; esta flag resolve.
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
  ],
});
