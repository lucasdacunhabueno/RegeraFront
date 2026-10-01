import { expect, test } from '@playwright/test';
import { semViolacaoCsp } from './apoio';

// Prova que a CSP do Caddy está aplicada (Content-Security-Policy, não Report-Only, desde o P4c — P4a-R15) e que o
// vigia dos outros specs enxerga uma violação: sem isso, "zero violações" neles não diria nada.
test('a CSP bloqueia script inline e o vigia registra a violação', async ({ page, context }) => {
  const csp = await semViolacaoCsp(context);
  const resposta = await page.goto('/login');
  const cabecalhos = resposta?.headers() ?? {};
  expect(cabecalhos['content-security-policy-report-only']).toBeUndefined();
  const politica = cabecalhos['content-security-policy'] ?? '';
  expect(politica).toContain("script-src 'self'");
  expect(politica).toContain("frame-ancestors 'none'");
  await expect(page.getByLabel('E-mail')).toBeVisible();
  expect(csp.registradas()).toEqual([]);

  const executou = await page.evaluate(() => {
    const w = window as unknown as { __inlineExecutou?: boolean };
    const script = document.createElement('script');
    script.textContent = 'window.__inlineExecutou = true;';
    document.body.appendChild(script);
    return w.__inlineExecutou === true;
  });
  expect(executou).toBe(false);
  await expect.poll(() => csp.registradas().some((v) => v.includes('script-src'))).toBe(true);
});
