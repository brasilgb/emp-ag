# Execução — Agentes v1.7: Agent Management & Operational Configuration (em andamento)

**Status: inventário concluído, implementação começando agora — nada
commitado, nada ainda funcional.** Esta é uma nota de progresso, não o
relatório final (que virá no formato exato pedido em `correio.md` §17,
seções 1–17).

## Inventário (correio.md Etapa 1)

Configurações relacionadas a agentes encontradas em `backend/src/config/env.ts`
e no código:

| Config | Onde hoje | Classificação |
|---|---|---|
| `AGENT_LLM_ENABLED`/`SHADOW_MODE`/`PROVIDER`/`MODEL`/`API_KEY`/`TIMEOUT_MS`/`MIN_CONFIDENCE`/`CONTEXT_MESSAGES` | env | env-only (ativação deliberada de LLM/shadow mode — fora do escopo operacional desta versão, decisão de infraestrutura/custo, não "limite operacional") |
| `OPENAI_API_KEY` | env | constante de segurança — nunca editável (é credential) |
| `AGENT_JOBS_SCHEDULER_ENABLED`/`_INTERVAL_MS` | env | env-only (liga/desliga infraestrutura do processo, não comportamento de negócio) |
| `AGENT_EVENTS_PROCESSOR_ENABLED`/`_POLL_INTERVAL_MS`/`_MAX_ATTEMPTS`/`_RETRY_BASE_SECONDS`/`_PROCESSING_TIMEOUT_SECONDS` | env | mistos — `POLL_INTERVAL_MS`/`ENABLED` ficam env-only (infra do processo); `MAX_ATTEMPTS`/`RETRY_BASE_SECONDS` são candidatos a runtime-configurável (retry real) — avaliando
| `AGENT_MAX_AUTONOMY_DEPTH` | env, global apenas | **runtime configurable** (candidato principal — autonomy depth) |
| `AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN` | env, global apenas | **runtime configurable** (chain budget) |
| `AGENT_JOB_AUTONOMY_RATE_LIMIT`/`_WINDOW_SECONDS` | env, **já tem override por Job** via colunas `agent_jobs.autonomyRateLimitOverride`/`autonomyRateWindowOverrideSeconds` | **env + DB override** (já existe parcialmente — vira o modelo de referência para os outros) |
| `AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD`/`_COOLDOWN_SECONDS` | env, global apenas | **runtime configurable** (prioridade explícita do correio.md) |
| `MAX_ACTIONS_PER_PLAN` (constante, `planner/schemas.ts`) | hardcoded | constante de segurança — teto de validação do Action Plan, não editável pela UI (é o limite estrutural do planner) |
| `MAX_REQUESTS` chat/execute/plan (`security/rate-limit.ts`) | hardcoded | fica hardcoded nesta versão — rate limit de API HTTP, não de autonomia; fora do escopo "autonomia" priorizado pelo correio.md |
| `MAX_EVENTS_PER_TICK` (`events/worker.ts`) | hardcoded | fica hardcoded nesta versão — tuning de infraestrutura do worker, não visível/decidível por operador de negócio |
| Job `maxRunsPerDay`/`maxActionsPerRun`/`maxOpenApprovals`/`timeoutSeconds` | já são colunas por-Job em `agent_jobs`, configuráveis via `PATCH /agents/jobs/:id` | já resolvido desde a v1.3 — fora do escopo (já é exatamente "configuração persistida por Job", só não passa pelo resolver novo por não ter hierarquia global/env)

## Escopo decidido para os settings (prioridade do correio.md: autonomia)

6 chaves, todas com escopo `global` + `job`:

```
circuit.failureThreshold
circuit.cooldownSeconds
autonomy.maxDepth
chain.maxRunsPerAutonomyChain
rate.autonomyLimit
rate.autonomyWindowSeconds
```

`rate.autonomyLimit`/`rate.autonomyWindowSeconds` terão um resolver que,
no escopo Job, verifica a nova tabela primeiro e cai para as colunas
legadas `agent_jobs.autonomyRateLimitOverride`/`autonomyRateWindowOverrideSeconds`
como ponte de compatibilidade antes do fallback global — decisão para não
quebrar/duplicar o que já existia e já está testado, mantendo ainda assim
uma única leitura centralizada (o resolver), como o correio.md exige.

