# Executado — v3.5: Operational Supervision Insights & Incident Review

## 1. Resumo

Implementada uma camada de LEITURA sobre os dados já persistidos por
v2.5 (Operational Supervisor), v2.6 (Escalations) e v3.4 (Run History):
visão consolidada, histórico pesquisável de incidentes, detalhe por
incidente ("Incident Review") e detecção de recorrência. **Nenhuma tabela
nova, nenhuma migration** — decisão deliberada, justificada abaixo (seção
2). Nenhuma alteração de lógica de decisão do Supervisor, nenhum novo
Circuit Breaker, nenhum aumento de autonomia, `supervisor-guard.ts`
intocado. Nenhum commit e nenhum rebuild/deploy de containers feitos
nesta rodada.

## 2. Por que nenhuma migration foi necessária (justificativa arquitetural)

Revisão de código feita ANTES de desenhar qualquer schema (correio.md
seção "Toda mudança estrutural deve ser justificada antes de migration"):

- Cada incidente detectado pelo Supervisor **já é**, de forma inequívoca,
  o audit log `agents.operations.incident.detected`
  (`supervisor-service.ts`, `applyResponse`) — emitido exatamente uma vez
  por incidente, sempre ANTES de qualquer efeito colateral, com
  `entityType`/`entityId`/`metadata.incidentType`/`metadata.severity`/
  `metadata.response` — o suficiente para reconstruir tudo que o
  correio.md pede de um "finding".
- **incidente → run**: como só um scan roda por vez no sistema inteiro
  (advisory lock exclusivo, v3.3/v3.3.1), o run cujo
  `[started_at, finished_at]` contém o `created_at` do audit é o único
  candidato possível — correlação por janela de tempo é, aqui,
  matematicamente inequívoca (nunca uma heurística difusa).
- **incidente → resultado**: a decisão já vem no metadata do próprio
  `incident.detected`. O resultado de aplicá-la é um audit subsequente
  (`agents.operations.safe_recovery`/`.autonomy_restricted`/
  `.manual_attention` para sucesso, `agents.operations.incident.failed`
  para falha). Esses três primeiros **não carregavam `incidentType`** no
  metadata — única lacuna real encontrada: sem isso, dois incidentes de
  tipos diferentes na MESMA entidade (ex.: `job_repeated_failure` e
  `run_stuck` no mesmo Job) seriam ambíguos ao correlacionar de volta.
  Corrigido de forma **aditiva** (mesmo padrão já usado para o campo
  `failed` em v3.2 e `escalationsAttempted` em v3.4): `incidentType`
  adicionado ao metadata desses 3 audits em `supervisor-service.ts` —
  nenhuma lógica de decisão mudou, só o que já era gravado ganhou um
  campo a mais.
- **incidente → escalation**: `escalateSupervisorFinding` (v2.6) já
  grava `metadata.incidentId = incident.id` na própria Escalation
  (`escalations/supervisor-integration.ts`) — join exato, sem inferência.
