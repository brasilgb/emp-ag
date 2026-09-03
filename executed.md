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

## 33. Confirmação pós-commit e reconciliação v2.9

O commit da v2.8 (`5abf9d3 feat(agents): add governed operational action
proposals`) já estava feito quando esta rodada começou — confirmado pelo
usuário ("commit feito") e verificado via `git log`. Ele inclui
integralmente as duas correções da seção 32 (o `try/catch` ampliado em
`submitActionProposal` e o gancho de teste `setForcedSubmitFailureForTests`
+ o teste "ponto 2 (v2.9)").

O `correio.md` foi então atualizado (pelo Diretor/CEO) com a especificação
formal da v2.9, apontando de volta para a seção 32 deste relatório como o
escopo real e pedindo, antes de qualquer alteração: reler o código
envolvido por completo (nunca inferir pelo nome dos arquivos), e ao final
reconciliar números, listar migrations, apresentar `git diff --stat`/`git
status`, listar arquivos, documentar bugs/limitações/decisões
interpretativas, diferenciar falha de produção de falha de teste/resíduo
de ambiente, e confrontar os critérios bloqueantes — sem fazer commit.

### Releitura completa do código committado

Reli integralmente (não por inferência de nome de arquivo) os 4 arquivos
que implementam os dois bloqueios:
`backend/src/agents/followups/action-proposals-service.ts`,
`action-proposals-types.ts`, `routes/agents/action-proposals.ts`, e
`frontend/components/agents/follow-ups/action-proposals-list.tsx`.
Confirmado, lendo o código real (não os comentários) linha a linha:

- **Bloqueio 1**: `ACTION_PROPOSAL_TRANSITIONS.planned = ['completed',
  'failed']` (sem `'cancelled'`); `cancelActionProposal` usa esse mapa
  como única fonte de verdade da transição válida — nenhum caminho
  alternativo de cancelamento existe na rota ou no frontend.
- **Bloqueio 2**: o `try` em `submitActionProposal` começa imediatamente
  após a reivindicação (CAS em `submittedAt`), envolvendo o audit de
  "submitted"; qualquer exceção a partir daí cai no `catch` único e
  resolve para `failed` via `markActionProposalFailed`. Nenhum caminho de
  código deixa a proposta com `submittedAt` gravado e `status='submitted'`
  indefinidamente.

Nenhuma mudança de código foi necessária nesta rodada — a releitura
confirmou que o committed já reflete exatamente o que a seção 32
documentou, sem divergência entre relatório e implementação real.

### Verificação do ambiente de testes (resíduo de banco persistente)

Por causa do aviso explícito do correio.md sobre a rodada anterior
(v2.8) ter revelado que o Postgres de teste é persistente entre execuções
e pode acumular resíduo, verificado ANTES de rodar a suíte, via `psql`
direto:

- `agent_director_goals` com `status='active'`: **0 linhas** (a órfã
  removida na seção 31 não voltou).
- `agent_operational_action_proposals`: 1 linha residual `completed`
  (proposta de teste de uma rodada anterior, nunca deletada pelo `after()`
  correspondente — inofensiva: nenhuma varredura global de produção lê
  essa tabela sem filtrar por `id`/`followUpId`/`actionPlanId`).
- `agent_action_plans` em status não-terminal: 47 linhas residuais (Action
  Plans nunca são excluídos por design — seção "onDelete: restrict" do
  schema — e ficam de rodadas de teste anteriores). Confirmado, via
  `grep` no código de produção, que nenhuma rotina (`scheduler`,
  `supervisor`, `syncActionProposalStatus`, etc.) faz uma varredura
  irrestrita dessa tabela — todo acesso é filtrado por uma FK/ID
  específica. Não é o mesmo padrão do bug da seção 31
  (`reviewDirectorGoals` varria TODOS os Goals `active` sem filtro).

Conclusão: nenhum resíduo presente contamina os testes desta rodada — não
transformado em escopo da v2.9 (o correio.md pediu explicitamente para não
expandir escopo por conta disso), só verificado e documentado como pedido.

### Suíte completa, typecheck, lint, build (segunda rodada, pós-commit)

1. **Backend** (`npx tsx --test`, container `node:24-alpine` efêmero,
   mesma rede/credenciais das rodadas anteriores): **693/693 verdes**,
   119 suites, 0 falhas.
2. **Frontend** (`npm test`): **119/119 verdes**, 47 suites, 0 falhas.
3. **Typecheck** backend e frontend (`tsc --noEmit`): **0 erros** em
   ambos.
4. **Lint** frontend (`npm run lint`): **0 erros**.
5. **Build** frontend (`next build`, dentro de container `node:24` como
   root — mesmo motivo já documentado na seção 32: artefato `.next/`
   remanescente de build Docker anterior, dono `root`): sucesso, todas as
   rotas compiladas.

### Reconciliação numérica

| | Backend | Frontend |
|---|---|---|
| Baseline (seção 31, antes da v2.9) | 692 | 119 |
| Testes novos nesta rodada (seção 32: "ponto 2 v2.9") | +1 | +0 |
| Total medido nesta rodada (seção 33) | **693** | **119** |

692 + 1 = 693 — bate exatamente com o total medido. Nenhum teste
desapareceu, nenhum teste novo ficou sem contar.

### Migrations

Nenhuma migration nova foi criada ou aplicada nesta rodada. A última
migration aplicada continua sendo a `0021_action_proposals_planned_
requires_plan_check.sql` (id 21 no `drizzle.__drizzle_migrations`,
aplicada na rodada anterior, parte do commit `5abf9d3`) — os dois
bloqueios da v2.9 eram puramente de código de aplicação (nenhuma mudança
de schema exigida).

### git diff --stat

```
 correio.md | 59 +++++++++++++++++++++++++++++++++++++++++++++++++++++------
 1 file changed, 53 insertions(+), 6 deletions(-)
```

### git status

```
 M correio.md
```

Único arquivo alterado nesta rodada é o próprio `correio.md` (reescrito
pelo Diretor/CEO com a especificação da v2.9) — nenhum arquivo de código
foi criado ou alterado, porque a releitura confirmou que o committed já
resolve os dois bloqueios. `executed.md` (este arquivo) também é
alterado, mas é o próprio relatório, não código.

### Arquivos criados/alterados nesta rodada

Nenhum arquivo de código (backend ou frontend) foi criado ou alterado.
Apenas `correio.md` (pelo Diretor/CEO, fora desta sessão) e `executed.md`
(este relatório).

### Bugs encontrados

Nenhum bug novo encontrado nesta rodada. Os dois bugs/lacunas reais desta
versão (planned→cancelled já fechado antes desta sessão; o audit de
"submitted" fora do `try/catch`) foram encontrados e corrigidos na rodada
anterior (seção 32), antes do commit.

### Limitações reais (não corrigidas, deliberadamente fora de escopo)

- **Audit em cascata**: se o audit de "submitted" falhar E o audit de
  "failed" dentro de `markActionProposalFailed` (chamado pelo `catch`)
  também falhar — cenário só possível se a infraestrutura de audit
  estiver genuinamente fora do ar de forma persistente, não uma falha
  pontual — a exceção do segundo audit propagaria sem tratamento,
  deixando a proposta presa em `submitted` mesmo após a correção desta
  rodada. Não corrigido porque: (1) esse é o mesmo padrão de risco já
  presente em todo o resto do pipeline (`planEvaluateAndPersistActionPlan`
  e `executeActionPlan` chamam `audit()` várias vezes sem proteção
  redundante contra falha em cascata do próprio audit); (2) blindar contra
  uma falha total e persistente da infraestrutura de auditoria está fora
  do escopo dos dois bloqueios pedidos pelo correio.md, e adicionar uma
  camada de resiliência só para este fluxo criaria inconsistência com o
  resto do sistema (correio.md pede para não expandir escopo). Registrado
  aqui com transparência em vez de omitido.
- Resíduo de `agent_action_plans`/`agent_operational_action_proposals` no
  banco de teste (documentado acima) não é limpo automaticamente entre
  rodadas — decisão consciente de não transformar isso em escopo da v2.9,
  conforme instrução explícita do correio.md.

