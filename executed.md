# Agentes v2.8 — Operational Actions & Governed Resolution
## Relatório de execução do correio.md

**Não foi feito commit.** Todas as alterações estão no working tree, aguardando revisão do Diretor/CEO.

---

## 1. Resumo

Fechada a cadeia completa `Responsibility → Supervisor → Escalation → FollowUp → Operational Action Proposal → Planner → Policy → Action Plan → Approval → Executor → Resultado → FollowUp Resolution`. Um `OperationalFollowUp` (v2.7) agora pode originar uma `OperationalActionProposal` — um registro estruturado de "existe uma possível ação necessária", nunca "esta ação está autorizada". A submissão de uma proposta reutiliza **exatamente** o mesmo par `planEvaluateAndPersistActionPlan` + `executeActionPlan` já usado por `POST /agents/action-plans`, pelo `AgentJobRunner` e por `director/decisions/actions-service.ts` — nenhum segundo Planner, Policy Engine, Executor ou mecanismo de Approval foi criado. A Policy continua 100% soberana: a proposta nunca carrega `execute`/`approval_required`/`blocked`/`shadow` — essas decisões nascem do Policy Evaluator existente, avaliando as permissões reais de quem submeteu (nunca CEO/sistema/Supervisor/owner Agent automaticamente).

## 2. Revisão da arquitetura encontrada

Revisão real feita antes de codificar (arquivos abertos e lidos, não inferidos por nome):
- `backend/src/agents/orchestration/create-action-plan.ts` — `planEvaluateAndPersistActionPlan()`, o núcleo único "objetivo → Action Plan avaliado e persistido" já extraído na v1.3 exatamente para ser reaproveitado por múltiplos chamadores (`POST /agents/action-plans`, `AgentJobRunner`, e agora esta versão). Usa `getUserPermissionSlugs(params.requestedBy)` — confirma que a identidade de quem popula `requestedBy` é a que governa a Policy.
- `backend/src/agents/director/decisions/actions-service.ts:proposeActionForDecision` — o precedente mais próximo do que a v2.8 pede: chama `planEvaluateAndPersistActionPlan` + `executeActionPlan`, vincula `actionPlanId` ao registro de origem, audita. Usado como template direto para `submitActionProposal`.
- `backend/src/agents/executor/action-plan-executor.ts:executeActionPlan` — assinatura `(planId, userId)`, roda os itens já decididos pela Policy (nunca decide nada sozinho), devolve o plano com status agregado.
- `backend/src/agents/executor/plan-approvals.ts` — confirmou o ponto exato onde uma aprovação/rejeição tardia re-executa o plano (`executeActionPlan`) e já sincroniza uma entidade dona externa (`syncJobRunStatus`, de `agents/jobs/job-runner.ts`) — o padrão exato reaproveitado para `syncActionProposalStatus` (seção 14).
- `backend/src/agents/policy/action-policy-evaluator.ts:evaluateAction` — função pura determinística; `risk==='high'`, `requiresApproval`/`isSensitive`/override sempre exigem aprovação; falta de permissão sempre bloqueia primeiro, antes de qualquer outra regra. Nenhuma lógica de política foi tocada.
- `backend/src/agents/followups/` (v2.7) — `getFollowUpById`, vocabulário de status, FK reais.
- `backend/src/agents/escalations/` (v2.6) — confirmado que nenhuma integração nova era necessária aqui.
- `backend/src/db/schema/agent-action-plans.ts` — confirmado: **não existe** mecanismo genérico `source`/`sourceType`/`sourceId`/`metadata` na tabela (seção 12 pedia checar antes de adicionar) — decisão: não adicionar nenhum campo novo em `agent_action_plans`; a origem é rastreada só do lado da proposta (`proposal.actionPlanId`), unidirecional.
- `backend/src/routes/agents/action-plans.ts` — `GET /agents/action-plans/:id` (permission `agents.plan.read`) confirmado como reutilizável para o frontend (seção 21), sem duplicar visualização.
- `backend/src/db/seed.ts` — confirmado que nenhuma permission existente cobre "propor/submeter/cancelar ação operacional" — só `agents.followups.actions.manage` foi necessária, exatamente o nome sugerido pelo correio.

## 3. Modelo adotado

