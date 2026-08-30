# Frontend — Painel da Agência

Painel administrativo interno, construído em Next.js (App Router) consumindo
o backend Fastify existente. O backend continua sendo a única fonte de
regras de negócio e dados — este frontend não duplica lógica de domínio.

## Stack

Next.js · TypeScript · Tailwind CSS · shadcn/ui · React Hook Form · Zod ·
TanStack Query

## Como o frontend fala com o backend

O navegador **nunca** chama o backend diretamente. Toda a autenticação passa
por rotas internas em `app/api/auth/*` (login, logout, me), que funcionam
como uma camada BFF (_backend for frontend_):

1. O formulário de login envia e-mail/senha para `POST /api/auth/login`.
2. Essa rota chama `POST {NEXT_PUBLIC_API_URL}/auth/login` no backend.
3. O JWT retornado é gravado em um cookie **HttpOnly** — nunca chega ao
   JavaScript do navegador.
4. Páginas do painel e a rota `/api/auth/me` leem o cookie no servidor e
   chamam `GET /auth/me` no backend para validar a sessão.

Essa decisão evita dois problemas: o backend não expõe cabeçalhos CORS (uma
chamada direta do navegador falharia) e mantém o token fora do alcance de
XSS no cliente.

Veja `lib/api/client.ts`, `lib/auth/session.ts` e `lib/auth/dal.ts`.

## Rodando localmente (sem Docker)

```bash
cp .env.example .env.local
# ajuste NEXT_PUBLIC_API_URL para http://127.0.0.1:8000 se o backend
# estiver rodando fora do Docker também
npm install
npm run dev
```

## Rodando via Docker Compose

A partir da raiz do repositório:

```bash
docker compose up -d --build frontend
```

Acesse em <http://127.0.0.1:3000>.

## Scripts

```bash
npm run dev     # desenvolvimento
npm run build   # build de produção
npm run start   # sobe o build de produção
npm run lint    # eslint
```