- **Limitação documentada** (correio.md seção 4, "documentar a limitação
  antes de propor schema novo"): os branches defensivos de
  `applyResponse` que devolvem `skipped`/`observed` sem nenhum side
  effect (entityType incompatível com Recovery v2.4, entidade já não
  está mais stale, restrição já inaplicável) **não emitem um audit
  próprio** — não haveria o que auditar além do que `incident.detected`
  já registrou. Nesses casos, `outcome` é inferido pela AUSÊNCIA de um
  audit de resultado (regra determinística e documentada em código,
  `supervision-insights-service.ts`). A alternativa seria instrumentar
  também esses branches — mudaria `supervisor-service.ts` além do
  aditivo já feito, fora do escopo mínimo desta versão.

## 3. Arquitetura

`backend/src/agents/operations/supervision-insights-service.ts` (novo) —
4 funções de leitura pura, cada uma 1-4 queries SQL agregadas/filtradas
sobre tabelas já existentes (mesmo idioma de `control-center-service.ts`,
nunca N+1 por linha):

- `getSupervisionOverview(params)` — seção 1 do correio: total de
  runs/status, achados, incidentes por severidade, respostas aplicadas
  (observado/recuperado/autonomia restrita/escalado/falhou), escalations
  criadas, contagem de incidentes recorrentes.
- `listSupervisionIncidents(params)` — seção 2: histórico paginado,
  filtros por período/severidade/tipo/response/presença de
  escalonamento/entityType+entityId/status do run.
- `getSupervisionIncidentDetail(auditLogId)` — seção 3: origem, run,
  timestamp, severidade, evidência (`problem`), decisão, response
  aplicada, resultado, escalation relacionada, referências de auditoria,
  agente/job/run relacionado.
- `listRecurringIncidents(params)` — seção 4: mesma chave
  (`incidentType`+`entityType`+`entityId`, exatamente `incident.id`)
  detectada em mais de um scan.

## 4. API

4 rotas novas, todas reaproveitando `agents.operations.read` (nenhuma
permission nova):

- `GET /agents/operations/supervision-insights/overview`
- `GET /agents/operations/supervision-insights/incidents` (paginado,
  filtros: `severity`/`incidentType`/`response`/`hasEscalation`/
  `entityType`/`entityId`/`runStatus`/`dateFrom`/`dateTo`)
- `GET /agents/operations/supervision-insights/incidents/:auditLogId`
  (404 se não existir)
- `GET /agents/operations/supervision-insights/recurring`

Schemas Zod em `agents/operations/schemas.ts` — vocabulário sempre
reaproveitado de `health-types.ts` (nunca uma segunda lista inventada).
`hasEscalation` deliberadamente tri-state (ausente = sem filtro), mesmo
padrão de `overdue` em `agents/followups/schemas.ts`.

## 5. Frontend

Nova seção "Insights de Supervisão" integrada à MESMA página de
Operações (`/agents/operations`, nunca uma rota nova):
`components/agents/operations/supervision-insights-section.tsx` — cards
de indicadores (nenhum gráfico decorativo, correio.md seção 6), tabela
filtrável de histórico, diálogo de detalhe por incidente, tabela de
recorrência. Tipos/serviços/proxy routes/hooks/labels/badge seguindo
exatamente os padrões já estabelecidos no projeto (`SupervisionRun`
v3.4 como referência direta).

## 6. Segurança

- Nenhuma alteração de autenticação/autorização — mesma permission de
  leitura já usada por toda a seção de operações.
- `errorMessage` no detalhe do incidente só é populado quando o outcome
  é `failed`, e sempre a partir de `error.message` já sanitizado (nunca
  stack trace) — mesma convenção do resto do projeto.
- Teste explícito de ausência de dados sensíveis (`password`, `token`,
  `secret`, `apiKey`, indícios de stack trace) no payload do detalhe de
  incidente — ver seção 8.
- Nenhum acesso direto do frontend ao banco — tudo via API, proxy
  `proxyToBackend` padrão.

## 7. Testes

**Novos — `backend/src/agents/operations/supervision-insights-service.test.ts`
(2 testes, ambos passando)**, contra o Postgres real, incidentes REAIS
produzidos por `runObservedOperationalSupervision` (v3.4, não mock):
- Cobre overview, histórico com todos os filtros pedidos, detalhe de
  incidente com escalation vinculada e auditRefs, vínculo
  run→incident→response→escalation (v3.4↔v2.6↔v2.5, tudo verificado
  contra IDs reais no banco), ausência de dados sensíveis, recorrência
  (2 scans consecutivos no mesmo Job → `occurrences >= 2`), e
  comportamento com histórico vazio (filtro de data no ano 2999 → listas
  vazias, zero em todos os contadores, `getSupervisionIncidentDetail`
  para id inexistente → `null` — nunca erro).

**Novos — `backend/src/routes/agents/operations.test.ts` (6 testes,
todos passando)**: 403 sem permission nas 4 rotas, 200 com forma
esperada para overview/incidents/recurring, 400 para filtro inválido e
para id não-numérico, 404 para incidente inexistente.

Total de testes novos: **8**.

## 8. Bug real encontrado e corrigido (fora do código de produção)

Durante a validação, um `after()` malformado no MEU PRÓPRIO arquivo de
teste (`supervision-insights-service.test.ts`) tentava apagar a
Responsibility de teste ANTES de apagar a Escalation e o FollowUp que
apontam para ela (`onDelete: 'restrict'` em ambos) — a primeira execução
(antes da correção) falhou a limpeza e deixou uma Responsibility (+
Escalation + FollowUp) órfã no Postgres real, que **poluiu a suíte
inteira**: `resolvePrimaryResponsibility({domain:'agents'})` passou a
escolher essa Responsibility órfã em vez da Responsibility legítima
criada por outros testes (`control-center-service.test.ts`), e um Goal
`active` órfão do mesmo teste interferiu em `review-service.test.ts`
(que varre TODOS os Goals `active` do banco). Isso causou 4 falhas
aparentes numa rodada intermediária da suíte completa, em arquivos que
esta versão NUNCA tocou.

Diagnosticado com uma query direta ao Postgres (confirmando a
Responsibility/Goal órfãos), limpo manualmente via SQL, e a causa raiz
corrigida no `after()` do meu teste (ordem correta: FollowUp →
Escalation → Responsibility, incluindo o FK direto
`agent_operational_follow_ups.responsibility_id` que a primeira versão
também não cobria). Confirmado com 3 execuções isoladas consecutivas do
arquivo (todas limpas, sem órfãos) e uma suíte completa final 100%
verde. Nenhum código de produção foi a causa — só um bug no meu próprio
teste, já corrigido.

## 9. Suítes completas e validação

| Item | Resultado |
|---|---|
| Backend typecheck (`tsc --noEmit`) | limpo |
| Suíte completa do backend (`--test-concurrency=1`) | **746/746** (baseline 738 + 8 novos) |
| Frontend typecheck (`tsc --noEmit`) | limpo |
| Frontend lint (`eslint`) | limpo |
| Frontend testes (`node --test`) | **119/119** (baseline exata — nenhuma função pura nova exigiu teste dedicado) |
| Frontend build (`next build`, `node:24`) | sucesso (exit 0) |
| `git diff --check` | limpo |

## 10. Arquivos criados

- `backend/src/agents/operations/supervision-insights-service.ts`
- `backend/src/agents/operations/supervision-insights-service.test.ts`
- `frontend/app/api/agents/operations/supervision-insights/overview/route.ts`
- `frontend/app/api/agents/operations/supervision-insights/incidents/route.ts`
- `frontend/app/api/agents/operations/supervision-insights/incidents/[auditLogId]/route.ts`
- `frontend/app/api/agents/operations/supervision-insights/recurring/route.ts`
- `frontend/components/agents/operations/supervision-insights-section.tsx`

## 11. Arquivos alterados

- `backend/src/agents/operations/schemas.ts`
- `backend/src/agents/operations/supervisor-service.ts` (só metadata aditivo, ver seção 2)
- `backend/src/routes/agents/operations.ts`
- `backend/src/routes/agents/operations.test.ts`
- `frontend/app/(dashboard)/agents/operations/page.tsx`
- `frontend/components/agents/status-badge.tsx`
- `frontend/hooks/agents/use-operations.ts`
- `frontend/lib/agents/derived.ts`
- `frontend/lib/query/keys.ts`
- `frontend/services/agents.ts`
- `frontend/types/agents.ts`

## 12. `git diff --stat`

```
 backend/src/agents/operations/schemas.ts           |  31 ++++++
 .../src/agents/operations/supervisor-service.ts    |  18 ++-
 backend/src/routes/agents/operations.test.ts       |  70 ++++++++++++
 backend/src/routes/agents/operations.ts            |  64 +++++++++++
 correio.md                                         | 121 +++++++++++++++------
 .../app/(dashboard)/agents/operations/page.tsx     |  15 +++
 frontend/components/agents/status-badge.tsx        |  19 ++++
 frontend/hooks/agents/use-operations.ts            |  40 +++++++
 frontend/lib/agents/derived.ts                     |  19 ++++
 frontend/lib/query/keys.ts                         |   5 +
 frontend/services/agents.ts                        |  41 +++++++
 frontend/types/agents.ts                           |  64 +++++++++++
 12 files changed, 471 insertions(+), 36 deletions(-)
```
(`correio.md` reflete só a reescrita externa do próprio correio pelo
Diretor/CEO — nenhuma edição minha.)

## 13. `git status`

```
 M backend/src/agents/operations/schemas.ts
 M backend/src/agents/operations/supervisor-service.ts
 M backend/src/routes/agents/operations.test.ts
 M backend/src/routes/agents/operations.ts
 M correio.md
 M frontend/app/(dashboard)/agents/operations/page.tsx
 M frontend/components/agents/status-badge.tsx
 M frontend/hooks/agents/use-operations.ts
 M frontend/lib/agents/derived.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
?? backend/src/agents/operations/supervision-insights-service.test.ts
?? backend/src/agents/operations/supervision-insights-service.ts
?? frontend/app/api/agents/operations/supervision-insights/
?? frontend/components/agents/operations/supervision-insights-section.tsx
```

## 14. Confirmação de escopo e limitações

- `supervisor-guard.ts`: `git diff` vazio — confirmado sem alteração.
- Nenhuma migration criada.
- Nenhum novo Circuit Breaker, nenhum novo Supervisor, nenhuma mudança
  em Planner/Policy Evaluator/Executor.
- Nenhuma alteração de autonomia dos agentes.
- **Limitação conhecida** (documentada em código,
  `supervision-insights-service.ts`): `outcome` para incidentes cuja
  decisão foi `safe_recovery`/`restrict_autonomy`/`manual_attention` mas
  sem audit de resultado correspondente é inferido como `skipped` — os
  branches defensivos correspondentes de `applyResponse` nunca tiveram
  (e continuam sem ter) um audit próprio; instrumentá-los ficaria além
  do aditivo mínimo desta versão.
- **Limitação conhecida**: `listSupervisionIncidents` com os filtros
  `hasEscalation`/`runStatus` (que só existem depois do enriquecimento
  em memória, não são campos nativos do audit log) busca uma janela de
  até 500 linhas antes de paginar — suficiente para o volume operacional
  real deste sistema, documentado em código como concessão pragmática em
  vez de introduzir uma view materializada não pedida.

## 15. Confirmação final

**Nenhum commit foi feito.** Nenhum container foi reconstruído ou
reiniciado. Relatório pronto para aprovação.
