# RegeraFront

Interface web (PWA, mobile-first) do **Regera**, sistema de gestão comercial da Ultragaz Energia Elétrica. Angular 22, consome a API do [RegeraServer](../RegeraServer). Em produção: `https://arc.dev.br`.

## Requisitos
- Node 24 e npm.
- Para rodar contra a API local: RegeraServer no ar em `http://localhost:8080`.

## Desenvolvimento
```bash
npm ci
npx ng serve            # http://localhost:4200, com proxy de /api para http://localhost:8080
```

O proxy está em `proxy.conf.json`.

## Testes e qualidade
```bash
npx ng test --watch=false   # testes unitários
npx ng lint                 # ESLint
npx ng build                # build de produção (dist/)
npm run e2e                 # Playwright (celular); precisa da stack local
```

O `npm run e2e` usa `https://localhost` por padrão (`E2E_BASE_URL` muda isso) e exige a stack local subida a partir de `RegeraServer/deploy` (Docker Compose com Postgres, server, front e Caddy), com o usuário admin local criado no primeiro boot.

## Deploy
O deploy roda pelo GitHub Actions a cada merge na `main` (imagem `ghcr.io/lucasdacunhabueno/regera-front:<sha>` publicada no VPS por `deploy.sh`). Passo a passo do primeiro deploy, restauração de backup e rollback: `RegeraServer/docs/runbooks/primeiro-deploy.md`.