`OperationalActionProposal` (tabela `agent_operational_action_proposals`) associada obrigatoriamente a um `OperationalFollowUp`. Modelo **sem `draft`** — avaliado e descartado (seção 5: "avaliar se draft realmente é necessário... não existe edição progressiva da proposta"): a criação já é um registro formal (`submitted`), sem efeito colateral. Dois passos deliberadamente separados — `POST .../action-proposals` (cria, seção 6) e `POST .../submit` (invoca o pipeline, seção 7) — porque isso é o que dá sentido real ao requisito de concorrência da seção 16 ("duas chamadas concorrentes... no máximo 1 Action Plan" só é um risco genuíno quando `/submit` pode ser chamado mais de uma vez sobre a MESMA proposta já criada).

## 4. Máquina de estados

```
submitted → planned    (via POST /submit — só aqui o pipeline é de fato invocado)
submitted → cancelled  (via POST /cancel)
planned   → completed  (system-driven, via syncActionProposalStatus)
planned   → failed     (system-driven, via syncActionProposalStatus)
planned   → cancelled  (via POST /cancel)
completed | failed | cancelled → terminal
```

Validado em `followups/action-proposals-types.ts:ACTION_PROPOSAL_TRANSITIONS`. Nenhum `PATCH status` existe — só ações semânticas (`/submit`, `/cancel`); tentar `PATCH` retorna 404 (rota inexistente). Cancelamento usa a MESMA disciplina de CAS por UPDATE condicional descrita na seção 11 abaixo.

## 5. Ownership

`proposal.ownerAgentId = followUp.ownerAgentId` e `proposal.responsibilityId = followUp.responsibilityId`, copiados no momento da criação (`createActionProposal`) — nunca recalculados, nunca perguntados a um LLM. Testado explicitamente (`action-proposals-service.test.ts`, item "1/4/20").

## 6. Integração FollowUp → Proposal → Action Plan

```
FollowUp (v2.7, aberto/em andamento/aguardando)
      │  POST /agents/follow-ups/:id/action-proposals — registra, zero efeito colateral
      ▼
OperationalActionProposal (status=submitted)
      │  POST /agents/action-proposals/:id/submit
      ▼
planEvaluateAndPersistActionPlan(objective) — Planner + validação + Policy Evaluator (EXATAMENTE o mesmo de sempre)
      │
      ▼
executeActionPlan(planId, submittedByUserId) — executor existente, inalterado
      │
      ▼
Action Plan persistido, proposal.actionPlanId vinculado, status='planned'
      │  (imediatamente, ou mais tarde via aprovação humana)
      ▼
syncActionProposalStatus — completed | failed
```

O FollowUp **nunca** é tocado por nada disto — sua conclusão continua exigindo uma ação humana explícita (`POST /follow-ups/:id/complete`), exatamente como a v2.7 já garantia. Testado explicitamente (item "17").

## 7. Integração com Planner

Nenhum código de planejamento foi escrito. `submitActionProposal` monta um único `objective: string` (`proposal.objective`, com `proposal.description` concatenado como contexto quando presente) e chama `planEvaluateAndPersistActionPlan({ requestedBy, objective })` — a mesma função que `POST /agents/action-plans` e `AgentJobRunner` já chamam. O Planner nunca soube, nunca precisa saber, que o objetivo veio de um FollowUp.

## 8. Integração com Policy

Zero alteração em `action-policy-evaluator.ts`. A Policy decide com base nas permissões reais de `submittedByUserId` (`getUserPermissionSlugs`, já dentro de `planEvaluateAndPersistActionPlan`) — nunca um campo da proposta. Testado com um usuário real sem a permission da tool: o item nasce `blocked`, nunca executa (item "9/10").

## 9. Integração com Approval

Zero estrutura nova de aprovação. Quando um item nasce `approval_required`, o mesmo fluxo de sempre roda: linha real em `agent_approvals`, aprovação/rejeição via `POST /agents/approvals/:id/{approve,reject}` (rota v1.2, inalterada) → `approvePlanItem`/`rejectPlanItem` (`executor/plan-approvals.ts`) → `executeActionPlan` de novo → agora TAMBÉM `syncActionProposalStatus` (única linha nova adicionada a este arquivo, espelhando exatamente `syncJobRunStatus` já chamado ali há duas versões). Testado (item "8").

## 10. Integração com Executor

`executeActionPlan` não foi alterado. A proposta chama exatamente a mesma função com a mesma assinatura `(planId, userId)` que todo o resto do sistema já usa — o Executor nunca soube que este plano nasceu de um FollowUp (seção 11, respeitada literalmente).

## 11. Tratamento de concorrência

