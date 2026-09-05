# Empresa Agentes

Sistema interno da agência: CRM, projetos, financeiro, suporte, customer
success e um módulo de agentes de IA (roteador determinístico + LLM
Interpreter opcional em shadow mode), com automações via n8n.

Este documento é o guia oficial para instalar e rodar o projeto do zero em
uma máquina nova (dev ou um servidor novo). Para detalhes mais profundos,
veja também:

- [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) — visão geral da infraestrutura
- [docs/VERSIONS.md](docs/VERSIONS.md) — versões fixadas de cada componente
- [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) — estratégia completa de backup/restore

> **Nunca coloque segredos reais neste README.** Toda credencial fica em
> `.env` (fora do Git — veja `.gitignore`), nunca em código ou documentação.

---

## 1. Pré-requisitos

| Ferramenta | Versão mínima | Verificar com |
|---|---|---|
| Docker Engine | 24+ | `docker --version` |
| Docker Compose (plugin) | v2+ | `docker compose version` |
| Git | qualquer recente | `git --version` |

Não é necessário instalar Node.js, PostgreSQL ou Redis na máquina — tudo
roda em containers. Node só é útil localmente se você for editar código
fora do Docker (o `backend` fixa Node 24.20.0, o `frontend` também).

Portas usadas no host (precisam estar livres):

| Porta | Serviço |
|---|---|
| `3300` | Frontend (Next.js) |
| `8300` | Backend (API) |
| `5679` | n8n |

PostgreSQL (`5432`) e Redis (`6379`) **não** são expostos no host — só
acessíveis entre containers, na rede interna `agencia-network`.

---

## 2. Clonar o repositório

```bash
git clone <url-do-repositorio> empresa-agentes
cd empresa-agentes
```

---

## 3. Configurar variáveis de ambiente (`.env`)

O projeto usa um único `.env` na raiz, lido pelo `docker-compose.yml`.
Nunca existe um `.env` versionado — copie o exemplo e preencha:

```bash
cp .env.example .env
```

Abra `.env` e preencha pelo menos:

- `POSTGRES_PASSWORD` — senha do Postgres. Gere com `openssl rand -hex 24`.
- `N8N_ENCRYPTION_KEY` — chave de criptografia do n8n. Gere com `openssl rand -hex 32`.
  **Depois de gerada, nunca troque** em um ambiente que já tenha credenciais
  salvas no n8n (elas ficam ilegíveis sem a chave original).
- `JWT_SECRET` — assina os tokens de sessão do backend. Gere com `openssl rand -hex 48`.
- `CEO_NAME` / `CEO_EMAIL` / `CEO_PASSWORD` — usuário inicial criado pelo
  seed (vira o usuário com todas as permissões). `CEO_PASSWORD` precisa ter
  pelo menos 12 caracteres.

Todo o resto (`JWT_EXPIRES_IN`, `NEXT_PUBLIC_API_URL`, as variáveis
`AGENT_LLM_*`) já tem um default seguro e funcional — só mexa se souber o
que está fazendo. Os comentários dentro de `.env.example` explicam cada
uma.

O LLM Interpreter (seção "Agentes v1.1" do `.env.example`) é **opcional**:
com `AGENT_LLM_ENABLED=false` (default) o sistema roda exatamente igual,
sem nenhuma chamada a LLM. Só ative se quiser medir o roteador
determinístico contra um LLM em modo shadow (nunca altera respostas —
veja `correio.md` seções 10/12).

---

## 4. Subir a infraestrutura base (Postgres + Redis)

```bash
docker compose up -d postgres redis
```

Aguarde os dois ficarem `healthy`:

```bash
docker compose ps
```

---

## 5. Rodar as migrations

As migrations (Drizzle) rodam num container auxiliar (`migrate`, perfil
`tools`) que monta o código do backend e tem acesso ao Postgres:

```bash
docker compose run --rm migrate npm run db:migrate
```

Isso cria/atualiza todas as tabelas do banco `agencia`.

---

## 6. Rodar o seed inicial

Cria a role CEO (com todas as permissões), o catálogo de permissões, os
agentes/tools padrão e o primeiro usuário (`CEO_EMAIL`/`CEO_PASSWORD` do
`.env`):

```bash
docker compose run --rm migrate npm run db:seed
```

É seguro rodar de novo — o seed é idempotente (não duplica dados já
existentes).

---