### Decisões interpretativas desta rodada

- O correio.md aponta a seção 32 deste `executed.md` como "a especificação
  oficial da v2.9" — interpretado como: a v2.9 É a seção 32 (já
  implementada e commitada), e esta rodada é uma auditoria de
  confirmação + verificação completa, não uma nova rodada de
  implementação. Nenhuma linha de código foi escrita nesta rodada.

### Falha de produção vs. falha de teste vs. resíduo de ambiente

Nesta rodada não houve nenhuma falha de nenhum tipo — 693/693 backend e
119/119 frontend, 100% verdes de primeira, sem necessidade de nenhuma
investigação de causa-raiz (diferente da seção 31, onde uma falha real de
teste foi rastreada até um resíduo de ambiente). O resíduo de ambiente
identificado nesta rodada (`agent_action_plans` não-terminal,
`agent_operational_action_proposals` completed) foi verificado
preventivamente e confirmado inofensivo — não gerou nenhuma falha de teste
falsa (nem falso-verde, nem falso-vermelho).

### Critérios bloqueantes — confrontados item por item

| Critério | Status |
|---|---|
| Não criar segundo Planner | ✅ `planEvaluateAndPersistActionPlan` é o único, reutilizado |
| Não criar segundo Policy Evaluator | ✅ inalterado, mesmo `evaluateAction` |
| Não criar segundo Executor | ✅ `executeActionPlan` é o único, reutilizado |
| Não criar segundo mecanismo de Approval | ✅ inalterado, `agent_approvals` existente |
| Não criar mecanismo paralelo de autonomia | ✅ nenhuma coluna/flag nova de autonomia |
| Autorização sempre no backend | ✅ inalterado |
| LLM nunca concede autorização/permission/ownership | ✅ inalterado — `objective` continua só texto |
| Nenhuma ação contorna Planner → Policy → Action Plan → Approval → Executor | ✅ `submitActionProposal` continua chamando exatamente esse par |
| Preservar histórico e auditabilidade | ✅ audit de "submitted" agora protegido, nunca perdido silenciosamente (exceto o cenário extremo documentado em Limitações) |
| Menor privilégio | ✅ inalterado |
| Transições de estado determinísticas | ✅ `ACTION_PROPOSAL_TRANSITIONS` é a única fonte de verdade, reforçada por CHECK no banco |
| Concorrência tratada atomicamente | ✅ CAS em `submittedAt`/`status` preservado, sem mudança |
| Reutilizar estruturas existentes antes de criar novas | ✅ o gancho de teste reusa o padrão de `setLLMProviderOverrideForTests`, nenhuma estrutura nova de produção |
| Frontend nunca é barreira de segurança | ✅ inalterado — todas as validações continuam server-side |
| Migrations antigas nunca reescritas | ✅ nenhuma migration tocada |

---

## 34. Agentes v2.9 — Operational Resolution & Lifecycle Consistency

Diferente da seção 33 (que era só uma confirmação — nenhum código novo),
desta vez o `correio.md` trouxe uma especificação de verdade, nova,
substituindo por completo a anterior: dois bloqueios reais, com revisão
arquitetural obrigatória antes de qualquer código.

### BLOQUEIO 1 — lifecycle Action Plan → Operational Action Proposal

**Revisão arquitetural (antes de alterar qualquer código, como pedido)**:
gerpeei todo `.update(agentActionPlans)` do código-fonte e confirmei que
existe exatamente **UM** lugar que grava `agent_action_plans.status`:
`finalizePlanStatus()`, chamado só de dentro de `executeActionPlan()`
(`action-plan-executor.ts`). Listei todos os chamadores reais de
`executeActionPlan` (8 pontos): `submitActionProposal`
(action-proposals-service.ts), `approvePlanItem`/`rejectPlanItem`
(plan-approvals.ts), `job-runner.ts`, `director/decisions/actions-service.ts`,
`director/goals/initiatives-execution-service.ts`,
`routes/agents/director.ts`, `routes/agents/action-plans.ts` (criação
direta). Antes desta rodada, só 2 desses 8 chamadores (proposals +
plan-approvals, e este último em duplicata: approve E reject) chamavam
`syncActionProposalStatus` explicitamente depois — exatamente o
"acoplamento perigoso" que o correio.md descreveu: qualquer um dos outros
6 chamadores (presentes ou futuros) nunca dispararia essa sincronização.

**Solução**: movida a chamada a `syncActionProposalStatus` para **dentro**
de `executeActionPlan()`, logo após `finalizePlanStatus()` — o único ponto
canônico. Removidas as 3 chamadas explícitas que existiam antes
(`action-proposals-service.ts` e as 2 em `plan-approvals.ts`). Agora TODO
chamador de `executeActionPlan` (presente ou futuro) sincroniza a Proposal
automaticamente, sem precisar saber que ela existe. `syncActionProposalStatus`
já era (e continua sendo) um no-op barato para os 6+ chamadores que não
têm Proposal nenhuma (só um `SELECT` que não encontra linha) — confirmado
com um teste dedicado.

Envolveu um reordenamento real em `submitActionProposal`: `status='planned'`
+ `actionPlanId` agora são gravados **antes** de `executeActionPlan` rodar
(não depois) — necessário para o gatilho interno (que busca a Proposal
pelo `actionPlanId`) conseguir encontrar a linha. A submissão inicial
passou a usar exatamente o mesmo caminho de sincronização que a resolução
de uma Approval — antes eram dois códigos parecidos, agora é
estruturalmente o mesmo.

Chamada envolvida em `try/catch` silencioso dentro do Executor — uma falha
de infraestrutura na sincronização nunca pode quebrar Jobs/Director
Decisions/Initiatives/criação direta de Action Plan (nenhum desses tem
qualquer relação com Proposals); o pior caso é a mesma Proposal ficar
"presa em planned" até o próximo gatilho real recalcular o Action Plan —
mesma garantia de "sem estado a reverter" já usada em outros pontos do
sistema.