**Reivindicação atômica via UPDATE condicional** (seção 16, "update condicional" citado literalmente no correio): `UPDATE agent_operational_action_proposals SET status='planned', submittedAt=now(), submittedBy=userId WHERE id=X AND status='submitted' RETURNING *`. Uma única instrução UPDATE do Postgres é atômica por linha (MVCC) — duas chamadas concorrentes serializam nela; a perdedora reavalia o `WHERE` contra a linha já committed pela vencedora e afeta 0 linhas, recebendo 409. **Testado com concorrência real**: 8 chamadas simultâneas via `Promise.allSettled` sobre a mesma proposta produzem exatamente 1 sucesso e 7 rejeições `AgentError('conflict')`, e no máximo 1 Action Plan (item "16"). O mesmo padrão de UPDATE condicional protege `cancelActionProposal`.

## 12. Permissions

Avaliado reuso primeiro (seção 6: "primeiro verificar se alguma permission existente relacionada a Action Plans ou FollowUps é semanticamente adequada"): `agents.followups.read` reaproveitada integralmente para toda leitura de proposals (GET). Nenhuma permission de Action Plans (`agents.plan.*`) foi necessária porque a submissão passa pela camada de serviço da proposta, não por uma rota de Action Plan diretamente. Uma única permission nova, exatamente o nome sugerido pelo correio: `agents.followups.actions.manage` (create/submit/cancel).

## 13. Auditoria

Reaproveitado `audit()` existente. Eventos: `agents.operational_action.created`, `.submitted`, `.planned`, `.completed`, `.failed`, `.cancelled` — sem `draft` (modelo simplificado, seção 17: "se draft não existir, simplificar"). Nenhuma duplicação da auditoria já produzida pelo Action Plan/Executor (`agent.plan.*`, inalterada) — os dois conjuntos de eventos coexistem, cada um documentando sua própria entidade.

## 14. API

```
GET  /agents/follow-ups/:followUpId/action-proposals   — agents.followups.read
GET  /agents/action-proposals/:id                       — agents.followups.read
POST /agents/follow-ups/:followUpId/action-proposals    — agents.followups.actions.manage (cria, status=submitted)
POST /agents/action-proposals/:id/submit                — agents.followups.actions.manage (CAS, invoca o pipeline)
POST /agents/action-proposals/:id/cancel                — agents.followups.actions.manage (exige reason)
```

Exatamente o conjunto sugerido pela seção 18 (modelo com `submit` separado, escolhido para dar sentido real à seção 16). Nenhum endpoint desnecessário — sem `PATCH` genérico.

## 15. Frontend

Nova página `/agents/follow-ups/:id` (detalhe do FollowUp), acessível a partir da listagem já existente (título do FollowUp virou link — sem proliferar itens de navegação novos). Mostra o FollowUp (status/owner/atribuído/prioridade/origem/resolução) e, abaixo, a lista de Action Proposals associadas (`ActionProposalsList`): título, objetivo, status real (nunca "executada" — seção 19), motivo de falha quando houver, link para `/agents/plans/:id` (página já existente, reutilizada — seção 21, "não duplicar visualização de Action Plan") quando `actionPlanId` existe. Ação "Propor ação" (modal `CreateActionProposalDialog`, seção 20 — só Título/Objetivo/Descrição, nunca tool/handler/permission/policy) só aparece com o FollowUp não-terminal (seção 22 — o backend continua soberano e rejeitaria de qualquer forma). Ações "Submeter"/"Cancelar" só aparecem no estado correspondente.

## 16. Migrations

`npx drizzle-kit generate --name agent_operational_action_proposals` → `backend/drizzle/0020_agent_operational_action_proposals.sql` (+ `meta/0020_snapshot.json` + entrada em `meta/_journal.json`, autogerados). Aplicada via `npx drizzle-kit migrate` (confirmado: `agent_operational_action_proposals` 19 colunas / 4 índices / 7 FKs; `[✓] migrations applied successfully!`). Nenhuma migration antiga foi editada. Índices exatamente os 4 sugeridos pela seção 24 (`follow_up_id`, `status`, `action_plan_id`, `created_at`) — nenhum índice extra sem justificativa de consulta real.

## 17. Arquivos criados

**Backend:**
- `backend/drizzle/0020_agent_operational_action_proposals.sql`
- `backend/drizzle/meta/0020_snapshot.json`
- `backend/src/db/schema/agent-operational-action-proposals.ts`
- `backend/src/agents/followups/action-proposals-types.ts`
- `backend/src/agents/followups/action-proposals-schemas.ts`
- `backend/src/agents/followups/action-proposals-service.ts`
- `backend/src/agents/followups/action-proposals-service.test.ts`
- `backend/src/routes/agents/action-proposals.ts`
- `backend/src/routes/agents/action-proposals.test.ts`

