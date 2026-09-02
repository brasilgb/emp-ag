# Execução — Agentes v1.5: correção de flakiness na suíte de testes

## Causa raiz

A suíte de testes do backend (`node:test`, 25 arquivos) roda em paralelo
por padrão. Vários arquivos compartilham estado global real no mesmo
Postgres — a fila `agent_events` e a linha do global autonomy switch em
`settings` não são isoladas por arquivo. Alguns testes (`event-rules.test.ts`,
`event-processor.test.ts`, `job-runner.autonomy.test.ts`) já documentavam
esse risco em comentários próprios, com mitigação parcial (cleanup por
`afterEach`, Jobs criados `paused`) que reduzia mas não eliminava a janela
de corrida entre arquivos concorrentes — causando falhas intermitentes
(2-3 testes, sempre em `event-processor.test.ts`, variando a cada rodada)
sem qualquer regressão real no código de produção.

Correções pontuais em testes individuais (`maxIterations` 20→500, um
pre-drain de fila alheia replicado) reduziram a frequência mas não
eliminaram a causa: uma rodada seguinte ainda falhou, desta vez em
`rule disabled não dispara`, por interferência de `event-rules.test.ts`.

## Correção aplicada

`backend/package.json`, script `test`:

```diff
- "test": "tsx --test 'src/**/*.test.ts'",
+ "test": "tsx --test --test-concurrency=1 'src/**/*.test.ts'",
```

Serializa a execução dos arquivos de teste (os testes dentro de cada
arquivo continuam rodando como antes), eliminando de vez a corrida sobre
estado global compartilhado — em vez de continuar corrigindo teste a
teste.

## Validação

1. `npx tsx --test --test-concurrency=1 'src/**/*.test.ts'` (direto, sem
   passar pelo script) → **271/271**, 0 fail.
2. `npm test` real, com a correção já persistida no `package.json` →
   **271/271**, 0 fail, `duration_ms ≈ 233964` (~234s — mais lento que os
   ~70-90s de antes por rodar os 25 arquivos em série; troca aceita em
   favor de determinismo).
3. `tsc --noEmit` → limpo, 0 erros.

## Resultado

Suíte agora determinística — zero falhas confirmadas via o comando real
que qualquer pessoa/CI vai rodar (`npm test`), não só via flag manual.
Único arquivo alterado fora de testes: `backend/package.json` (script
`test`). Nenhuma mudança em código de produção. Os ajustes pontuais nos
testes (`event-processor.test.ts`) permanecem — não atrapalham com
concorrência 1 e documentam a intenção original de cada teste.

---

# Entrega — Agentes v1.6: Operations Control & Observability