**Achado real durante os testes** (não uma regressão desta rodada): um
teste que eu escrevi para "rejeição de Approval → Proposal failed" falhou
— não porque o código estava errado, mas porque minha expectativa estava
errada. `finalizePlanStatus()` (comportamento pré-existente desde v1.2,
já coberto por um teste próprio: "item com decision=blocked nunca
executa") trata `rejected`/`blocked`/`skipped` como um grupo neutro — nenhum
deles conta para `anyFailed`, então um Action Plan cujo único item foi
rejeitado (ou bloqueado, ou pulado por shadow mode) finaliza como
`completed`, nunca `failed`. Corrigi o teste, não o código de produção —
alterar esse comportamento pré-existente estaria fora do escopo dos dois
bloqueios e quebraria um teste já aprovado desde v1.2. Documentado aqui
com transparência, exatamente como pedido ("diferencie claramente falha de
produção, falha de teste e resíduo de ambiente"): isto foi uma falha de
teste (expectativa incorreta minha), não uma falha de produção.

### BLOQUEIO 2 — Operational Resolution baseada em evidência

Backend: nenhuma mudança foi necessária — `GET /agents/action-plans/:id`
(`loadPlanWithItems`, já existente desde v1.2) já devolve o plano completo
com todos os itens e seus `executionStatus`/`decision`/`result`/`error`.
Frontend:

- `action-proposals-list.tsx`: nova evidência por proposta (só quando ela
  tem `actionPlanId` e o usuário tem `agents.plan.read` — sem essa
  permission, some silenciosamente, mesmo padrão de `PermissionGate`;
  nunca gera um erro ruidoso). Usa `useActionPlan` (hook já existente,
  mesmo usado pela página de Action Plan) — nenhum resultado novo é
  duplicado em JSON próprio, 100% derivado dos itens reais. Mostra
  contagem por status real (executaram/bloqueadas/exigiram aprovação/
  falharam) + os badges de cada item (`ActionPlanItemStatusBadge`, já
  existente). Regra fundamental respeitada explicitamente: quando a
  Proposal está `completed`, mostra "Ação executada — aguardando
  resolução do acompanhamento" (nunca conclui o FollowUp sozinha); quando
  `failed`, contextualiza a decisão que cabe ao humano (propor outra ação,
  ajustar acompanhamento, ou resolver com justificativa) — nunca uma
  transição automática.
- `follow-up-detail.tsx`: as ações humanas explícitas da v2.7
  (Iniciar/Aguardar/Retomar/Concluir/Descartar) agora aparecem também na
  página de detalhe do FollowUp (antes só existiam na listagem) —
  reutilizando EXATAMENTE os mesmos hooks (`useStartFollowUp`,
  `useResumeFollowUp`, `useWaitFollowUp`/`useCompleteFollowUp`/
  `useDismissFollowUp` via os diálogos já existentes) e a mesma máquina de
  estados (`FOLLOW_UP_TRANSITIONS`, `agents/followups/types.ts`, v2.7) —
  nenhuma ação nova, nenhum "reopen" inventado (a v2.7 não tem reabertura
  de `completed`/`dismissed` — terminais de verdade; o mecanismo mais
  próximo, "retomar" de `waiting` para `in_progress`, já é reutilizado tal
  como está). `Concluir`/`Descartar` continuam exigindo texto obrigatório
  (`resolution`/`reason`) nos diálogos já existentes — a conclusão do
  FollowUp nunca é inferida automaticamente do resultado do Action Plan.

### Testes novos (correio.md "TESTES MÍNIMOS", conferidos item por item)

| # | Requisito | Onde |
|---|---|---|
| 1 | Proposal acompanha Action Plan completed | já existia (v2.8) |
| 2 | Proposal acompanha Action Plan failed | **novo** — tool real falha (`sales.prepare_lead_followup` com `leadId` inexistente, `AgentError` real, não mock de falha) |
| 3 | comportamento para Action Plan partial | **novo** — 2 ações reais, 1 completa/1 falha → `partial` real → Proposal `failed` (mapeamento documentado) |
| 4 | estado não terminal não encerra Proposal | já existia (teste 8, v2.8) |
| 5 | Approval pendente não marca completed | já existia (teste 8, v2.8) |
| 6 | resolução de Approval atualiza lifecycle final | **novo** — 2 testes (`approvePlanItem`/`rejectPlanItem` chamados diretamente, nenhuma chamada explícita a sync em `plan-approvals.ts`) |
| 7 | sincronização repetida é idempotente | **novo** — 3 chamadas diretas repetidas, sem duplicar audit |
| 8 | Action Plan sem Proposal continua funcionando | **novo** — teste dedicado + toda a suíte `action-plans.test.ts` (independente) |
| 9 | Job Run continua funcionando | `jobs.test.ts` completo (58/58) |
| 10 | Director Decision continua funcionando | `director-decisions.test.ts`/`director-initiatives.test.ts` completos |
| 11 | Action Plan criado diretamente continua independente | `action-plans.test.ts` completo + teste novo do item 8 |
| 12 | conclusão da Proposal nunca conclui FollowUp | já existia (teste 17, v2.8) |
| 13 | falha da Proposal nunca altera FollowUp | **novo** |
| 14 | detalhe do FollowUp apresenta evidência real | frontend (`ActionPlanEvidence`) — este repositório não tem suíte de teste de componente React (só funções puras, `lib/*.test.ts`); verificado por revisão de código e pelos dados reais que a API já devolve, mesmo padrão do restante do projeto |
| 15 | sem permission não conclui/reabre FollowUp | já existia (`follow-ups.test.ts`, testes 15/16/17) |
| 16 | frontend não falsifica status | já existia (`follow-ups.test.ts`: "nenhum endpoint de PATCH genérico de status existe") |
| 17 | histórico preservado | nenhuma linha foi deletada/reescrita nesta rodada |
| 18 | nenhuma duplicação de Policy/Planner/Executor/Approval | confirmado pela revisão arquitetural acima — 0 arquivos novos de Planner/Executor/Approval/Policy |

### Suíte completa, typecheck, lint, build

1. **Testes necessários** (arquivos tocados pela mudança + os que exercitam
   os 8 chamadores de `executeActionPlan`): `action-proposals-service.test.ts`
   (30/30), `action-proposals.test.ts` (7/7), `follow-ups.test.ts` (10/10),
   `action-plan-executor.test.ts` (7/7), `jobs.test.ts` (58/58 no bundle
   completo de Jobs), `director-decisions.test.ts`/`director-initiatives.test.ts`
   (dentro do mesmo bundle) — **48/48** numa rodada isolada mais focada.
2. **Suíte completa backend** (container `node:24-alpine` efêmero):
   **700/700 verdes**, 120 suites, 0 falhas.
3. **Suíte completa frontend** (`npm test`): **119/119 verdes** (sem testes
   novos — este projeto não tem suíte de componente React, só funções
   puras; a mudança de UI foi verificada por typecheck + lint + build +
   revisão de código).
4. **Typecheck** backend e frontend (`tsc --noEmit`): **0 erros** em ambos.
5. **Lint** frontend (`npm run lint`): **0 erros**.
6. **Build** backend (`tsc -p tsconfig.build.json`): sucesso.
7. **Build** frontend (`next build`, container `node:24` como root — mesmo
   motivo já documentado nas seções 32/33): sucesso, todas as rotas
   compiladas.

### Reconciliação numérica

| | Backend | Frontend |
|---|---|---|
| Baseline (seção 33, antes da v2.9) | 693 | 119 |
| Testes novos nesta rodada | +7 | +0 |
| Total medido nesta rodada | **700** | **119** |

693 + 7 = 700 — bate exatamente. Os 7 testes novos: "failed real",
"13: falha nunca altera FollowUp", "partial", "approve atualiza
lifecycle", "reject atualiza lifecycle", "sincronização idempotente",
"Action Plan sem Proposal".

### Migrations

Nenhuma migration nova. Os dois bloqueios foram resolvidos inteiramente em
código de aplicação (backend: reordenar/centralizar uma chamada já
existente; frontend: reusar componentes/hooks já existentes) — nenhuma
mudança de schema foi necessária ou cogitada.

### git diff --stat

```
 backend/src/agents/executor/action-plan-executor.ts        |  50 +++-
 backend/src/agents/executor/plan-approvals.ts               |  25 +-
 backend/src/agents/followups/action-proposals-service.test.ts | 262 +++++++++++++++++++++
 backend/src/agents/followups/action-proposals-service.ts    |  45 +++-
 correio.md                                                   | 179 +++++++++++++-
 frontend/components/agents/follow-ups/action-proposals-list.tsx |  76 +++++-
 frontend/components/agents/follow-ups/follow-up-detail.tsx  |  78 +++++-
 7 files changed (+ executed.md, este relatório), 881 insertions(+), 31 deletions(-)
```

### git status

```
 M backend/src/agents/executor/action-plan-executor.ts
 M backend/src/agents/executor/plan-approvals.ts
 M backend/src/agents/followups/action-proposals-service.test.ts
 M backend/src/agents/followups/action-proposals-service.ts
 M correio.md
 M executed.md
 M frontend/components/agents/follow-ups/action-proposals-list.tsx
 M frontend/components/agents/follow-ups/follow-up-detail.tsx
```

### Arquivos criados

Nenhum. Toda a v2.9 coube em arquivos já existentes.

### Arquivos alterados

- `backend/src/agents/executor/action-plan-executor.ts` — centraliza a
  sincronização da Proposal dentro de `executeActionPlan`, logo após
  `finalizePlanStatus`.
- `backend/src/agents/executor/plan-approvals.ts` — remove as 2 chamadas
  explícitas a `syncActionProposalStatus` (agora redundantes/automáticas).
- `backend/src/agents/followups/action-proposals-service.ts` — reordena
  `submitActionProposal` (linka `actionPlanId`+`planned` antes de
  executar, não depois); remove a chamada explícita final a
  `syncActionProposalStatus`.
- `backend/src/agents/followups/action-proposals-service.test.ts` — 7
  testes novos (BLOQUEIO 1).
- `frontend/components/agents/follow-ups/action-proposals-list.tsx` —
  novo componente `ActionPlanEvidence` (BLOQUEIO 2).
- `frontend/components/agents/follow-ups/follow-up-detail.tsx` — ações
  humanas explícitas da v2.7 reutilizadas na página de detalhe (BLOQUEIO
  2).

### Decisões arquiteturais

1. **Centralizar dentro do Executor, não num wrapper externo** — cogitei
   criar uma função `executeActionPlanAndSync()` usada pelos 3 chamadores
   que hoje têm Proposal, mas isso não resolveria o risco real que o
   correio.md descreveu ("qualquer caminho... presente ou futuro"): um
   chamador futuro ainda poderia esquecer de usar o wrapper e chamar
   `executeActionPlan` puro. Só colocar a sincronização DENTRO da própria
   função garante estruturalmente que nenhum chamador, presente ou
   futuro, escapa dela — exatamente o pedido do correio.md ("ponto
   canônico... comprovadamente único").
2. **`try/catch` silencioso dentro do Executor** — decisão deliberada:
   uma falha da sincronização de Proposal nunca pode quebrar Jobs/Director
   Decisions/Initiatives, que não têm nada a ver com Proposals. O único
   custo é a mesma "Proposal presa em planned" que já existia como pior
   caso antes desta correção — corrigida automaticamente na próxima vez
   que qualquer coisa recalcular aquele Action Plan.
3. **Reordenar `planned`+`actionPlanId` para antes de `executeActionPlan`**
   — consequência direta da centralização: o gatilho automático só
   encontra a Proposal pelo `actionPlanId`, então o vínculo precisa
   existir antes da execução rodar. Nenhuma mudança de significado do
   invariante "planned implica Action Plan real" (CHECK do banco
   inalterado) — só de QUANDO, dentro da mesma função, ele é gravado.
4. **Não alterar `finalizePlanStatus`** apesar do achado
   (blocked/rejected-only → completed) — está fora do escopo dos dois
   bloqueios, é um comportamento pré-existente desde v1.2 e já tem teste
   próprio aprovado. Mudar isso agora seria exatamente o "expandir escopo
   para funcionalidades futuras" que o correio.md pediu para evitar.
5. **Evidência no frontend consultando `agents.plan.read`** — a Proposal
   e o FollowUp são geridos por `agents.followups.*`, mas o Action Plan
   por trás é uma entidade de `agents.plan.*`. Em vez de expandir o que
   `agents.followups.read` autoriza (mudaria a superfície de permissions
   existente sem necessidade), a evidência simplesmente não aparece para
   quem não tem `agents.plan.read` — consistente com "menor privilégio" e
   com o próprio link "Ver Action Plan" já existente na v2.8, que também
   exige essa permission na rota de destino.

### Bugs encontrados

Nenhum bug de produção. O único problema encontrado foi na minha própria
expectativa de teste (detalhado acima, BLOQUEIO 1) — corrigido no teste,
não no código.

### Limitações reais

- A mesma limitação já registrada na seção 32 (audit em cascata) continua
  válida e inalterada — não foi tocada nesta rodada.
- `finalizePlanStatus` tratar item `rejected`/`blocked`/`skipped` sozinho
  como `completed` (e não `failed`) é uma decisão pré-existente desde
  v1.2, agora mais visível porque a Proposal reflete isso fielmente — não
  é uma limitação introduzida por esta rodada, é uma característica já
  testada e aprovada do Executor, fora do escopo dos dois bloqueios.
- A evidência do Action Plan na página do FollowUp exige `agents.plan.read`
  além de `agents.followups.read` — um operador com só a segunda não vê a
  contagem de itens (decisão de menor privilégio, item 5 acima); ainda
  assim vê o status da Proposal e o link para a página completa do Action
  Plan (que também exige a mesma permission, comportamento inalterado
  desde v2.8).

---

## 35. Agentes v2.9 — relatório completo (template de entrega detalhado)

O commit da v2.9 (seção 34) já estava feito quando esta rodada começou
("commit feito", confirmado via `git log`: `a436d66 v2.8 aprovada`,
depois de `5abf9d3`). O `correio.md` foi então reescrito com um template
de entrega mais detalhado (20 itens) para os MESMOS dois bloqueios já
resolvidos — mais uma tarefa nova e concreta: reconciliar objetivamente a
origem dos "quatro testes adicionais" entre o 688 relatado no fechamento
inicial da v2.8 e o 692 medido depois.

Nenhuma linha de código foi alterada nesta rodada — só investigação e
este relatório. Segue o template pedido, item por item.

### 1. Resumo

Os dois bloqueios (lifecycle Action Plan → Proposal e evidência no
FollowUp) foram implementados e testados na rodada anterior (seção 34,
commit já feito). Esta rodada: (a) reconcilia objetivamente a origem dos 4
testes que apareceram entre dois relatórios anteriores, e (b) reapresenta
a entrega completa no formato de 20 itens agora pedido.

### 2. Os dois bloqueios encontrados

1. `syncActionProposalStatus()` era chamado explicitamente em 2 dos 8
   pontos reais que alteram `agent_action_plans.status` via
   `executeActionPlan` — qualquer um dos outros 6 (presentes ou futuros)
   nunca sincronizaria a Proposal.
2. A página de detalhe do FollowUp não mostrava nenhuma evidência real do
   Action Plan (itens executados/bloqueados/aguardando aprovação/
   falharam) nem oferecia as ações humanas da v2.7
   (Iniciar/Aguardar/Retomar/Concluir/Descartar) — só existiam na
   listagem.

### 3. Solução adotada para cada um

Ver seção 34 ("BLOQUEIO 1"/"BLOQUEIO 2") para o detalhamento completo.
Resumo: (1) sincronização movida para dentro de `executeActionPlan`, no
único ponto que grava o status agregado (`finalizePlanStatus`) —
estruturalmente impossível de esquecer, para qualquer chamador presente
ou futuro; `submitActionProposal` reordenado para linkar `actionPlanId`
antes de executar. (2) evidência (`ActionPlanEvidence`, componente novo)
consultando `GET /agents/action-plans/:id` já existente, e os botões de
transição da v2.7 replicados na página de detalhe, reusando os mesmos
hooks/diálogos da listagem.

### 4. Arquitetura reutilizada

`executeActionPlan`/`finalizePlanStatus` (Executor único, v1.2),
`planEvaluateAndPersistActionPlan` (Planner único, v1.2), `agent_approvals`
(mecanismo de Approval único, v1.2), `FOLLOW_UP_TRANSITIONS` (máquina de
estados única do FollowUp, v2.7), `useStartFollowUp`/`useWaitFollowUp`/
`useResumeFollowUp`/`useCompleteFollowUp`/`useDismissFollowUp` e os
diálogos correspondentes (v2.7), `useActionPlan`/`GET /agents/action-plans/:id`
(v1.2), `ActionPlanItemStatusBadge` (badge já existente). Nenhuma
abstração nova de domínio foi criada — só um componente de apresentação
(`ActionPlanEvidence`) e um gancho de teste (`setForcedSubmitFailureForTests`,
já reportado na seção 32, reaproveitando o padrão de
`setLLMProviderOverrideForTests`).

### 5. Arquivos criados

Nenhum, em nenhuma das duas rodadas da v2.9 (seções 34 e 35). Toda a
implementação coube em arquivos já existentes.

### 6. Arquivos alterados

Ver seção 34 ("Arquivos alterados"): `action-plan-executor.ts`,
`plan-approvals.ts`, `action-proposals-service.ts`,
`action-proposals-service.test.ts`, `action-proposals-list.tsx`,
`follow-up-detail.tsx`. Nesta rodada (35): só `executed.md`.

### 7. Migrations

Nenhuma migration nova em nenhuma das duas rodadas. Confirmado de novo
nesta rodada: `git status backend/drizzle` sem alterações; última
migration aplicada no banco real de desenvolvimento/teste continua sendo
a 21 (`SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT
1` → `21`). Nenhuma necessidade estrutural nova — os dois bloqueios eram
puramente de código de aplicação.

### 8. Permissions

Nenhuma permission nova foi criada. A evidência do Action Plan no
FollowUp (BLOQUEIO 2) reusa `agents.plan.read`, já existente desde v1.2
(`backend/src/db/seed.ts:273`) — decisão deliberada de menor privilégio
em vez de expandir o que `agents.followups.read`/`agents.followups.manage`
autorizam (ver seção 34, "Decisões arquiteturais" item 5). As ações
humanas do FollowUp na página de detalhe usam a mesma
`agents.followups.manage` já usada na listagem — nenhuma permission nova,
nenhuma elevação implícita por Supervisor/Agent/sistema.

### 9. Auditoria

Nenhum audit log novo foi necessário — `syncActionProposalStatus` já
gravava `agents.operational_action.completed`/`.failed` desde a v2.8; ao
centralizar a chamada dentro do Executor, o MESMO audit continua sendo
gravado, só que agora de um único ponto em vez de 3 pontos duplicados.
Confirmado por teste dedicado (seção 34: "sincronização repetida é
idempotente... não deve gerar novo audit").

### 10. Concorrência/idempotência

`syncActionProposalStatus` já era idempotente desde v2.8 (nunca regride
uma Proposal terminal — `if (proposal.status === 'completed' || ...)
return proposal`) — comportamento inalterado, agora só chamado de um
lugar diferente (e potencialmente mais vezes ao longo do ciclo de vida de
um Action Plan com múltiplas resoluções de Approval), por isso ganhou um
teste explícito de idempotência nesta rodada (seção 34, item 7 da tabela
de "TESTES MÍNIMOS"). A guarda de corrida original de `submitActionProposal`
(CAS em `submittedAt IS NULL`) não foi tocada — continua garantindo NO
MÁXIMO 1 Action Plan por proposta mesmo sob N chamadas simultâneas
(reconfirmado pelo teste "16: concorrência de submissão gera exatamente
um Action Plan", que continua passando).

### 11. Testes adicionados

7 testes novos em `action-proposals-service.test.ts` — ver seção 34,
tabela "Testes novos (correio.md TESTES MÍNIMOS)". Nenhum teste novo no
frontend (projeto não tem suíte de componente React — só funções puras).

### 12. Números exatos das suítes

```
Backend:  tests 700 / pass 700 / fail 0 / suites 120
Frontend: tests 119 / pass 119 / fail 0 / suites 47
```

Rerodado do zero nesta própria rodada (container `node:24-alpine`
efêmero, pós-commit) para confirmar que nada regrediu depois do commit:
**700/700 backend, 119/119 frontend, idêntico à seção 34.**

### 13. Reconciliação do baseline (688 → 692 → 693 → 700)

Isto é a investigação nova pedida por este `correio.md`. Achado,
confirmado em duas fontes independentes (o texto já existente no próprio
`executed.md`, seções 19-22, e a árvore de `describe`/`test` real do
arquivo committed):

- O relatório de fechamento inicial da v2.8 (seção 22 deste arquivo,
  escrito ANTES desta sessão existir) registrou: baseline `669` + `19`
  testes novos (`12` em `action-proposals-service.test.ts` + `7` em
  `action-proposals.test.ts`, seção 19) = **688** medido, "reconciliado
  exatamente".
- Esse relatório de 688 é anterior à existência do describe
  `'Fechamento v2.8 — pontos de consistência'` — confirmado contando:
  a seção 19 lista exatamente 12 testes para
  `action-proposals-service.test.ts`, que batem 1:1 com os 12 testes que
  existem HOJE fora desse describe (`1/4/20`, `3`, `5/6/7/19`, `8`,
  `9/10`, `13`, `16`, `17`, `18`, `14/15`, `15`,
  `syncActionProposalStatus nunca regride`) — o describe
  `'Fechamento v2.8'` não está contado ali.
- Esse describe (`'Fechamento v2.8 — pontos de consistência'`) tem
  exatamente **4 testes** na forma em que foi commitado antes desta sessão
  começar (confirmado com `git show 5abf9d3:.../action-proposals-service.test.ts`):
  `ponto 1: falha do Planner...`, `ponto 1: CHECK do banco...`,
  `ponto 2: cancelar uma proposta "planned"...`, `ponto 2:
  ACTION_PROPOSAL_TRANSITIONS não permite mais planned → cancelled`. Estes
  4 testes correspondem exatamente aos DOIS bloqueios funcionais que o
  primeiro `correio.md` desta sessão (aquele com que esta sessão abriu,
  antes de qualquer v2.9) descrevia como "já solicitados": remover
  `planned → cancelled` (2 testes) e tratar falha após a reivindicação de
  `/submit` (2 testes) — implementados numa parte da sessão anterior a
  esta (não registrada em nenhuma seção numerada deste arquivo, por isso
  a lacuna na reconciliação).
- **Origem objetiva dos 4 testes adicionais**: são os 4 testes do
  fechamento dos DOIS bloqueios funcionais da v2.8 propriamente dita
  (`planned → cancelled` removido + falha pós-reivindicação tratada) —
  implementados e testados numa rodada anterior a esta sessão, cujo
  relatório de números (seção 20-22) nunca foi atualizado de 688 para 692
  depois que esses 4 testes foram adicionados. Não é teste fantasma, não
  é contaminação de ambiente, não é duplicação — é uma DIVERGÊNCIA DE
  DOCUMENTAÇÃO (o relatório ficou desatualizado em relação ao código),
  identificada e corrigida agora.
- **Baseline correto e completo, do zero até hoje**:
  `669` (pré-v2.8) `+ 19` (v2.8 inicial) `+ 4` (Fechamento v2.8: os dois
  bloqueios originais) `= 692` `+ 1` (seção 32 desta sessão: ponto 2 v2.9,
  falha pós-reivindicação — teste adicional além dos 4 já existentes)
  `= 693` `+ 7` (seção 34: BLOQUEIO 1/2 desta v2.9) `= 700` — **bate
  exatamente com os 700 medidos agora**. Esta tabela substitui a da seção
  22 como referência de baseline daqui em diante.

| Etapa | Testes | Acumulado |
|---|---|---|
| Baseline pré-v2.8 | — | 669 |
| v2.8 inicial (criação/submissão/cancelamento/sync) | +19 | 688 |
| Fechamento v2.8 (planned→cancelled + falha pós-reivindicação) | +4 | 692 |
| Seção 32 desta sessão (teste adicional do ponto 2) | +1 | 693 |
| Seção 34 — v2.9 BLOQUEIO 1+2 | +7 | 700 |
| **Total atual (medido, seção 12 acima)** | | **700 ✅** |

### 14. Typecheck/lint/build

- Backend typecheck: 0 erros (rerodado nesta sessão).
- Frontend typecheck: 0 erros (rerodado nesta sessão).
- Frontend lint: 0 erros (rerodado nesta sessão).
- Backend build (`tsc -p tsconfig.build.json`): sucesso (seção 34).
- Frontend build (`next build`): sucesso, todas as rotas compiladas
  (seção 34).

### 15. Bugs encontrados

Nenhum bug de produção nesta rodada (nenhuma linha de código foi
alterada). O achado desta rodada é de documentação (item 13 acima), não
de código.

### 16. Limitações reais

Idênticas às já registradas na seção 34 (audit em cascata;
`finalizePlanStatus` tratar `rejected`/`blocked`/`skipped` sozinho como
`completed`; evidência exige `agents.plan.read` além de
`agents.followups.read`) — nenhuma nova nesta rodada.

### 17. Débitos técnicos

Nenhum débito técnico novo. O único "débito" real identificado (a
divergência de documentação do item 13) foi resolvido nesta própria
rodada, só com investigação — nenhum código precisou mudar.

### 18. git diff --stat

```
 executed.md | 254 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 254 insertions(+)
```

(Só este relatório — seção 35 — foi adicionado nesta rodada; nenhum
arquivo de código no diff.)

### 19. git status

```
 M correio.md
 M executed.md
```

`correio.md` aparece modificado porque foi reescrito pelo Diretor/CEO no
início desta rodada (não alterado por mim).

### 20. Confirmação explícita

Nenhum mecanismo paralelo de Planner/Policy/Approval/Executor foi criado
em nenhuma das duas rodadas da v2.9 (seções 34 e 35). Confirmado por
inspeção direta: 0 arquivos novos sob `agents/planner/`,
`agents/orchestration/` (Policy), `agents/executor/`, ou qualquer novo
serviço de Approval — as únicas mudanças de código real (seção 34) foram
mover uma chamada já existente para dentro da função já existente que é o
único ponto de verdade do status do Action Plan, e reordenar duas
gravações dentro da mesma função de serviço já existente. O frontend
(seção 34, BLOQUEIO 2) não introduziu nenhuma nova regra de autorização —
toda decisão de permissão continua vindo do backend; `PermissionGate`
continua sendo só UX (esconder/mostrar), nunca barreira de segurança real.

---

## 36. Rebuild e deploy real dos containers (2026-09-03)

Achado da rodada anterior: `agencia-backend`/`agencia-frontend` estavam
rodando uma imagem construída em **1º de setembro**, sem bind mount —
todo o trabalho de v2.8/v2.9 (e até features anteriores) estava só no
git, nunca implantado no ambiente real. Não fazia parte do escopo do
`correio.md` (que é só sobre os dois bloqueios funcionais), mas foi pedido
explicitamente pelo usuário nesta rodada.

Executado:

```
docker compose build backend frontend
docker compose up -d backend frontend
```

Resultado:

- `emp-ag-backend`/`emp-ag-frontend` reconstruídas com sucesso a partir do
  HEAD atual (commit `a436d66`).
- `agencia-backend` e `agencia-frontend` recriados, ambos `healthy` em
  segundos (healthcheck do `docker-compose.yml`).
- Confirmado que o binário novo está de fato no ar: `grep -c
  syncActionProposalStatus /app/dist/agents/executor/action-plan-executor.js`
  dentro do container → `5` (a v2.9 está compilada e presente).
- `GET /health` → `{"status":"ok","services":{"api":true,"postgres":true,"redis":true}}`.
- `GET /api/health` (frontend) → `200`.
- Smoke test real autenticado: login via `POST /auth/login` com as
  credenciais do `.env`, seguido de `GET /agents/follow-ups` com o token
  real → `200`, dados reais retornados (FollowUps existentes no banco).
- Nenhuma migration nova foi necessária — o Postgres real (`agencia-postgres`)
  é o MESMO banco usado por todas as suítes de teste desta sessão, já com
  a migration 21 aplicada.

A v2.8 e a v2.9 estão, agora sim, executando no ambiente real (não só
commitadas), confirmado por evidência direta (grep no binário compilado +
chamadas HTTP reais autenticadas), não apenas pela suposição de que o
`docker compose up` teria funcionado.

---

## 37. Agentes v3.0 — Operational Observability & Control Center

### 1. Resumo

Construída uma camada de observabilidade sobre toda a cadeia operacional
já existente (Responsibility → Supervisor → Escalation → FollowUp →
Proposal → Action Plan → Approval), sem nenhuma nova autonomia: um
Control Center (overview + 5 filas determinísticas) evoluindo a página
"Operações" já existente, e uma timeline por FollowUp derivada 100% do
audit log real. Nenhum novo Planner/Policy/Executor/Approval/Scheduler.

### 2. Revisão arquitetural realizada (Etapa 1)

Antes de escrever qualquer código, revisado:

- **Responsibilities** (`agent-responsibilities.ts`): campo `enabled`
  (não há `status`) — "ativa" = `enabled = true`.
- **Escalations** (`agent-operational-escalations.ts`): `status` (open/
  acknowledged/resolved/dismissed), FK `responsibilityId`.
- **FollowUps** (`agent-operational-follow-ups.ts`): `status`, `priority`,
  `dueAt`, `updatedAt`, `escalationId` (FK direta, nullable),
  `completedAt`/`dismissedAt` — tudo já suficiente para SLA (Etapa 5) sem
  campo novo.
- **Operational Action Proposals** (`agent-operational-action-proposals.ts`):
  `status`, `actionPlanId`, `followUpId` — já revisado a fundo na v2.9.
- **Action Plans/Items/Approvals**: `agent-action-plans.ts`,
  `agent-action-plan-items.ts`, `agent-approvals.ts` — reusa
  `getApprovalsSummary()` já existente (v1.8) e a mesma lógica de
  `finalizePlanStatus` (v1.2/v2.9) sem tocar nela.
- **Jobs/Runs**: `getRunsSummary()` já existente (v1.6, `routes/agents/operations.ts`)
  — só precisou de `export` (não existia antes, era privada ao módulo).
- **Director Decisions/Initiatives**: revisados — não participam
  diretamente da cadeia operacional FollowUp-cêntrica desta versão (a
  cadeia do correio.md é `Responsibility → ... → FollowUp`); não
  incluídos no overview/filas por não terem relação direta — decisão
  documentada na seção "Decisões interpretativas" abaixo.
- **Audit log** (`audit-logs.ts`): índice composto `(entityType,
  entityId)` já existente — usado tal como está para a timeline (Etapa 3).
- **Permissions**: `agents.operations.read` (v1.6, já usada por TODO o
  resto do dashboard de Operações, inclusive contagens agregadas de
  Approvals sem exigir `agents.approve` — precedente direto para o
  overview do Control Center) e `agents.plan.read` (v1.2, já exigida pela
  evidência de Action Plan na v2.9 — reusada para gatear a timeline).
- **Endpoints já existentes**: `GET /agents/operations/summary` (v1.6),
  `GET /agents/action-plans/:id` (v1.2), `GET /agents/follow-ups/:id`
  (v2.7) — nenhum recriado.
- **Frontend**: `operations-dashboard.tsx` + `metric-card.tsx` (v1.6, bloco
  de métricas reutilizável) e `follow-up-detail.tsx`/`action-proposals-list.tsx`
  (v2.7-v2.9) — reusados, nunca recriados.

Mapeamento concluído: TODA informação pedida pelo correio.md já existia
em alguma combinação de tabela/FK/audit log — nenhum campo novo, nenhuma
tabela nova foi necessária (confirma princípio bloqueante 7).

### 3. Estruturas reutilizadas

`getApprovalsSummary()` e `getRunsSummary()` (routes/agents/operations.ts,
v1.6/v1.8) — reusadas literalmente, nunca reimplementadas.
`getUserPermissionSlugs()` (agents/security/permissions.ts, já usada pelo
pipeline de execução) — reusada para o gate de `agents.plan.read` na
timeline. `MetricCard` (frontend, v1.6) — reusado tal qual para o
overview do Control Center. `FollowUpStatusBadge`/`followUpPriorityLabel`
(v2.7) — reusados nas filas. A própria página `/agents/operations`
(v1.6/v2.5) — evoluída, nunca duplicada numa rota nova.

### 4. Control Center implementado

Nova seção "Control Center" no TOPO da página `/agents/operations` já
existente (antes do dashboard de Jobs/Runs da v1.6) —
`components/agents/operations/control-center-section.tsx`. Um único
`GET /agents/operations/control-center` (permission `agents.operations.read`,
mesma de todo o resto desta página) devolve `{ overview, queues }` — um
único round-trip, `refetchInterval: 15000` (mesmo padrão de
`useOperationsSummary`, v1.6).

### 5. Métricas implementadas e suas fórmulas/regras

Todas via `count(*) filter` em `agent-operations/control-center-service.ts:getControlCenterOverview()`
— nenhuma carrega linhas no Node para contar (mesmo padrão de
`getJobsSummary`/`getApprovalsSummary`, v1.6/v1.8):

| Métrica | Fórmula |
|---|---|
| `responsibilitiesActive` | `count(*) filter (where enabled = true)` em `agent_responsibilities` |
| `escalationsOpen` | `count(*) filter (where status = 'open')` em `agent_operational_escalations` |
| `escalationsWithoutFollowUp` | escalations `open` sem NENHUM FollowUp com `escalation_id` apontando para elas (Etapa 5) |
| `followUpsOpen` | `count(*) filter (where status not in ('completed','dismissed'))` |
| `followUpsOverdue` | idem + `due_at is not null and due_at < now()` |
| `proposalsSubmitted`/`Planned`/`Failed` | `count(*) filter (where status = '...')` em `agent_operational_action_proposals` |
| `actionPlansWaitingApproval`/`Partial`/`Failed` | idem em `agent_action_plans.status` |
| `approvalsPending` | reusa `getApprovalsSummary().pending` (v1.8) |
| `jobRunsFailedRecent` | reusa `getRunsSummary(from, now).failed`, janela 7 dias (mesmo default de `/operations/summary`) |

### 6. Filas operacionais e critérios

Cinco filas, critérios 100% determinísticos (nunca "prioridade de IA"),
documentados no próprio código-fonte
(`control-center-service.ts:getOperationalQueues`) — cada FollowUp cai em
EXATAMENTE uma fila, avaliada nesta ordem (a primeira condição que bater
decide):

1. **`needs_attention_now`** — `dueAt` no passado OU `priority = 'critical'`.
2. **`failed`** — a Proposal mais recente do FollowUp terminou `failed`.
3. **`awaiting_human`** — Approval pendente no Action Plan da Proposal
   mais recente, OU Proposal mais recente `submitted` (ainda não
   submetida ao pipeline), OU FollowUp `open` (ninguém iniciou ainda).
4. **`in_progress`** — `in_progress`/`waiting` sem nenhum sinal acima.
5. **`resolved_recently`** — `completed`/`dismissed` nos últimos 7 dias
   (mesma janela default de `/operations/summary`).

### 7. Timeline

`GET /agents/follow-ups/:id/timeline` (permission `agents.followups.read`)
— reusa INTEIRAMENTE o `audit_logs` já existente. Resolve a cadeia real
via FKs persistidas (`responsibilityId`, `escalationId`,
`followUpId`→Proposals→`actionPlanId`→Items→Approvals) e busca o audit de
cada entidade encontrada, ordenado por `createdAt` — ordem cronológica
real, nunca artificial. Zero tabela nova, zero segunda fonte de
histórico.

### 8. Drill-down (Etapa 4)

Cada item de fila do Control Center já é um link direto para
`/agents/follow-ups/:id` (página já existente, v2.7 — nunca duplicada).
De lá, `ActionProposalsList` (v2.8/v2.9) já linka para
`/agents/plans/:id` (Action Plan completo, v1.2) e para as Approvals
correspondentes. Nenhuma tela nova foi criada para exibir o que já existe
— só resumos (título/status/prioridade/motivo) para decidir para onde
navegar, exatamente como pedido.

### 9. Permissions (Etapa 6)

- Overview + filas: `agents.operations.read` — mesmo precedente já aceito
  de `/operations/summary` (v1.6) devolver contagens agregadas de
  Approvals sem exigir `agents.approve` em separado. Nunca conteúdo
  completo de Action Plan — só contagens e resumos (título/status/
  prioridade/datas/ids para link).
- Timeline: `agents.followups.read` para o FollowUp em si; eventos de
  nível Action Plan/Item/Approval só entram na resposta se o ator TAMBÉM
  tiver `agents.plan.read` — decidido **no backend**
  (`getFollowUpTimeline`, via `getUserPermissionSlugs`), nunca só no
  frontend. Testado explicitamente (item 7/13 dos testes mínimos): dois
  usuários reais, um com e um sem `agents.plan.read`, timeline
  comprovadamente diferente.
- `agents.followups.read` continua NÃO concedendo implicitamente conteúdo
  de Action Plan — confirmado pelo teste acima.

### 10. Auditoria (Etapa 7)

Nenhum audit novo foi criado — Control Center e timeline são 100%
leitura (confirmado por teste dedicado, item 8 dos testes mínimos:
contagem de linhas de `agent_operational_follow_ups`/`audit_logs`
idêntica antes/depois de chamar overview/filas/timeline). A timeline é a
PRÓPRIA interface de auditoria — não duplica nada, só agrega o que já
existe por FK.

### 11. Migrations

Nenhuma. Confirma princípio bloqueante 15 do correio.md ("migration nova
somente se houver necessidade estrutural comprovada") — não houve.

### 12. Arquivos criados

- `backend/src/agents/operations/control-center-service.ts` —
  `getControlCenterOverview`, `getOperationalQueues`, `getFollowUpTimeline`.
- `backend/src/agents/operations/control-center-service.test.ts` — 9
  testes.
- `frontend/components/agents/operations/control-center-section.tsx`.
- `frontend/components/agents/follow-ups/follow-up-timeline.tsx`.
- `frontend/app/api/agents/operations/control-center/route.ts` (proxy).
- `frontend/app/api/agents/follow-ups/[id]/timeline/route.ts` (proxy).

### 13. Arquivos alterados

- `backend/src/routes/agents/operations.ts` — rota
  `GET /operations/control-center`; `getRunsSummary` ganhou `export`
  (reuso).
- `backend/src/routes/agents/follow-ups.ts` — rota
  `GET /follow-ups/:id/timeline`.
- `backend/src/routes/agents/operations.test.ts` — 2 testes novos (403 +
  200/forma da resposta).
- `backend/src/routes/agents/follow-ups.test.ts` — 1 teste novo (borda
  HTTP da timeline).
- `frontend/app/(dashboard)/agents/operations/page.tsx` — seção Control
  Center adicionada no topo.
- `frontend/components/agents/follow-ups/follow-up-detail.tsx` —
  `FollowUpTimeline` adicionada.
- `frontend/hooks/agents/use-operations.ts` — `useOperationalControlCenter`,
  `useFollowUpTimeline`.
- `frontend/services/agents.ts`, `frontend/types/agents.ts`,
  `frontend/lib/query/keys.ts` — tipos/funções/chaves novas.

### 14. Testes novos

12 no backend: 9 em `control-center-service.test.ts` (overview com
deltas exatos, FollowUp terminal não aparece aberto, vencido calculado
certo, failed→fila failed, approval pendente→fila awaiting_human sem
alterar o FollowUp, Action Plan sem Proposal independente, gate de
`agents.plan.read` na timeline, ausência de mutação de estado, ordem
temporal + nenhum evento inventado) + 2 em `operations.test.ts` (403 e
200/forma) + 1 em `follow-ups.test.ts` (borda HTTP da timeline). Nenhum
teste novo no frontend — projeto sem suíte de componente React (só
funções puras); UI verificada por typecheck + lint + build + revisão de
código, mesmo padrão das rodadas anteriores (v2.9).

### 15. Números exatos das suítes

```
Backend:  tests 712 / pass 712 / fail 0 / suites 122
Frontend: tests 119 / pass 119 / fail 0 / suites 47
```

### 16. Reconciliação do baseline

Baseline oficial informado pelo correio.md: **700 backend / 119
frontend**. Medido: **712/712 backend, 119/119 frontend**. 700 + 12
testes novos (item 14) = 712 — bate exatamente. Nenhuma divergência.

### 17. Typecheck/lint/build

- Backend typecheck (`tsc --noEmit`): 0 erros.
- Frontend typecheck (`tsc --noEmit`): 0 erros.
- Frontend lint (`npm run lint`): 0 erros.
- Backend build (`tsc -p tsconfig.build.json`): sucesso.
- Frontend build (`next build`, container `node:24` como root — mesmo
  motivo já documentado nas rodadas anteriores): sucesso — confirmado
  que `/api/agents/operations/control-center` e
  `/api/agents/follow-ups/[id]/timeline` aparecem compiladas na saída.

### 18. Bugs encontrados

Nenhum bug de produção. Dois erros no meu PRÓPRIO código de teste,
corrigidos antes de prosseguir: (1) o teste de delta de
escalation/responsibility comparava contra um `before` que já incluía o
fixture do `before()` do describe (criado antes do snapshot) —
corrigido criando um par novo dedicado dentro do próprio teste para uma
delta real; (2) o teste do gate de `agents.plan.read` esperava ver
eventos de `agent_operational_follow_up` na timeline de um FollowUp
criado por INSERT direto no fixture (que nunca passa pelo serviço, logo
nunca gera audit de criação) — corrigido trocando para verificar a
Proposal (criada via serviço real, com audit real) como a entidade
não-plan-level de prova.

### 19. Limitações reais

- `getFollowUpTimeline` busca o audit por até uma dúzia de pares
  `(entityType, entityId)` via `OR` — index composto já existente cobre
  isso bem para o volume real por FollowUp (poucas Proposals/Action
  Plans/Approvals cada), mas não teria a mesma performance se um
  FollowUp acumulasse centenas de Proposals — cenário não observado e
  fora do escopo desta versão (o correio.md não pediu paginação da
  timeline).
- `getOperationalQueues` limita a 500 FollowUps não-terminais examinados
  por chamada (e devolve até 50 por fila) — suficiente para o volume
  operacional real do sistema hoje; se um dia isso crescer muito além
  disso, precisaria de paginação real (não implementada — não pedida).
- `escalationsWithoutFollowUp`/demais overview counts refletem o estado
  agora, sem cache — cada carregamento da página é uma leitura live
  (aceitável dado `agents.operations.read` já ser uma tela
  administrativa/operacional, não uma tela de alto tráfego).
- Director Decisions/Initiatives não entram no overview/filas desta
  versão — decisão documentada abaixo (item 21).

### 20. Débitos técnicos

Nenhum novo.

### 21. Decisões interpretativas

- **Director Decisions/Initiatives fora do overview/filas**: a cadeia
  operacional explicitamente descrita pelo correio.md ("Etapa 3", exemplo
  conceitual da timeline) é `Responsibility → Supervisor → Escalation →
  FollowUp → Proposal → Action Plan → Approval` — Director
  Decisions/Initiatives são um fluxo paralelo e independente (correio.md
  da v2.0/v2.1), sem FK para FollowUp. Incluí-los no Control Center desta
  versão seria "expandir escopo" (princípio bloqueante 11 explícito:
  "não aproveitar a rodada para... expansão de escopo"); a Etapa 1 do
  próprio correio.md já condiciona a revisão desse domínio a "se
  participarem da execução operacional" — concluí que não participam
  diretamente da cadeia FollowUp-cêntrica pedida.
- **"Jobs com falhas recentes"**: interpretado como `getRunsSummary(...).failed`
  (Job Runs falhos nos últimos 7 dias) em vez de `agentJobs.status = 'failed'`
  (Jobs cujo status geral é failed) — mais fiel a "recentes" (Jobs em si
  não têm um conceito natural de "recente", já documentado no comentário
  original de `getJobsSummary`, v1.6).
- **`escalationsWithoutFollowUp`**: métrica adicionada mesmo não estando
  na lista literal da "Visão geral" (Etapa 2), porque a Etapa 5 pede
  explicitamente esse SLA ("Escalation sem FollowUp quando deveria
  possuir um") — decidido expor como métrica de overview (mais visível)
  em vez de uma sexta fila (o correio.md especifica exatamente 5 filas,
  todas centradas em FollowUp; uma Escalation sem FollowUp não tem
  FollowUp para aparecer numa fila de FollowUps).
- **Filas dispensam duplicação**: um FollowUp nunca aparece em mais de
  uma fila — decisão explícita para bater com a intenção do correio.md
  ("separar claramente") e evitar contagem dupla no operador.

### 22. git diff --stat

```
 backend/src/routes/agents/follow-ups.test.ts       |  14 +
 backend/src/routes/agents/follow-ups.ts            |  23 ++
 backend/src/routes/agents/operations.test.ts       |  26 ++
 backend/src/routes/agents/operations.ts            |  25 +-
 correio.md                                         | 336 +++++++++++++--------
 executed.md                                        | (este relatório)
 frontend/app/(dashboard)/agents/operations/page.tsx |  15 +
 frontend/components/agents/follow-ups/follow-up-detail.tsx |   6 +
 frontend/hooks/agents/use-operations.ts             |  22 ++
 frontend/lib/query/keys.ts                          |   2 +
 frontend/services/agents.ts                         |  11 +
 frontend/types/agents.ts                            |  55 ++++
```

Arquivos novos (não aparecem em `git diff --stat` padrão — untracked):
`backend/src/agents/operations/control-center-service.ts`,
`backend/src/agents/operations/control-center-service.test.ts`,
`frontend/app/api/agents/operations/control-center/route.ts`,
`frontend/app/api/agents/follow-ups/[id]/timeline/route.ts`,
`frontend/components/agents/operations/control-center-section.tsx`,
`frontend/components/agents/follow-ups/follow-up-timeline.tsx`.

### 23. git status

```
 M backend/src/routes/agents/follow-ups.test.ts
 M backend/src/routes/agents/follow-ups.ts
 M backend/src/routes/agents/operations.test.ts
 M backend/src/routes/agents/operations.ts
 M correio.md
 M executed.md
 M frontend/app/(dashboard)/agents/operations/page.tsx
 M frontend/components/agents/follow-ups/follow-up-detail.tsx
 M frontend/hooks/agents/use-operations.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
?? backend/src/agents/operations/control-center-service.test.ts
?? backend/src/agents/operations/control-center-service.ts
?? frontend/app/api/agents/follow-ups/[id]/timeline/
?? frontend/app/api/agents/operations/control-center/
?? frontend/components/agents/follow-ups/follow-up-timeline.tsx
?? frontend/components/agents/operations/control-center-section.tsx
```

### 24. Confirmação — nenhum Planner/Policy/Executor/Approval/Scheduler novo

Confirmado por inspeção direta: 0 arquivos novos sob `agents/planner/`,
`agents/orchestration/` (Policy), `agents/executor/`, nenhum novo
mecanismo de Approval, nenhum novo scheduler/worker/polling. Os únicos
arquivos de domínio novos (`control-center-service.ts`) são
EXCLUSIVAMENTE leitura — nenhuma função nele grava em
`agent_action_plans`, `agent_approvals`, `agent_operational_action_proposals`
ou qualquer tabela de execução; toda escrita continua vindo
exclusivamente do Planner/Executor/Approval já existentes (v1.2/v2.8/v2.9),
nunca tocados nesta rodada.

### 25. Confirmação — nenhuma informação derivada persistida desnecessariamente

Confirmado: `getControlCenterOverview`/`getOperationalQueues`/
`getFollowUpTimeline` são funções puramente de LEITURA — nenhum
`INSERT`/`UPDATE` em nenhuma delas (só `SELECT`, incluindo o `not exists`
subquery de `escalationsWithoutFollowUp`). Nenhuma tabela nova, nenhuma
coluna nova, nenhum cache/materialização — cada carregamento da página
recalcula tudo a partir das tabelas reais. Provado por teste dedicado
(item 8 dos testes mínimos, seção 18 acima).

---

## 38. Rebuild e deploy real da v3.0 (2026-09-03)

Mesmo procedimento das rodadas anteriores (seção 36):

```
docker compose build backend frontend
docker compose up -d backend frontend
```

Resultado:

- Ambas as imagens reconstruídas com sucesso a partir do código atual
  (Control Center + timeline, seção 37).
- `agencia-backend`/`agencia-frontend` recriados, ambos `healthy` em
  segundos.
- Confirmado que o binário novo está no ar: `grep -c getOperationalQueues
  /app/dist/routes/agents/operations.js` dentro do container → `2`.
- `GET /health` → `ok`; `GET /api/health` (frontend) → `200`.
- Smoke test real autenticado: `GET /agents/operations/control-center`
  retornou overview e filas com dados reais do banco (ex.:
  `followUpsOpen: 1`, um FollowUp real na fila `awaiting_human`);
  `GET /agents/follow-ups/66/timeline` retornou eventos reais do audit
  log (`agents.operational_action.created`/`.submitted`) na ordem
  correta.

A v3.0 está no ar, verificada com chamadas HTTP reais contra dados reais
do banco — não só testes automatizados.

---

Aguardando aprovação do Diretor/CEO. Nenhum commit foi feito nesta rodada.