**Frontend:**
- `frontend/app/api/agents/follow-ups/[id]/action-proposals/route.ts`
- `frontend/app/api/agents/action-proposals/[id]/route.ts`
- `frontend/app/api/agents/action-proposals/[id]/submit/route.ts`
- `frontend/app/api/agents/action-proposals/[id]/cancel/route.ts`
- `frontend/app/(dashboard)/agents/follow-ups/[id]/page.tsx`
- `frontend/components/agents/follow-ups/follow-up-detail.tsx`
- `frontend/components/agents/follow-ups/action-proposals-list.tsx`
- `frontend/components/agents/follow-ups/create-action-proposal-dialog.tsx`
- `frontend/components/agents/follow-ups/cancel-action-proposal-dialog.tsx`
- `frontend/hooks/agents/use-action-proposals.ts`

## 18. Arquivos alterados

**Backend:**
- `backend/src/agents/executor/plan-approvals.ts` — 1 import + 2 chamadas a `syncActionProposalStatus`, espelhando exatamente `syncJobRunStatus` já presente.
- `backend/src/db/schema/index.ts` — exporta o novo módulo de schema.
- `backend/src/db/seed.ts` — 1 nova permission.
- `backend/src/routes/agents/index.ts` — registra `actionProposalsRoutes`.
- `backend/drizzle/meta/_journal.json` — entrada da migration 0020 (autogerado).

**Frontend:**
- `frontend/types/agents.ts` — tipos v2.8.
- `frontend/services/agents.ts` — funções de serviço v2.8.
- `frontend/lib/query/keys.ts` — query keys v2.8.
- `frontend/lib/agents/derived.ts` — 1 nova função de label.
- `frontend/lib/agents/derived.test.ts` — testes da nova função.
- `frontend/components/agents/status-badge.tsx` — `ActionProposalStatusBadge`.
- `frontend/components/agents/follow-ups/follow-ups-list.tsx` — título do FollowUp virou link para o detalhe; correção de lint (ver seção 25).

## 19. Testes adicionados por arquivo

| Arquivo | Testes |
|---|---|
| `backend/src/agents/followups/action-proposals-service.test.ts` | 12 |
| `backend/src/routes/agents/action-proposals.test.ts` | 7 |
| **Total backend** | **19** |
| `frontend/lib/agents/derived.test.ts` (1 função × 2) | 2 |
| **Total frontend** | **2** |

Cobertura dos 20 itens mínimos da seção 25: 1 (criação válida), 2 (FollowUp inexistente → 404, teste de rota), 3 (FollowUp terminal → 409), 4 (ownership copiado), 5/6 (pipeline oficial + Action Plan persistido/vinculado), 7 (Policy respeitada — item `execute` com permissão real), 8 (approval_required cria o workflow real), 9/10 (blocked nunca executa, executor nunca chamado diretamente), 11 (ator sem permission → 403, teste de rota), 12 (permissions/role_permissions nunca alteradas, teste de rota), 13 (autonomy nunca tocada — `agent_jobs` inalterado), 14/15 (cancelamento válido + transições inválidas → 409, três variantes testadas: cancelar terminal, submeter cancelada), 16 (concorrência real — 8 chamadas simultâneas), 17 (proposal completed NUNCA conclui o FollowUp), 18 (Action Plan independente, verificável isoladamente), 19 (auditoria gerada), 20 (FK/associações reais preservadas).

## 20. Números exatos da suíte backend

```
ℹ tests 688
ℹ pass 688
ℹ fail 0
```

## 21. Números exatos da suíte frontend

```
ℹ tests 119
ℹ pass 119
ℹ fail 0
```

## 22. Reconciliação com baseline

- Backend: baseline `669` + `19` testes novos = `688` esperado → `688` medido. **Reconciliado exatamente.**
- Frontend: baseline `117` + `2` testes novos = `119` esperado → `119` medido. **Reconciliado exatamente.**

Nenhuma divergência de baseline.

## 23. Typecheck

- Backend: `npx tsc --noEmit` — sem erros (2 execuções: após schema/service, novamente após rotas/seed/testes).
- Frontend: `npx tsc --noEmit` — sem erros, inclusive após a correção de lint da seção 25.

## 24. Build

- Frontend: `npm run build` — sucesso, `✓ Compiled successfully`, todas as rotas novas presentes (`/agents/follow-ups/[id]` + 4 rotas `/api/agents/action-proposals/**` + 1 `/api/agents/follow-ups/[id]/action-proposals`).
- Backend: sem build de produção separado (roda TypeScript direto via `tsx`, conforme `Dockerfile`).

