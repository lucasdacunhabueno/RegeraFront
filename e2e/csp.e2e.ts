import { expect, test } from '@playwright/test';
import { semViolacaoCsp } from './apoio';

// Prova que a CSP do Caddy está no ar e que o vigia dos outros specs enxerga uma violação: sem isso, "zero
// violações" neles não diria nada. Neste release a CSP está em observação (Content-Security-Policy-Report-Only,
// P4a-R15): o script inline executa, mas o evento `securitypolicyviolation` dispara do mesmo jeito. Quando o P4b
// ativar o header Content-Security-Policy, o script passa a ser bloqueado e o teste segue valendo.
test('a CSP pega script inline e o vigia registra a violação', async ({ page, context }) => {
  const csp = await semViolacaoCsp(context);
  const resposta = await page.goto('/login');
  const cabecalhos = resposta?.headers() ?? {};
  const bloqueia = 'content-security-policy' in cabecalhos;
  const politica = cabecalhos['content-security-policy'] ?? cabecalhos['content-security-policy-report-only'] ?? '';
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
  expect(executou).toBe(!bloqueia);
  await expect.poll(() => csp.registradas().some((v) => v.includes('script-src'))).toBe(true);
});