## 7. Build e subida do backend, frontend e n8n

```bash
docker compose up -d --build backend frontend n8n
```

Isso builda as imagens de produção (`backend/Dockerfile` e
`frontend/Dockerfile`) e sobe os três serviços. Acompanhe até todos
ficarem saudáveis:

```bash
docker compose ps
```

Esperado:

```text
agencia-postgres   healthy
agencia-redis      healthy
agencia-backend    healthy
agencia-frontend   healthy
agencia-n8n        Up
```

Para subir tudo de uma vez (infra + build de todos os serviços) em vez de
passo a passo:

```bash
docker compose up -d --build
```

(o container `migrate` não sobe nesse comando — ele só roda sob demanda,
via `docker compose run --rm migrate ...`, por estar no perfil `tools`.)

---

## 8. URLs de acesso

| Serviço | URL |
|---|---|
| Frontend (app) | http://localhost:3300 |
| Backend (API) | http://localhost:8300 |
| n8n | http://localhost:5679 |

Login inicial: use `CEO_EMAIL`/`CEO_PASSWORD` definidos no `.env`.

---

## 9. Healthcheck

Cada serviço principal expõe um endpoint de saúde, já usado pelo
`healthcheck` do próprio Docker Compose:

```bash
curl -sf http://localhost:8300/health   # backend
curl -sf http://localhost:3300/api/health  # frontend
```

Ambos devem responder `200` com um JSON simples. Status de todos os
containers:

```bash
docker compose ps
```

---

## 10. Testes

### Backend

```bash
docker compose run --rm migrate npm run typecheck
docker compose run --rm migrate npm run build
docker compose run --rm migrate npm test
```

(precisa do seed já rodado — vários testes fazem login com
`CEO_EMAIL`/`CEO_PASSWORD`, e alguns dependem de dados/permissões
criados por ele.)

### Frontend

```bash
cd frontend
npm ci
npm run typecheck    # tsc --noEmit
npm test             # tsx --test
npm run lint
```

### Smoke test manual do LLM Interpreter (shadow mode)

Com `AGENT_LLM_ENABLED=true` no `.env` e o backend recarregado
(`docker compose up -d --build backend`), há um script pronto que dispara
perguntas reais contra `POST /agents/chat` e compara determinístico vs
LLM:

```bash
./scripts/run-shadow-manual-tests.sh
```

---

## 11. Parar e reiniciar

Parar todos os serviços (mantém volumes/dados):

```bash
docker compose stop
```

Reiniciar:

```bash
docker compose start
```

Parar e remover os containers (ainda **mantém** os volumes nomeados —
dados do Postgres/Redis/n8n sobrevivem):

```bash
docker compose down
```

Reaplicar depois de mudar código (rebuild + recriar só o necessário):

```bash
docker compose up -d --build backend frontend
```

Reiniciar um único serviço:

```bash
docker compose restart backend
```

Logs (últimas 100 linhas, ou em tempo real com `-f`):

```bash
docker compose logs --tail=100 backend
docker compose logs -f
```

---

## 12. Cuidados com volumes

Os dados que importam vivem em três volumes Docker nomeados:

```text
postgres_data   → bancos "agencia" e "n8n"
redis_data      → cache/estado do Redis (rate limiting, sessões auxiliares)
n8n_data        → configurações e credenciais do n8n
```

**Nunca rode `docker compose down -v` em um ambiente com dados reais** —
essa flag apaga os volumes junto com os containers, ou seja, apaga o
banco de dados e as automações do n8n de forma irreversível. Se
precisar remover tudo mesmo assim, garanta primeiro um backup válido
(seção 13).

> `docker compose down` (sem `-v`) é seguro — remove só os containers, os
> volumes continuam intactos.

Listar volumes existentes / inspecionar um volume específico:

```bash
docker volume ls
docker volume inspect empresa-agentes_postgres_data
```

Lembre-se também: **volume Docker não é backup** (pode ser perdido por
corrupção de disco, exclusão acidental do volume, perda do servidor
etc.) — trate-o como o estado corrente da aplicação, não como proteção
contra desastre. Backups reais e externos ficam fora do Docker (seção
13).

---

## 13. Backup e restore

Guia completo, com scripts prontos e checklists: **[docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md)**.

Resumo rápido — backup do PostgreSQL (bancos `agencia` e `n8n`):

```bash
./scripts/backup-postgres.sh
```