## 25. Lint

`npm run lint` rodado no frontend (backend não tem config de lint real, confirmado nas rodadas anteriores). Resultado: **1 arquivo tocado nesta rodada tinha um erro real (`react-hooks/purity`, `Date.now()` chamado durante o render em `follow-ups-list.tsx`) — corrigido** (trocado por `useState(() => Date.now())`, inicializador lazy que roda uma única vez, nunca durante um re-render; primeira tentativa de correção via `useMemo` ainda falhou porque o callback do `useMemo` também roda durante o render — o `useState` lazy é a forma correta). Após a correção, **0 erros** em arquivos tocados por esta rodada.

Restam 4 erros pré-existentes, todos em arquivos **não tocados** nesta rodada:
- `job-detail.tsx` (2 erros, `react/no-unescaped-entities`) — já documentado desde a v2.6.
- `operations-supervisor-dashboard.tsx` (1 erro, `react-hooks/purity`) — já documentado desde a v2.6.
- `edit-responsibility-dialog.tsx` (1 erro, `react-hooks/set-state-in-effect`) — **descoberto agora** (arquivo criado na rodada de fechamento da v2.6), não documentado antes porque o lint não havia sido rerodado desde então. Não corrigido nesta rodada por não ter sido tocado (correio.md v2.8 seção 29: "desde que realmente estejam em arquivos não alterados" — este não foi alterado por esta rodada, mas registro aqui a divergência com transparência em vez de omitir).

## 26. Bugs encontrados

1. **No meu próprio código de teste**: a ordem de limpeza no teste "9/10" (`action-proposals-service.test.ts`) tentava excluir o Action Plan antes da Proposal que o referencia (FK restrict), e depois o usuário de teste antes de ambos — 2 iterações de correção até a ordem correta (proposal → plan/items/approvals → usuário). Não é um bug no código de produção.
2. **Descoberta de lint pré-existente**: ver seção 25 (`edit-responsibility-dialog.tsx`) — não é um bug introduzido por esta rodada, mas uma divergência real descoberta ao rodar lint, reportada com transparência.

Nenhum bug foi encontrado no código de produção entregue (Action Proposals, integração com o pipeline oficial, `syncActionProposalStatus`) — a suíte completa (688 backend + 119 frontend) está 100% verde.

## 27. Limitações reais

- `syncActionProposalStatus` só é chamado nos dois pontos reais onde um Action Plan muda de estado por uma ação do sistema (submissão inicial e resolução de approval via `plan-approvals.ts`). Se um Action Plan chegar a um estado terminal por algum outro caminho não coberto por esses dois pontos (nenhum foi identificado na revisão), a proposta ficaria presa em `planned` até a próxima chamada a um desses dois pontos. Isso é consistente com a orientação da seção 14 ("usar o ponto mais natural já existente... não criar polling complexo").
- O mapeamento `partial → failed` (Action Plan parcialmente executado) é uma extensão mínima que o correio não especifica explicitamente (só exemplifica completed/failed) — decisão documentada no código (`action-proposals-service.ts`), mas é uma interpretação, não uma regra ditada literalmente pelo correio.
- A UI não mostra o "resumo do Action Plan" completo sugerido pela seção 21 (n itens, n executados, n aguardando approval, n bloqueados) — só um link direto para a página de Action Plan já existente, que já mostra tudo isso. Decisão deliberada para não duplicar essa agregação (a própria seção 21 permite: "desde que os dados venham de estruturas existentes" — o link cumpre isso com o menor código possível).

## 28. Débitos técnicos

Nenhum débito técnico novo introduzido nesta rodada.

## 29. git diff --stat

```
 backend/drizzle/meta/_journal.json                  |  7 +++++
 backend/src/agents/executor/plan-approvals.ts       |  9 +++++
 backend/src/db/schema/index.ts                      |  3 +-
 backend/src/db/seed.ts                              |  5 +++
 backend/src/routes/agents/index.ts                  |  2 +
 frontend/components/agents/follow-ups/follow-ups-list.tsx | 21 +++++---
 frontend/components/agents/status-badge.tsx         | 19 +++++++
 frontend/lib/agents/derived.test.ts                 | 17 +++++++
 frontend/lib/agents/derived.ts                       | 17 +++++++
 frontend/lib/query/keys.ts                          |  2 +
 frontend/services/agents.ts                         | 28 ++++++++++
 frontend/types/agents.ts                             | 26 +++++++++
 12 files changed, 150 insertions(+), 6 deletions(-)
```