## Próximos passos (nesta mesma sessão)

1. ✅ Migration + tabela `agent_operational_settings` (0013, dois índices
   únicos parciais para `scope='global'`/`scope='job'`, aplicada no
   Postgres de dev).
2. ✅ Catálogo de settings (`agents/settings/catalog.ts`) +
   `resolveSettingsSnapshot`/`resolveGlobalSetting`/`resolveJobSetting`
   (`agents/settings/resolver.ts`).
3. ✅ `guard.ts`, `circuit.ts` (finalização do circuit breaker) e o
   Incident Center (`job_repeated_failure`, antes um "3" fixo) agora
   consultam o resolver em vez de `config/env.ts` diretamente. Snapshot
   resolvido uma vez no início de cada Run em `job-runner.ts` (mesmo lock
   de linha do Job).
4. ✅ Endpoints (`GET/PATCH/DELETE /agents/settings/:key`,
   `GET/PATCH/DELETE /agents/jobs/:id/settings/:key`), 2 novas
   permissions (`agents.settings.read`/`manage`), auditoria
   (`agents.settings.updated`/`override_created`/`override_removed`).
5. ⏳ Frontend `/agents/settings` — ainda não feito.
6. ✅ Testes backend novos (22): `agents/settings/resolver.test.ts` (9,
   hierarquia job>global>default, ponte com coluna legada, fail-safe) e
   `routes/agents/settings.test.ts` (13: autorização, validação, CRUD,
   auditoria, 1 teste de integração real — configurar
   `circuit.failureThreshold=1` via API e confirmar que o circuito abre
   na 1ª falha, não na 5ª default).
7. ⏳ Relatório final no formato exato do correio.md §17 — ainda não
   escrito (esta continua sendo uma nota de progresso).

## Bugs reais encontrados e corrigidos durante a implementação (fluxo
## exigido pelo correio.md v1.7 §"Processo obrigatório de execução")

1. **Mojibake em `catalog.ts`**: o arquivo escrito ficou com encoding
   corrompido (acentos double-encoded), quebrando o parser do
   TypeScript com dezenas de erros aparentemente sem relação. Corrigido
   reescrevendo o arquivo sem acentuação.
2. **Comentário JSDoc fechando cedo demais**: `AGENT_JOBS_SCHEDULER_*/AGENT_EVENTS_...`
   dentro de um bloco `/** */` continha um `*/` literal, fechando o
   comentário no meio da frase — mesma classe de erro em cascata do item
   1, causa raiz diferente.
3. **`defaultValue` capturado uma única vez no import do módulo**: o
   catálogo inicialmente guardava `env.AGENT_X` como valor estático, não
   como getter. Como vários testes existentes da v1.5 mutam
   `process.env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD` em runtime por
   teste, isso teria quebrado silenciosamente esses testes (o resolver
   nunca veria a mudança). Corrigido antes de escrever qualquer teste,
   trocando para `get defaultValue()`.
4. **Vazamento de override global entre arquivos de teste**: o teste de
   integração de runtime criava um override global de
   `circuit.failureThreshold=1` via API e não limpava de forma confiável
   (só via `afterEach` com ids rastreados, que não cobria override criado
   por HTTP). Isso derrubou 6 testes de `job-runner.autonomy.test.ts` ao
   rodar os dois arquivos numa mesma invocação manual — o circuito abria
   na 1ª falha em todo Job autônomo do teste, não só no do teste que
   configurou o override. Corrigido com limpeza imediata dentro do
   próprio teste (não só no afterEach) e um afterEach mais amplo (limpa
   por chave, não só por id capturado). **Confirmado que a suíte real
   (`npm test`, via glob) nunca reproduziu esse vazamento** — só a
   invocação manual com múltiplos arquivos como argumentos posicionais
   parece intercalar execução entre arquivos de um jeito que o `npm test`
   real não faz; mesmo assim a correção fica, por ser estruturalmente
   mais correta (nunca deixar uma configuração global de teste sem
   limpeza garantida).