Nenhum commit automático foi feito (correio.md v1.6 seção 18: "não fazer
commit automaticamente até a revisão final") — tudo abaixo está só no
working tree, aguardando sua revisão.

## 1. Resumo

Camada operacional e de observabilidade sobre a v1.5 já commitada, sem
criar segundo executor/planner/policy/mecanismo de autonomia. Toda
operação continua na arquitetura v1.1–v1.5 existente — v1.6 só lê e expõe
o que já é persistido, mais 2 endpoints de escrita estritamente
administrativos (kill switch global e por Job, ambos já existiam no
backend desde a v1.3/v1.5, sem UI até agora).

## 2. Arquitetura

Nenhuma tabela nova. Tudo é projeção sobre `agent_jobs`, `agent_job_runs`,
`agent_events`, `agent_event_deliveries`, `agent_autonomy_blocks` e
`audit_logs` (já existentes). Dois achados durante a exploração inicial
que mudaram o escopo real do trabalho:

- O Chain View (seção 5) **já existia** desde a v1.5:
  `GET /agents/job-runs/:id/lineage` já fazia exatamente a reconstrução
  pedida (root_execution_id, sem CTE recursiva). Reaproveitado como está,
  só ganhou BFF proxy no frontend (nunca tinha sido exposto lá).
- `AgentJob`/`AgentJobRun`/`AgentEvent` no frontend **não tinham** os
  campos de lineage/circuit breaker que o backend já retornava desde a
  v1.5 (`autonomyEnabled`, `circuitState`, `rootExecutionId`,
  `causationRunId`, `autonomyDepth`...) — adicionados aos tipos agora,
  parte real do trabalho de "visibilidade" desta versão.

## 3. Arquivos criados

Backend:

```
src/routes/agents/operations.ts        — GET /operations/summary
src/routes/agents/incidents.ts         — GET /incidents
src/routes/agents/audit.ts             — GET /audit-logs
src/routes/agents/autonomy.ts          — GET/PATCH /autonomy (global switch)
src/agents/operations/schemas.ts
src/agents/incidents/schemas.ts
src/agents/incidents/service.ts        — derivação dos 7 tipos de incidente
src/agents/audit/schemas.ts
src/routes/agents/operations.test.ts   — 15 testes (summary/incidents/audit/autonomy)
src/routes/agents/job-runs.test.ts     — 4 testes (detail/lineage)
```

Frontend:

```
app/api/agents/operations/summary/route.ts
app/api/agents/incidents/route.ts
app/api/agents/audit-logs/route.ts
app/api/agents/autonomy/route.ts
app/api/agents/job-runs/[id]/detail/route.ts
app/api/agents/job-runs/[id]/lineage/route.ts
app/api/agents/jobs/[id]/autonomy/route.ts
app/(dashboard)/agents/operations/page.tsx
app/(dashboard)/agents/incidents/page.tsx
app/(dashboard)/agents/audit/page.tsx
app/(dashboard)/agents/runs/[id]/page.tsx
components/agents/operations/{metric-card,operations-dashboard,global-autonomy-toggle}.tsx
components/agents/incidents/incident-list.tsx
components/agents/audit/audit-log-list.tsx
components/agents/runs/run-detail.tsx
hooks/agents/use-operations.ts
```

## 4. Arquivos alterados

```
backend/src/db/seed.ts                        — 4 novas permissions
backend/src/routes/agents/index.ts             — registro das novas rotas
backend/src/routes/agents/job-runs.ts          — + GET /job-runs/:id/detail
frontend/types/agents.ts                       — campos de lineage/circuit que faltavam + tipos novos v1.6
frontend/services/agents.ts                    — funções de serviço novas + setJobAutonomy
frontend/hooks/agents/use-agent-jobs.ts        — useSetAgentJobAutonomy
frontend/lib/agents/derived.ts                 — labels de circuit/incident/autonomy reason
frontend/lib/query/keys.ts                     — chaves novas
frontend/components/agents/status-badge.tsx    — CircuitStateBadge/IncidentTypeBadge/AutonomyBlockReasonBadge
frontend/components/agents/agents-sub-nav.tsx  — links Operações/Incidentes/Auditoria
frontend/components/agents/jobs/job-detail.tsx — circuit breaker visibility + toggle de autonomia + link para /runs/:id
```

## 5. Migrations

Nenhuma. Todas as colunas usadas já existiam desde a migration `0012`
(v1.5).

## 6. Endpoints

```
GET   /agents/operations/summary        agents.operations.read
GET   /agents/incidents                 agents.incidents.read
GET   /agents/audit-logs                agents.audit.read
GET   /agents/autonomy                  agents.autonomy.manage
PATCH /agents/autonomy                  agents.autonomy.manage
GET   /agents/job-runs/:id/detail       agents.runs.read   (novo)
GET   /agents/job-runs/:id/lineage      agents.runs.read   (já existia, v1.5)
```

## 7. Páginas

```
/agents/operations   — dashboard (Jobs/Runs/Autonomous/Events/Approvals + kill switch global)
/agents/incidents    — Incident Center, filtro por tipo/Job, paginado
/agents/audit        — audit log, filtro por action/entityType/entityId, paginado
/agents/runs/:id     — Execution Timeline + Chain View na mesma tela
```

## 8. Modelo da chain

Reaproveitado 100% da v1.5 (`root_execution_id`/`causation_run_id` em
`agent_job_runs`, self-FK reais). Nenhuma mudança.

## 9. Incident model

Sem tabela nova. `agents/incidents/service.ts` deriva 7 tipos:

- 5 mapeiam 1:1 para `agent_autonomy_blocks.reason` (todos exceto
  `autonomy_job_disabled`, que é ação deliberada do operador, não
  incidente).
- `event_delivery_failed` — projeção sobre `agent_event_deliveries`
  (`status='failed'`).
- `job_repeated_failure` — projeção sobre `agent_job_runs` (window
  function: últimos 3 Runs de um Job todos `failed`), sinal mais cedo que
  o circuit breaker.

Decisão de paginação documentada no código: com `type` filtrado, page/limit
exatos contra a única fonte relevante; sem `type`, busca até `limit` de
cada uma das 3 fontes e mescla em memória — aproximação best-effort para
tela operacional, nunca fonte transacional.

## 10. Permissions

4 novas, todas concedidas automaticamente ao CEO (padrão do projeto — loop
sobre todas as permissions), nenhuma outra role afetada:

```
agents.operations.read
agents.incidents.read
agents.audit.read
agents.autonomy.manage
```

**Ação necessária**: rodar `npm run db:seed` em qualquer ambiente antes de
usar estas telas (já rodado no Postgres de dev desta sessão — sem isso o
CEO recebe 403, exatamente o bug que encontrei e corrigi durante os
testes, seção 12).

## 11. Segurança

Toda autorização segue server-side (`requirePermission` em cada rota nova,
nunca confiança no frontend — `PermissionGate` só esconde/mostra UI). Kill
switch global exige confirmação de UI (`window.confirm`) antes de desligar
autonomia de todos os Jobs de uma vez — impacto amplo, seção 7. Nenhum
secret/env/credential exposto: `/audit-logs` expõe `metadata` (JSONB já
existente, nunca inclui payloads de credenciais pelos usos atuais do
`audit()`), nunca `oldData`/`newData` de tabelas sensíveis por padrão do
próprio schema.

## 12. Testes

19 novos (271 → 286), todos contra Postgres/Redis reais:

- `operations.test.ts` (15): autorização 403, agregação por delta
  (cria Jobs conhecidos, confere a diferença exata), validação
  `from > to`, incidentes (as 3 fontes, filtro por tipo, paginação),
  audit log (filtros, ação inexistente → lista vazia), global switch
  (GET reflete estado real, PATCH altera e audita).
- `job-runs.test.ts` (4): detail compõe Run+Plan+Items+Events+filhos
  corretamente (usando a técnica de fixture já estabelecida em
  `job-runner.autonomy.test.ts` para gerar uma cadeia real de 2 hops sem
  precisar de LLM), lineage reconstrói a cadeia a partir de um Run
  intermediário.

**Achado real durante a primeira rodada**: todos os 15 testes de
`operations.test.ts` falharam com 403 mesmo para o CEO — as 4 permissions
novas existiam no código (`seed.ts`) mas nunca tinham sido inseridas no
Postgres de dev. Corrigido rodando `npx tsx src/db/seed.ts` (idempotente,
seguro re-rodar). Segunda rodada: 15/15. Seguido o fluxo exigido pela
seção 15 do correio.md (executar → diagnosticar → corrigir → executar de
novo), sem repetição cega.

## 13. Resultados

```
Backend typecheck:  limpo, 0 erros
Backend suíte:      286/286 (271 pré-existentes + 15 novos), 0 fail — --test-concurrency=1 mantido
Frontend typecheck: limpo, 0 erros
Frontend build:     limpo, 0 erros, todas as rotas novas compilam (4 páginas + 7 BFF routes)
Frontend suíte:     50/50 (sem testes novos — nenhuma lógica pura nova o suficiente para justificar; toda a lógica de agregação/derivação vive no backend, coberta lá)
```

## 14. Riscos / débitos técnicos

1. **Paginação aproximada do Incident Center sem filtro de `type`**
   (seção 9) — decisão consciente, documentada no código; se o volume de
   incidentes crescer muito, considerar mover para uma view materializada
   ou uma tabela de projeção real.
2. **`job_repeated_failure` usa janela fixa de 3 Runs**, não configurável
   — suficiente para o objetivo de observabilidade desta versão, mas não
   tem relação formal com `AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD` (que
   é configurável). Se o operador mudar o threshold do circuit breaker,
   o Incident Center não acompanha automaticamente.
3. **`GlobalAutonomyToggle`/toggle por Job usam `window.confirm`** em vez
   de um modal de confirmação mais elaborado — consistente com o padrão
   já usado no resto do módulo Agentes, mas é o nível mínimo de
   confirmação exigido pela seção 7.
4. Frontend não ganhou testes automatizados novos nesta versão (só
   backend) — risco aceito, já que toda a lógica não-trivial (agregação,
   derivação de incidentes) está no backend e coberta lá.
5. Como nas entregas anteriores: nada commitado ainda; os Jobs órfãos
   `1546`/`1547` (seção 5, achado da v1.5) seguem pendentes de aprovação
   para cancelamento.

## 15. Compatibilidade v1.0–v1.5

Nenhuma rota/comportamento existente foi alterado — só leitura nova e 2
endpoints administrativos que já existiam como função interna
(`global-switch.ts`) ganhando só a casca HTTP. `job-detail.tsx` ganhou uma
coluna/link a mais e um botão a mais, sem remover nada. Suíte completa
(286 testes, incluindo toda a v1.0–v1.5) passa.

## 16. Recomendação final

Pronta para revisão e commit. Antes de commitar, sugiro:

1. Rodar `db:seed` em qualquer outro ambiente (staging/produção) antes do
   deploy — sem isso o CEO local recebe 403 nas novas telas.
2. Revisar os 3 débitos técnicos da seção 14 (nenhum bloqueia, mas vale
   registro consciente).
3. Resolver a pendência operacional dos Jobs `1546`/`1547` antes ou
   depois do commit — são independentes.