Arquivos novos (untracked, `git diff --stat` padrão não os lista): 19 arquivos novos no backend e frontend (seção 17) — mais o `meta/0020_snapshot.json` autogerado (dump completo do estado do schema pelo Drizzle, não código escrito à mão).

## 30. git status

```
Changes not staged for commit:
  modified:   backend/drizzle/meta/_journal.json
  modified:   backend/src/agents/executor/plan-approvals.ts
  modified:   backend/src/db/schema/index.ts
  modified:   backend/src/db/seed.ts
  modified:   backend/src/routes/agents/index.ts
  modified:   correio.md
  modified:   frontend/components/agents/follow-ups/follow-ups-list.tsx
  modified:   frontend/components/agents/status-badge.tsx
  modified:   frontend/lib/agents/derived.test.ts
  modified:   frontend/lib/agents/derived.ts
  modified:   frontend/lib/query/keys.ts
  modified:   frontend/services/agents.ts
  modified:   frontend/types/agents.ts

Untracked files:
  backend/drizzle/0020_agent_operational_action_proposals.sql
  backend/drizzle/meta/0020_snapshot.json
  backend/src/agents/followups/action-proposals-schemas.ts
  backend/src/agents/followups/action-proposals-service.test.ts
  backend/src/agents/followups/action-proposals-service.ts
  backend/src/agents/followups/action-proposals-types.ts
  backend/src/db/schema/agent-operational-action-proposals.ts
  backend/src/routes/agents/action-proposals.test.ts
  backend/src/routes/agents/action-proposals.ts
  frontend/app/(dashboard)/agents/follow-ups/[id]/
  frontend/app/api/agents/action-proposals/
  frontend/app/api/agents/follow-ups/[id]/action-proposals/
  frontend/components/agents/follow-ups/action-proposals-list.tsx
  frontend/components/agents/follow-ups/cancel-action-proposal-dialog.tsx
  frontend/components/agents/follow-ups/create-action-proposal-dialog.tsx
  frontend/components/agents/follow-ups/follow-up-detail.tsx
  frontend/hooks/agents/use-action-proposals.ts
```

`correio.md` aparece modificado porque já continha a v2.8 no início desta execução (não foi alterado por mim).

---

## Critério final de aprovação (seção 33)

> Um FollowUp operacional pode originar uma ação concreta para resolver um problema, mas essa ação nunca recebe autorização especial por ter vindo do FollowUp: ela obrigatoriamente entra no Planner, é avaliada pela Policy, passa por Approval quando necessário e só então chega ao Executor existente.

Confrontado: ✅ `submitActionProposal` chama literalmente `planEvaluateAndPersistActionPlan` + `executeActionPlan` — as mesmas funções que qualquer outro caminho de criação de Action Plan no sistema usa. Testado com um usuário sem permissão suficiente: o item nasce `blocked`, nunca executa (não há atalho). Testado com uma tool que exige aprovação: cria uma linha real em `agent_approvals`, mesmo workflow de sempre.

> O sistema agora consegue ir da detecção de um problema operacional até uma ação governada para resolvê-lo, preservando integralmente autorização, auditabilidade, menor privilégio e separação entre acompanhamento e execução.

Confrontado: ✅ A cadeia completa (Responsibility → Supervisor → Escalation → FollowUp → Proposal → Action Plan → Approval → Executor) está implementada e testada de ponta a ponta. Todos os 20 princípios bloqueantes da seção 1 foram respeitados — nenhum segundo Planner/Executor/Approval/Policy Engine foi criado; toda autorização permanece server-side; o frontend nunca é barreira de segurança; toda entidade referenciada existe realmente (FK + validação); histórico nunca destruído; estados/transições determinísticos; LLM propõe conteúdo (o `objective` textual) mas nunca decide autorização.

---

## 31. Rodada de verificação final de testes (2026-09-03)

Suíte completa rodada do zero, em container efêmero (`node:24-alpine`, rede
`emp-ag_agencia-network`, `DATABASE_URL`/`REDIS_URL` apontando para os
containers `agencia-postgres`/`agencia-redis` já em pé):

- **Backend** (`npx tsx --test --test-concurrency=1 --test-timeout=60000
  'src/**/*.test.ts'`): **1ª rodada — 690/692 verdes, 2 falhas.**
- **Frontend** (`npm test`): **119/119 verdes** de primeira, sem intervenção.
- **Typecheck** (`npx tsc --noEmit`) em backend e frontend: **0 erros** em
  ambos.
- **Lint** (`npm run lint`, frontend): **0 erros** — os 4 erros
  pré-existentes registrados na seção 25 já não existem mais (corrigidos em
  algum momento antes desta rodada, fora do escopo desta sessão).

