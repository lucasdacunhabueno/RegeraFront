// Confere se o index.html do build respeita a CSP do Caddy (`script-src 'self'`, sem 'unsafe-inline'):
// nenhum <script> sem src, nenhum atributo de evento inline (onload=, onclick=...) e nenhuma URL javascript:.
// Uso: node scripts/checar-csp-index.mjs [caminho do index.html]
import { readFileSync } from 'node:fs';

const caminho = process.argv[2] ?? 'dist/regera-front/browser/index.html';
// o conteúdo de <style> pode ter qualquer coisa; só as tags interessam
const html = readFileSync(caminho, 'utf8').replace(
  /<style\b[^>]*>[\s\S]*?<\/style>/gi,
  '<style></style>',
);

const problemas = [];
for (const [tag] of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
  if (/^<script\b/i.test(tag) && !/\ssrc\s*=/i.test(tag)) problemas.push(`script inline: ${tag}`);
  if (/\son[a-z]+\s*=/i.test(tag)) problemas.push(`evento inline: ${tag}`);
  if (/=\s*["']?\s*javascript:/i.test(tag)) problemas.push(`URL javascript: ${tag}`);
}

if (problemas.length > 0) {
  console.error(`${caminho} viola a CSP (script-src 'self'):\n  ${problemas.join('\n  ')}`);
  process.exit(1);
}
console.log(`${caminho}: sem script inline, evento inline ou URL javascript:.`);