Gera dumps com timestamp em `backups/postgres/` (esse diretório nunca é
versionado — está no `.gitignore`). Validar o dump mais recente antes de
confiar nele:

```bash
./scripts/test-restore.sh
```

Restore real (passo a passo, com backup de segurança do estado atual
antes de sobrescrever nada) está detalhado em
[docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md#13-restore-do-banco-principal).

O `.env` e o `N8N_ENCRYPTION_KEY` também precisam de cópia segura fora do
servidor — sem eles, um restore do banco n8n recupera os dados mas não as
credenciais salvas (seção 19 do guia de backup).

---

## 14. Estrutura do projeto

```text
empresa-agentes/
├── backend/           # API (Fastify + Drizzle ORM + PostgreSQL)
├── frontend/          # Next.js (App Router)
├── n8n/workflows/      # Automações exportadas do n8n
├── docker/postgres/    # init.sql (cria o banco "n8n" adicional)
├── docs/                # Documentação de infraestrutura/backup
├── scripts/             # Backup, teste de restore, smoke test do LLM
├── backups/             # Saída dos backups (gitignored)
├── docker-compose.yml
├── .env.example          # Modelo de configuração — copie para .env
└── .env                  # Configuração real (gitignored, nunca commitar)
```

---

## 15. Variáveis de ambiente — referência rápida

Lista completa e comentada em [.env.example](.env.example). Resumo:

| Variável | Obrigatória? | Descrição |
|---|---|---|
| `POSTGRES_PASSWORD` | sim | Senha do Postgres (bancos `agencia` e `n8n`) |
| `N8N_ENCRYPTION_KEY` | sim | Criptografa credenciais salvas no n8n |
| `JWT_SECRET` | sim | Assina os tokens de sessão do backend |
| `JWT_EXPIRES_IN` | não (default `8h`) | Validade do token de sessão |
| `CEO_NAME` / `CEO_EMAIL` / `CEO_PASSWORD` | sim | Usuário inicial criado pelo seed |
| `NEXT_PUBLIC_API_URL` | não (default aponta pro serviço `backend`) | URL do backend usada pelo frontend |
| `AGENT_LLM_ENABLED` | não (default `false`) | Liga o LLM Interpreter (shadow/fallback) |
| `AGENT_LLM_SHADOW_MODE` | não (default `true`) | `true` = só mede, nunca decide a resposta |
| `AGENT_LLM_PROVIDER` | não (default `gemini`) | `gemini` ou `openai` |
| `AGENT_LLM_MODEL` | não | Nome do modelo do provider escolhido |
| `AGENT_LLM_API_KEY` | só se `AGENT_LLM_PROVIDER=gemini` | Key do Gemini |
| `OPENAI_API_KEY` | só se `AGENT_LLM_PROVIDER=openai` | Key da OpenAI |
| `AGENT_LLM_TIMEOUT_MS` | não (default `5000`) | Timeout da chamada ao LLM |
| `AGENT_LLM_MIN_CONFIDENCE` | não (default `0.80`) | Confiança mínima para considerar a resposta do LLM |
| `AGENT_LLM_CONTEXT_MESSAGES` | não (default `10`) | Nº de mensagens de contexto enviadas ao LLM |

---

## 16. Problemas comuns

- **`docker compose ps` mostra `unhealthy` no backend**: veja os logs
  (`docker compose logs backend`) — geralmente é `DATABASE_URL`/migrations
  não aplicadas ainda (rode a seção 5) ou `.env` incompleto.
- **Login falha logo após subir tudo**: confirme que o seed (seção 6) foi
  executado — sem ele não existe nenhum usuário no banco.
- **`429` em `/agents/chat`**: rate limit de 30 requisições/60s por
  usuário (`agents/security/rate-limit.ts`) — espere um minuto ou, em
  ambiente de teste, limpe a chave no Redis: `docker exec agencia-redis
  redis-cli DEL agents:ratelimit:chat:<userId>`.
- **Erro do provider LLM (Gemini/OpenAI)**: com `AGENT_LLM_ENABLED=true`,
  qualquer falha do provider (quota, credenciais, HTTP) fica registrada em
  `agent_interpretations` — nunca derruba `/agents/chat` nem altera a
  resposta determinística (seção 12/13 de `correio.md`). Consulte
  `GET /agents/interpreter/stats` (autenticado) para ver o resumo por
  tipo de erro.