### Investigação das 2 falhas

Ambas em `src/agents/director/goals/review-service.test.ts` (testes
"Goal draft nunca é avaliado..." e "Goal critical gera UMA
recomendação..."), com `summary.evaluated`/`recommendationsCreated` sempre
1 a mais do que o esperado. `reviewDirectorGoals()` varre **todos** os Goals
`status = 'active'` do banco (mesmo racional do `syncDirectorDecisionQueue`
da v1.9) — então a causa não podia estar na lógica do teste em si, e sim em
dado residual no banco de testes.

Confirmado via `psql` direto no container `agencia-postgres`: havia 1 linha
órfã em `agent_director_goals` (id 719, `Goal Supervisor
130824-0.9652604507708235`, `status = 'active'`) — criada por
`src/agents/operations/supervisor-service.test.ts` (que tem `after()` com
limpeza completa de `goalIds`), mas sobrevivente de uma execução anterior
**interrompida** antes do `after()` rodar (não uma falha de cleanup no
código do teste — o `after()` está correto).

Não é bug de produção nem de teste: é resíduo de uma execução anterior
cancelada no meio, num banco de teste persistente entre rodadas (o
container de testes é efêmero, mas o Postgres não é). Confirmado com o
usuário antes de agir (linha órfã, não dado real de produção) e removida:
`DELETE FROM agent_director_goals WHERE id=719`.

### Rodada de confirmação

Suíte completa rerodada do zero após a limpeza: **692/692 backend, 100%
verde** (`tests 692, pass 692, fail 0`, `duration_ms 512559`).

### Resultado final consolidado

| Suíte | Resultado |
|---|---|
| Backend (`npm test`) | 692/692 ✅ |
| Frontend (`npm test`) | 119/119 ✅ |
| Backend typecheck | 0 erros ✅ |
| Frontend typecheck | 0 erros ✅ |
| Frontend lint | 0 erros ✅ |

Nenhuma mudança de código de produção foi necessária para fechar os testes
— só a remoção da linha órfã no banco de teste (dado, não código).

---

## 32. Execução do correio.md — os dois bloqueios funcionais restantes (v2.9)

O correio.md desta rodada listava exatamente dois bloqueios, ambos sobre
`Operational Action Proposal` (`action-proposals-service.ts`), com a
restrição explícita de não criar novo Planner, Executor, Approval,
mecanismo de cancelamento de Action Plan, polling ou arquitetura paralela.

### Bloqueio 1 — remover `planned → cancelled`

**Já estava implementado** ao início desta rodada (achado ao ler o código
antes de escrever qualquer linha nova — o `git status` no início da
conversa já mostrava esses arquivos como novos/modificados de uma rodada
anterior não commitada):

- `ACTION_PROPOSAL_TRANSITIONS.planned` (`action-proposals-types.ts`) não
  inclui `'cancelled'` — só `['completed', 'failed']`.
- `cancelActionProposal` (`action-proposals-service.ts`) rejeita com 409
  qualquer tentativa de cancelar uma proposta `planned`, com mensagem
  explícita direcionando para o Action Plan/Approval.
- Frontend (`action-proposals-list.tsx`) só oferece o botão de cancelar
  quando a proposta está em `submitted`.
- Testes já cobriam isso: "ponto 2: cancelar uma proposta 'planned' retorna
  409" e "ponto 2: `ACTION_PROPOSAL_TRANSITIONS` não permite mais
  `planned → cancelled`" (`action-proposals-service.test.ts`).

Nenhuma mudança foi necessária neste ponto — apenas verificado e
confirmado com os testes existentes + uma leitura completa do código
(state machine, service, rota, frontend).

### Bloqueio 2 — falha após a reivindicação de `/submit`

**Parcialmente implementado**, com uma lacuna real encontrada e corrigida
nesta rodada.

O que já estava certo: a reivindicação (`claimed`, via UPDATE condicional
em `submittedAt`) nunca grava `status='planned'` antes do Planner rodar —
`planned` só é gravado no mesmo UPDATE que grava `actionPlanId`. Um bloco
`try/catch` em volta da chamada ao pipeline oficial
(`planEvaluateAndPersistActionPlan` + `executeActionPlan`) já resolvia
tanto `created.ok === false` (falha controlada do Planner) quanto uma
exceção inesperada dentro desse trecho para `status='failed'`, nunca
deixando a proposta presa em `planned` sem Action Plan (reforçado também
por um CHECK constraint no banco,
`agent_operational_action_proposals_planned_requires_plan`).

**Lacuna encontrada**: o audit log de "submitted" (`await audit({...
action: 'agents.operational_action.submitted' ...})`) rodava **fora** do
`try/catch` — entre a reivindicação bem-sucedida e o início do bloco
protegido. Se essa chamada falhasse (ex.: infraestrutura momentaneamente
indisponível), a proposta ficava com `submittedAt` gravado (reivindicação
já vencida) porém presa em `status='submitted'` para sempre — indistinguível
de uma proposta nunca submetida, mas já incapaz de ser submetida de novo
(a guarda de corrida do `submit` exige `submittedAt IS NULL`). Exatamente
o cenário que o correio.md pediu para eliminar.

**Correção aplicada** (`action-proposals-service.ts`): o `try` agora
começa imediatamente após a reivindicação, envolvendo também esse audit
de "submitted" — qualquer exceção a partir daí (audit, Planner,
persistência, ou execução) cai no mesmo `catch` já existente e resolve
deterministicamente para `failed` via `markActionProposalFailed`, que já
gravava `status`/`failureReason` de forma auditável. Nenhum mecanismo novo
foi criado — só ampliado o escopo do `try/catch` já existente.

**Teste adicionado** para forçar essa exata falha, de forma determinística
(`action-proposals-service.test.ts`, "ponto 2 (v2.9)"): um gancho
exclusivo de teste, `setForcedSubmitFailureForTests` (mesmo padrão já
usado por `setLLMProviderOverrideForTests` em `agents/llm/factory.ts`,
nunca referenciado fora de arquivos `*.test.ts`, `null` por padrão e sem
qualquer efeito em produção), injeta uma exceção logo após o audit de
"submitted" e antes do Planner rodar. O teste confirma:
- a proposta resolve para `status='failed'`, nunca fica presa em
  `submitted`;
- `actionPlanId` permanece `null` (a exceção ocorreu antes do Planner);
- `submittedAt` já estava gravado (a reivindicação foi real);
- uma segunda tentativa de `submit` sobre essa proposta `failed` é
  corretamente rejeitada com 409 (nunca aceita retry ambíguo nem fica
  travada).

### Resultado após as duas correções

Rodados, nesta ordem, conforme pedido no correio.md ("rodar somente os
testes necessários e depois a suíte completa, typecheck, lint e build"):

1. **Testes necessários** — `action-proposals-service.test.ts` +
   `action-proposals.test.ts` isolados: **24/24 verdes** (incluindo o novo
   teste do ponto 2 v2.9).
2. **Suíte completa backend** (`npx tsx --test`, container efêmero): **693/693
   verdes** (692 anteriores + 1 teste novo).
3. **Suíte completa frontend** (`npm test`): **119/119 verdes**.
4. **Typecheck** backend (`tsc --noEmit`) e frontend: **0 erros** em ambos.
5. **Lint** frontend (`npm run lint`): **0 erros**.
6. **Build** backend (`tsc -p tsconfig.build.json`): sucesso, **0 erros**.
7. **Build** frontend (`next build`): sucesso — todas as rotas compiladas
   (o primeiro build local falhou por um `.next/` remanescente de uma
   build Docker anterior, dono `root`, sem permissão de escrita para o
   usuário da sessão; contornado rodando o build dentro de um container
   `node:24` como root, mesmo dono do `.next/` remanescente — artefato de
   build, gitignored, sem relação com código-fonte).

| Verificação | Resultado |
|---|---|
| Testes isolados dos 2 pontos do correio | 24/24 ✅ |
| Backend (suíte completa) | 693/693 ✅ |
| Frontend (suíte completa) | 119/119 ✅ |
| Backend typecheck | 0 erros ✅ |
| Frontend typecheck | 0 erros ✅ |
| Frontend lint | 0 erros ✅ |
| Backend build | ✅ |
| Frontend build | ✅ |

### Arquivos alterados nesta rodada

- `backend/src/agents/followups/action-proposals-service.ts` — escopo do
  `try/catch` de `submitActionProposal` ampliado para cobrir o audit de
  "submitted"; adicionado o gancho de teste
  `setForcedSubmitFailureForTests`.
- `backend/src/agents/followups/action-proposals-service.test.ts` — novo
  teste "ponto 2 (v2.9): exceção genuinamente inesperada logo após a
  reivindicação...".

Nenhuma mudança de schema, migration, rota ou frontend foi necessária —
o Bloqueio 1 já estava correto, e o Bloqueio 2 exigiu só a correção
pontual acima.

---

Aguardando aprovação do Diretor/CEO. Nenhum commit foi feito nesta rodada.