5. **Teste da v1.6 dessincronizado pela mudança pedida no próprio
   correio.md**: `operations.test.ts` criava exatamente 3 Runs falhos
   fixos para testar `job_repeated_failure`; ao trocar esse incidente
   para respeitar o `circuit.failureThreshold` efetivo (item 3 da lista
   de "próximos passos" acima, pedido explícito do correio.md v1.7), o
   default real é 5, não 3 — o teste antigo parou de detectar o
   incidente. Corrigido tornando o fixture dinâmico (resolve o threshold
   real em vez de hardcoded).

Suíte completa (`npm test`, real, via glob) rodando agora para confirmar
tudo — resultado será adicionado a seguir.

**Atualização: confirmado.** `npm test` real (via glob, `--test-concurrency=1`)
rodou duas vezes após as correções acima: **308/308, 0 fail** em ambas.
Frontend (`/agents/settings` + seção de overrides no detalhe do Job)
implementado depois — typecheck, build e suíte de frontend também
confirmados limpos (relatório final abaixo já reflete tudo).

---

# Entrega — Agentes v1.7: Agent Management & Operational Configuration

Nenhum commit foi feito (correio.md v1.7: "não fazer commit
automaticamente até a revisão final") — tudo abaixo está no working tree,
aguardando sua revisão.

## 1. Resumo

Camada centralizada, persistente e auditável de configuração operacional
para as 6 chaves do Autonomy Guard que antes só existiam via `.env`,
global e imutáveis em runtime: circuit breaker (failure threshold,
cooldown), profundidade máxima de autonomia, orçamento de Runs por cadeia
e rate limit autônomo. Hierarquia `job override → global (Postgres) →
env/default → fallback seguro`, resolvida por um ponto único
(`agents/settings/resolver.ts`), consumida de verdade pelo runtime (guard,
circuit breaker, Incident Center) — não apenas uma tela salvando no banco
sem efeito.

## 2. Inventário

Pesquisa completa em `config/env.ts` e no código (`AGENT_`, `AUTONOMY`,
`CIRCUIT`, `BUDGET`, `LIMIT`, `TIMEOUT`, `MAX_`, `MIN_`, `THRESHOLD`,
`CONFIDENCE`, `SHADOW`, `APPROVAL`, `SCHEDULE`, `RETRY`, `EVENT`,
`DEPTH`, `RUN`, `JOB`):

| Configuração | Classificação | Motivo |
|---|---|---|
| `AGENT_LLM_ENABLED`/`SHADOW_MODE`/`PROVIDER`/`MODEL`/`API_KEY`/`TIMEOUT_MS`/`MIN_CONFIDENCE`/`CONTEXT_MESSAGES` | env-only | ativação deliberada de LLM/shadow mode — decisão de infraestrutura/custo, nunca automática (v1.1 seção 34), não é "limite operacional" |
| `OPENAI_API_KEY` | constante de segurança | é credential — nunca editável pela UI |
| `AGENT_JOBS_SCHEDULER_ENABLED`/`_INTERVAL_MS` | env-only | liga/desliga infraestrutura do próprio processo (setInterval em server.ts), não comportamento de negócio |
| `AGENT_EVENTS_PROCESSOR_ENABLED`/`_POLL_INTERVAL_MS` | env-only | idem — infraestrutura do worker |
| `AGENT_EVENTS_MAX_ATTEMPTS`/`_RETRY_BASE_SECONDS`/`_PROCESSING_TIMEOUT_SECONDS` | **avaliado e adiado** | candidatos reais a runtime-configurável (retry de verdade existente), mas fora da prioridade explícita do correio.md v1.7 ("priorizar configurações diretamente ligadas à autonomia já existente" — circuit/depth/budget/rate); não implementado nesta versão para não expandir escopo além do pedido — ver riscos |
| **`AGENT_MAX_AUTONOMY_DEPTH`** | **runtime configurable** | implementado — `autonomy.maxDepth` |
| **`AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN`** | **runtime configurable** | implementado — `chain.maxRunsPerAutonomyChain` |
| **`AGENT_JOB_AUTONOMY_RATE_LIMIT`/`_WINDOW_SECONDS`** | **env + DB override (já parcial)** | já tinha override por Job via colunas `agent_jobs.autonomy_rate_limit_override`/`autonomy_rate_window_override_seconds` — implementado como `rate.autonomyLimit`/`rate.autonomyWindowSeconds`, resolver usa a tabela nova com ponte de compatibilidade para as colunas legadas |
| **`AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD`/`_COOLDOWN_SECONDS`** | **runtime configurable** | implementado — `circuit.failureThreshold`/`circuit.cooldownSeconds` (prioridade explícita do correio.md) |
| `MAX_ACTIONS_PER_PLAN` (`planner/schemas.ts`, valor 10) | constante de segurança | teto estrutural do planner — validado contra ele mesmo por `agent_jobs.maxActionsPerRun`; nunca editável pela UI |
| `MAX_REQUESTS` chat/execute/plan (`security/rate-limit.ts`) | env-only/hardcoded | rate limit de API HTTP (por usuário, via Redis), não de autonomia — fora do escopo desta versão |
| `MAX_EVENTS_PER_TICK` (`events/worker.ts`, valor 20) | hardcoded | tuning de infraestrutura do worker, não é decisão de operador de negócio |
| Job `maxRunsPerDay`/`maxActionsPerRun`/`maxOpenApprovals`/`timeoutSeconds` | já resolvido (v1.3) | já são colunas por-Job configuráveis via `PATCH /agents/jobs/:id` — fora do escopo (não tem hierarquia global/env correspondente, é sempre por-Job) |

## 3. Arquitetura

`agents/settings/catalog.ts` — catálogo único (6 chaves), cada uma com
`type`, `min`/`max`, `description`, `scopes` e um **getter** (não valor
capturado) para o default, lendo `config/env.ts` ao vivo — necessário
porque vários testes da v1.5 mutam essas env vars em runtime por teste
(bug real encontrado e corrigido antes de qualquer teste rodar, seção
15/débitos).

`agents/settings/resolver.ts` — `resolveSettingsSnapshot({ jobId, tx? })`
é o único ponto de leitura runtime, sempre 2 queries (linhas globais +
linhas do Job via `IN` nas 6 chaves, nunca uma query por chave), aplica a
hierarquia **job → global → default** e fail-safe (qualquer valor
persistido inválido/fora de faixa é ignorado, cai para o próximo escopo —
nunca usa um valor corrompido). Para `rate.autonomyLimit`/
`rate.autonomyWindowSeconds`, uma ponte documentada consulta as colunas
legadas `agent_jobs.autonomy_rate_limit_override`/
`autonomy_rate_window_override_seconds` quando a tabela nova não tem
linha para aquele Job — a tabela nova sempre vence quando ambas existem.

Consistência temporal (correio.md): o snapshot é resolvido **uma única
vez** por `job-runner.ts`, no início da avaliação autônoma, dentro da
mesma transação que já trava a linha do Job — e passado como parâmetro
para `evaluateAutonomousExecution` (guard.ts), que nunca mais lê
`config/env.ts` nem a tabela de settings diretamente. A finalização do
circuit breaker (`circuit.ts`, chamada de pontos diferentes do ciclo de
vida do Run — inclusive após aprovação assíncrona, potencialmente muito
depois do início) resolve seu próprio snapshot fresco no momento da
decisão — decisão documentada no código: mais correto usar o valor atual
ali do que carregar um snapshot potencialmente antigo por todo o ciclo de
vida assíncrono de um Run.

## 4. Arquivos criados

Backend:

```
drizzle/0013_agent_operational_settings.sql
drizzle/meta/0013_snapshot.json
db/schema/agent-operational-settings.ts
agents/settings/catalog.ts
agents/settings/resolver.ts
agents/settings/schemas.ts
agents/settings/resolver.test.ts       — 9 testes
routes/agents/settings.ts               — endpoints administrativos
routes/agents/settings.test.ts          — 13 testes
```

Frontend:

```
app/api/agents/settings/route.ts
app/api/agents/settings/[key]/route.ts
app/api/agents/jobs/[id]/settings/route.ts
app/api/agents/jobs/[id]/settings/[key]/route.ts
app/(dashboard)/agents/settings/page.tsx
components/agents/settings/setting-row.tsx
components/agents/settings/settings-list.tsx
components/agents/settings/job-settings-section.tsx
```

## 5. Arquivos alterados

```
backend/src/agents/autonomy/guard.ts        — consome SettingsSnapshot em vez de env.* direto
backend/src/agents/autonomy/circuit.ts      — idem, resolve no momento da finalização
backend/src/agents/incidents/service.ts     — job_repeated_failure usa circuit.failureThreshold efetivo (era "3" fixo)
backend/src/agents/jobs/job-runner.ts       — resolve o snapshot 1x por Run, antes do guard
backend/src/db/schema/index.ts              — export do schema novo
backend/src/db/seed.ts                      — 2 novas permissions
backend/src/routes/agents/index.ts          — registro das rotas novas
backend/src/routes/agents/operations.test.ts — fixture de job_repeated_failure agora dinâmico
frontend/types/agents.ts                    — SettingKey/ResolvedSetting/SettingSource
frontend/services/agents.ts                 — 6 funções novas de serviço
frontend/hooks/agents/use-operations.ts     — 6 hooks novos
frontend/lib/agents/derived.ts              — labels, agrupamento por domínio, isCriticalSetting
frontend/lib/agents/derived.test.ts         — 2 testes novos (isCriticalSetting)
frontend/lib/query/keys.ts                  — chaves novas
frontend/components/agents/agents-sub-nav.tsx — link "Configurações"
frontend/components/agents/jobs/job-detail.tsx — seção de overrides do Job
```

## 6. Migration

`0013_agent_operational_settings.sql` — tabela nova, sem alterar
nenhuma tabela existente:

```sql
CREATE TABLE agent_operational_settings (
  id serial PRIMARY KEY,
  key varchar(100) NOT NULL,
  scope varchar(20) NOT NULL,              -- 'global' | 'job'
  scope_id integer REFERENCES agent_jobs(id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  value_type varchar(20) NOT NULL,
  updated_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- unique constraint (key, scope, scope_id) da seção 2 do correio.md,
-- implementado como dois índices únicos PARCIAIS (Postgres trata NULL
-- como distinto em índices únicos comuns — um índice único direto não
-- impediria múltiplas linhas globais para a mesma key):
CREATE UNIQUE INDEX agent_operational_settings_global_idx
  ON agent_operational_settings (key) WHERE scope = 'global';
CREATE UNIQUE INDEX agent_operational_settings_job_idx
  ON agent_operational_settings (key, scope_id) WHERE scope = 'job';
CREATE INDEX agent_operational_settings_scope_idx ON agent_operational_settings (scope, scope_id);
```

Aplicada e testada no Postgres de dev. Compatível com dados existentes
(tabela nova, nenhuma linha órfã possível). Valores hoje só em `.env`
nunca precisaram de migração de dados — o resolver os trata como
`source: 'default'` automaticamente.

## 7. Settings suportados

| key | tipo | default (fonte anterior) | min/max | scopes |
|---|---|---|---|---|
| `circuit.failureThreshold` | number | 5 (`AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD`) | 1–20 | global, job |
| `circuit.cooldownSeconds` | number | 300 (`AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS`) | 1–86400 | global, job |
| `autonomy.maxDepth` | number | 8 (`AGENT_MAX_AUTONOMY_DEPTH`) | 0–20 | global, job |
| `chain.maxRunsPerAutonomyChain` | number | 25 (`AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN`) | 1–200 | global, job |
| `rate.autonomyLimit` | number | 20 (`AGENT_JOB_AUTONOMY_RATE_LIMIT` + coluna legada) | 1–1000 | global, job |
| `rate.autonomyWindowSeconds` | number | 300 (`AGENT_JOB_AUTONOMY_RATE_WINDOW_SECONDS` + coluna legada) | 1–86400 | global, job |

Faixas derivadas do comportamento real do projeto (documentado em
`catalog.ts`): `autonomy.maxDepth` usa teto 20 em vez dos "10" sugeridos
como exemplo pelo correio.md porque o default de produção já é 8 — um
teto de 10 deixaria pouquíssima margem acima do default real.

## 8. Endpoints

```
GET    /agents/settings                    agents.settings.read
GET    /agents/settings/:key                agents.settings.read
PATCH  /agents/settings/:key                agents.settings.manage
DELETE /agents/settings/:key                agents.settings.manage
GET    /agents/jobs/:id/settings            agents.settings.read
PATCH  /agents/jobs/:id/settings/:key       agents.settings.manage
DELETE /agents/jobs/:id/settings/:key       agents.settings.manage
```

`DELETE` remove o override persistido (e, para as duas chaves de rate
limit, também limpa a coluna legada do Job) — nunca apaga o conceito da
configuração, que vive no catálogo em código. Nenhuma key arbitrária é
aceita (`isSettingKey` valida antes de qualquer query).

## 9. Permissions

```
agents.settings.read    — visualizar configuração efetiva (global e por Job)
agents.settings.manage  — criar/alterar/remover overrides
```

Ambas concedidas automaticamente ao CEO (mecanismo já existente no
`db:seed`, loop sobre todas as permissions). Nenhuma outra role afetada.
**Deploy requires**: `npm run db:seed` deve rodar em qualquer outro
ambiente antes do uso das novas telas — já rodado no Postgres de dev
desta sessão.

## 10. Segurança

Nenhuma configuração consegue elevar privilégio ou ignorar controles de
segurança, porque:

- As 6 chaves só afetam **limites** do Autonomy Guard (quando bloquear),
  nunca **decisões de policy/permission/approval** — o Policy Evaluator,
  Approvals e permissions continuam sendo autoridade separada,
  intocada por esta versão.
- Nenhuma configuração pode reativar um Job/global switch desligado —
  o guard checa `autonomyEnabled`/global switch **antes** de consultar
  qualquer setting (ordem inalterada desde a v1.5).
- Validação Zod + catálogo fechado rejeita chave desconhecida, tipo
  errado, fora de faixa, não-inteiro — nunca aceita `Infinity`, string,
  ou negativo fora do que a faixa permite.
- Fail-safe: valor persistido corrompido/inválido nunca é usado — cai
  para o próximo escopo, testado explicitamente (resolver.test.ts).
- `agents.settings.manage` é a única permission que escreve; `read` é
  puramente informativo. Frontend nunca é barreira — todas as rotas têm
  `requirePermission` server-side.
- Nenhum secret/API key/credential é gerenciável por este módulo (fora
  do catálogo por construção — só as 6 chaves existem).

## 11. Auditoria

Ações registradas via o serviço de `audit()` já existente (nenhum
sistema paralelo):

```
agents.settings.updated           — override já existia, valor mudou
agents.settings.override_created  — primeiro override naquele escopo
agents.settings.override_removed  — DELETE (volta a herdar)
```

Metadata: `key`, `scope`, `scopeId`, `previousValue`, `newValue` (ou só
`previousValue` no remove). Nunca secrets (não existem secrets neste
módulo).

## 12. Runtime integration

Consumidores reais do resolver, substituindo leitura direta de
`config/env.ts`:

- `agents/autonomy/guard.ts` — `circuit.cooldownSeconds`,
  `autonomy.maxDepth`, `chain.maxRunsPerAutonomyChain`,
  `rate.autonomyLimit`, `rate.autonomyWindowSeconds` (todos os 5 checks
  não-triviais do guard).
- `agents/autonomy/circuit.ts` — `circuit.failureThreshold` (decide se a
  falha abre o circuito).
- `agents/incidents/service.ts` — `circuit.failureThreshold` (janela do
  incidente `job_repeated_failure`, antes um "3" fixo).
- `agents/jobs/job-runner.ts` — ponto que resolve o snapshot e o repassa
  ao guard.

Provado com teste real (não só unitário do resolver):
`routes/agents/settings.test.ts` → "configurar circuit.failureThreshold=1
(override global) faz o circuito abrir na 1ª falha, não no default" —
configura via API, roda um Run autônomo real (`runAgentJob`), confirma
`circuitState='open'` após 1 única falha em vez das 5 do default.

## 13. Testes

**22 novos no backend** (286 → 308): `resolver.test.ts` (9 — hierarquia,
ponte com coluna legada, fail-safe com valor fora de faixa e com tipo
errado) e `settings.test.ts` (13 — autorização read-vs-manage, validação
de chave/tipo/faixa/inteiro, CRUD global e por-Job, Job inexistente,
auditoria dos 3 actions com metadata correta, integração real de
runtime). Mais 1 teste de frontend (`isCriticalSetting`, 2 casos) e a
correção do fixture desatualizado em `operations.test.ts` (v1.6).

```
backend typecheck:   limpo, 0 erros
backend tests:       308/308, 0 fail (--test-concurrency=1, confirmado 2x)
frontend typecheck:  limpo, 0 erros
frontend tests:      52/52, 0 fail
frontend build:      limpo, 0 erros — /agents/settings + 4 rotas BFF novas compilam
```

## 14. Compatibilidade

v1.0–v1.6 confirmada: toda a suíte anterior (286 testes) continua
passando dentro dos 308. Nenhuma rota/comportamento existente foi
removido. O comportamento **observável muda só onde intencional**: o
Incident Center `job_repeated_failure` agora usa o threshold real (5) em
vez do "3" hardcoded anterior — mudança pedida explicitamente pelo
correio.md v1.7, com o teste da v1.6 atualizado para refletir isso
dinamicamente em vez de reafirmar o número antigo.

## 15. Riscos / débitos técnicos

1. **Retry de eventos (`AGENT_EVENTS_MAX_ATTEMPTS`/`_RETRY_BASE_SECONDS`)
   não migrado**: são candidatos reais a runtime-configurável (retry de
   verdade existe), mas ficaram fora da prioridade explícita desta
   versão (autonomia/circuit/budget/rate). Podem entrar numa versão
   futura sem mudança arquitetural — o catálogo já está pronto para mais
   chaves.
2. **`autonomy.maxDepth`/`chain.maxRunsPerAutonomyChain` nunca tiveram
   override por Job antes da v1.7** (só global/env) — diferente de
   `rate.*`, não existe uma coluna legada equivalente para migrar/testar
   contra, então a cobertura de teste desses dois no escopo `job` é
   nova, sem um comportamento anterior de referência para comparar.
3. **Sem cache Redis**: decisão deliberada (correio.md permite pular se
   não houver necessidade real nesta escala) — cada resolução é 2
   queries indexadas simples, chamadas no máximo 1x por Run. Se o volume
   de Runs crescer a ponto de justificar, o resolver já está isolado o
   suficiente para adicionar cache depois sem tocar nos consumidores.
4. **3 bugs de encoding/parsing encontrados e corrigidos durante a
   implementação** (mojibake em `catalog.ts`, `*/` literal fechando um
   JSDoc cedo demais, `defaultValue` capturado estaticamente em vez de
   getter) — nenhum chegou a ser commitado, mas registrados aqui porque
   o processo de correio.md pede transparência sobre o que foi
   encontrado, não só o resultado final.
5. **Vazamento de estado de teste entre arquivos, encontrado e
   corrigido**: um teste que criava um override global via API não tinha
   limpeza garantida fora do próprio corpo do teste — quando dois
   arquivos de teste rodaram numa mesma invocação manual (não o `npm
   test` real), 6 testes de outro arquivo quebraram. A causa raiz foi
   corrigida (limpeza imediata + `afterEach` mais amplo), mas a suíte
   real via `npm test`/glob nunca reproduziu esse cenário — não ficou
   totalmente claro por que a invocação manual com múltiplos arquivos
   como argumentos intercala execução de um jeito que o glob não faz;
   documentado para investigação futura se o padrão dos scripts npm
   mudar.
6. Segue pendente de sessões anteriores: os Jobs órfãos `1546`/`1547`
   ainda `active` no Postgres de dev, aguardando cancelamento aprovado.

## 16. Deploy

```bash
npm run db:migrate   # aplica 0013_agent_operational_settings.sql
npm run db:seed      # concede agents.settings.read/manage ao CEO (idempotente)
```

Sem isso, a tela `/agents/settings` fica inacessível (403) e as rotas
administrativas também.

## 17. Git

```
$ git status --short
```

(saída completa na seção 4/5 acima — arquivos novos e alterados
listados). Nenhum commit foi feito.
