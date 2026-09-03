# Agentes v2.7 — Operational Follow-up & Coordinated Workflows
## Relatório de execução do correio.md

**Não foi feito commit.** Todas as alterações estão no working tree, aguardando revisão do Diretor/CEO.

---

## 1. Resumo

Implementada a camada de acompanhamento operacional estruturado (`OperationalFollowUp`) sobre Responsibilities/Escalations v2.6 e o Operational Supervisor v2.5. Um FollowUp representa "este assunto precisa ser acompanhado até que exista uma conclusão operacional" — nunca uma autorização para executar. A empresa agora consegue, para qualquer escalation aberta (ou diretamente a partir de uma Responsibility), acompanhar formalmente quem é o dono, qual é o estado, qual é o prazo e qual foi a resolução, sem conceder nenhuma permissão nova de execução e sem criar um caminho paralelo ao pipeline oficial (Planner → Policy → Executor → Approval).

## 2. Revisão da arquitetura encontrada

Revisão real (não inferência por nome) feita antes de codificar:
- `backend/src/agents/responsibilities/` — ownership 100% determinístico (`resolveOperationalResponsibility`), reaproveitado como fonte única de verdade para `ownerAgentId` do FollowUp (nunca recalculado).
- `backend/src/agents/escalations/` — `createOrReopenEscalation` (dedup atômico via `ON CONFLICT DO NOTHING` + `SELECT...FOR UPDATE` na trilha de conflito) e `escalateSupervisorFinding` (ponto único de integração com o Supervisor v2.5) — o padrão de dedup/reabertura foi replicado 1:1 para FollowUps; o ponto de integração automática foi anexado dentro de `escalateSupervisorFinding`, não em `supervisor-service.ts` (evita acoplar o módulo de baixo nível de Escalation ao de FollowUp).
- `backend/src/agents/operations/` — `runOperationalSupervision` e seu loop de incidentes, confirmando que a integração v2.7 não precisa (e não deve, seção 6.C) conectar o Supervisor diretamente a FollowUp — só via Escalation.
- `backend/src/agents/director/decisions/` — Decision Queue confirmada como semanticamente distinta (sem conceito de Responsibility/Escalation/prazo/estado prolongado) — mantida intacta, nenhuma sobreposição.
- Jobs/Runs, Action Plans, Approvals — confirmado que nenhum desses precisa de alteração; FollowUp nunca os referencia.
- `backend/src/db/schema/` — convenções de FK `restrict` (preserva histórico) vs. `set null` (referência opcional), índice único simples para dedup, `check()` constraint quando há dependência cruzada entre colunas (não foi necessário aqui — vocabulário fechado já validado em 2 camadas, Zod + serviço).
- `backend/src/db/seed.ts` — nenhuma permission existente cobre "acompanhamento estruturado com prazo/estado" — confirma a necessidade de `agents.followups.read`/`.manage`.
- Padrões de API (`event-rules.ts`, `escalations.ts`) e frontend (`AgentsSubNav`, `EscalationsList`, hooks `use-escalations.ts`) — replicados por analogia direta.

## 3. Modelo adotado

`OperationalFollowUp` (tabela `agent_operational_follow_ups`), com dois caminhos de criação:
- **Automático** (seção 6.A): a partir de uma `OperationalEscalation` recém-criada/reaberta, via `createOrReopenFollowUpFromEscalation`, chamada internamente por `escalations/supervisor-integration.ts:escalateSupervisorFinding` — nunca pelo Supervisor diretamente (seção 6.C).
- **Gerencial** (seção 6.B, avaliado e implementado por ter caso de uso real e seguro): `POST /agents/follow-ups`, criação estruturada associada a uma Responsibility real, sempre com permission `agents.followups.manage`.

`ownerAgentId` é sempre uma cópia congelada de `responsibility.agentId` no momento da criação — nunca segue mudanças posteriores de dono (seção 9), mesmo princípio já usado por `agent_operational_escalations.sourceAgentId` (v2.6).

## 4. Estados/transições

Vocabulário fechado exatamente como sugerido: `open | in_progress | waiting | completed | dismissed`.

```
open        → in_progress, waiting, completed, dismissed
in_progress → waiting, completed, dismissed
waiting     → in_progress, completed, dismissed
completed   → (terminal)
dismissed   → (terminal)
```

Validado em `followups/types.ts:FOLLOW_UP_TRANSITIONS` + `service.ts:assertTransition()`, retornando 409 para qualquer transição fora do mapa. Nenhum endpoint `PATCH` genérico de `status` existe — só ações específicas (`/start`, `/wait`, `/resume`, `/complete`, `/dismiss`), confirmado por teste de rota (`PATCH /agents/follow-ups/:id → 404`).

**Decisão documentada sobre `acknowledgedAt`**: o campo conceitual da seção 3 não corresponde a um estado separado na máquina de estados real da seção 4 (não existe `acknowledged`). Mapeado para a transição real `open → in_progress` (`startFollowUp`), gravado só na primeira vez (nunca sobrescrito em uma segunda entrada em `in_progress` vinda de `waiting`) — preserva quando o acompanhamento realmente começou.

## 5. Ownership

Owner sempre derivado da Responsibility real, nunca recalculado, nunca inventado por LLM. Criação automática: `responsibility.agentId` (a mesma Responsibility que gerou a Escalation). Criação gerencial: `responsibility.agentId` da Responsibility informada no payload (validada com `assertResponsibilityExists`-equivalente antes de qualquer insert). Reassignment (avaliado como necessário e implementado, seção 9) altera **só** `assignedUserId` (humano) — `ownerAgentId` é imutável após a criação, auditado com o valor anterior (`agents.followup.reassigned`), rejeitado para FollowUp terminal (409).

## 6. Relação Responsibility → Escalation → FollowUp

```
Responsibility (v2.6, ownership determinístico)
      │
      ▼
Escalation (v2.6, criada/reaberta pelo Supervisor via escalateSupervisorFinding)
      │  (só quando created || reopened — nunca no no-op de uma escalation já ativa)
      ▼
FollowUp (v2.7, createOrReopenFollowUpFromEscalation — best-effort, try/catch próprio)
```

Relação com Escalation definida explicitamente (seção 14): **unidirecional, determinística, nunca mágica**. `acknowledge` da Escalation não conclui o FollowUp; concluir o FollowUp não resolve automaticamente a Escalation (testado explicitamente — `20: conclusão não destrói a escalation de origem`, que também verifica que a Escalation permanece `open`). Nenhuma sincronização bidirecional foi implementada.

## 7. Estratégia de deduplicação

- **Origem `escalation`**: `dedupKey = "escalation:${escalationId}"` — a Escalation já é o evento deduplicado pela v2.6 (seu próprio `dedupKey` já garante unicidade por ocorrência real); um FollowUp por Escalation é suficiente e simples, decisão documentada em `service.ts`.
- **Origem `responsibility`** (criação gerencial manual): `dedupKey = "manual:${responsibilityId}:${randomUUID()}"` — cada criação manual é um ato humano deliberado, sem semântica de "mesma ocorrência" a deduplicar; a coluna continua `NOT NULL UNIQUE` para manter uma única disciplina de dedup em toda a tabela.
- Reocorrência após terminal (`completed`/`dismissed`) **reabre a mesma linha** — nunca insere uma segunda (mesmo padrão de `escalations/service.ts` e `goals/review-service.ts` desde a v2.0).

## 8. Tratamento de concorrência

Idêntico ao padrão já comprovado em `escalations/service.ts:createOrReopenEscalation`: `INSERT ... ON CONFLICT (dedup_key) DO NOTHING RETURNING *` como tentativa atômica primária; na trilha de conflito, uma `db.transaction` com `SELECT ... FOR UPDATE` sobre a linha do `dedupKey` decide reabrir (terminal) ou devolver como está (ainda ativa) — nunca um SELECT-then-INSERT desprotegido. **Testado com concorrência real**: 8 chamadas simultâneas via `Promise.all` sobre a mesma Escalation produzem exatamente 1 linha, nenhum erro inesperado, nenhum histórico corrompido (`service.test.ts`, teste "6").

## 9. Permissions

Avaliado reuso primeiro — nenhuma permission existente cobre "acompanhamento estruturado". 2 permissions criadas:
- `agents.followups.read`
- `agents.followups.manage`

CEO recebe automaticamente (mecanismo existente do seed, inalterado). Toda proteção real está no backend (`requirePermission` em cada rota); `PermissionGate` no frontend é só UX.

## 10. Auditoria

Reaproveitado `audit()` existente, sem alteração. Eventos: `agents.followup.created`, `.reopened`, `.started`, `.waiting`, `.resumed`, `.completed`, `.dismissed`, `.reassigned`; `agents.followup.creation_failed` (best-effort da integração automática). Nenhum evento redundante — `started` só audita uma vez por chamada real de transição (nunca um segundo evento para o mesmo `acknowledgedAt` preservado).

## 11. API

Rotas em `backend/src/routes/agents/follow-ups.ts`, seguindo o idioma real do módulo (`authenticate` + `requirePermission` em toda rota):

**Consulta** (`agents.followups.read`): `GET /agents/follow-ups` (filtros: `status`, `priority`, `ownerAgentId`, `assignedUserId`, `responsibilityId`, `escalationId`, `overdue`), `GET /agents/follow-ups/:id`.

**Criação gerencial** (`agents.followups.manage`): `POST /agents/follow-ups`.

**Transições** (`agents.followups.manage`): `POST /agents/follow-ups/:id/start`, `/wait` (exige `waitingReason`), `/resume`, `/complete` (exige `resolution`), `/dismiss` (exige `reason`), `/reassign` (`assignedUserId` nullable, validado contra `users` real).

Nenhum `PATCH` genérico de `status` — confirmado por teste de rota.

## 12. Frontend

Integrado à navegação existente do módulo Agentes (`AgentsSubNav`, item "Follow-ups"). Página `/agents/follow-ups` com: resumo de atenção no topo (Open/In Progress/Waiting/Overdue/Critical — 100% derivado dos dados carregados, nenhum sistema de analytics novo, seção 19); listagem filtrável (status/priority/vencidos); tabela com título, owner, atribuído, prioridade, status, origem, prazo, idade; ações que só aparecem quando válidas para o estado atual (seção 20 — Iniciar/Aguardar/Concluir/Descartar em `open`, Retomar/Concluir/Descartar em `waiting`, só leitura em `completed`/`dismissed`), sempre revalidadas pelo backend. Diálogo de criação gerencial (`CreateFollowUpDialog`) 100% estruturado — `responsibilityId` é sempre um `<Select>` sobre Responsibilities reais, nunca um id digitado.

## 13. Migrations

`npx drizzle-kit generate --name agent_operational_follow_ups` → `backend/drizzle/0019_agent_operational_follow_ups.sql` (+ `meta/0019_snapshot.json` + entrada em `meta/_journal.json`, autogerados). Aplicada via `npx drizzle-kit migrate` — fluxo oficial limpo (confirmado: `agent_operational_follow_ups` 27 colunas / 7 índices / 7 FKs; `[✓] migrations applied successfully!`). Nenhuma migration antiga foi editada.

Índices criados: `dedup_idx` (único), `status_idx`, `owner_idx`, `assigned_user_idx`, `responsibility_idx`, `escalation_idx`, `due_at_idx`. FKs: `responsibilityId`/`ownerAgentId`/`createdBy` em `restrict` (preserva histórico); `escalationId`/`assignedUserId`/`completedBy`/`dismissedBy` em `set null` (referência opcional).

## 14. Arquivos criados

**Backend:**
- `backend/drizzle/0019_agent_operational_follow_ups.sql`
- `backend/drizzle/meta/0019_snapshot.json`
- `backend/src/db/schema/agent-operational-follow-ups.ts`
- `backend/src/agents/followups/types.ts`
- `backend/src/agents/followups/schemas.ts`
- `backend/src/agents/followups/service.ts`
- `backend/src/agents/followups/service.test.ts`
- `backend/src/routes/agents/follow-ups.ts`
- `backend/src/routes/agents/follow-ups.test.ts`

**Frontend:**
- `frontend/app/api/agents/follow-ups/route.ts`
- `frontend/app/api/agents/follow-ups/[id]/route.ts`
- `frontend/app/api/agents/follow-ups/[id]/start/route.ts`
- `frontend/app/api/agents/follow-ups/[id]/wait/route.ts`
- `frontend/app/api/agents/follow-ups/[id]/resume/route.ts`
- `frontend/app/api/agents/follow-ups/[id]/complete/route.ts`
- `frontend/app/api/agents/follow-ups/[id]/dismiss/route.ts`
- `frontend/app/api/agents/follow-ups/[id]/reassign/route.ts`
- `frontend/app/(dashboard)/agents/follow-ups/page.tsx`
- `frontend/components/agents/follow-ups/follow-ups-list.tsx`
- `frontend/components/agents/follow-ups/create-follow-up-dialog.tsx`
- `frontend/components/agents/follow-ups/wait-follow-up-dialog.tsx`
- `frontend/components/agents/follow-ups/complete-follow-up-dialog.tsx`
- `frontend/components/agents/follow-ups/dismiss-follow-up-dialog.tsx`
- `frontend/hooks/agents/use-follow-ups.ts`

## 15. Arquivos alterados

**Backend:**
- `backend/src/agents/escalations/supervisor-integration.ts` — hook best-effort para `createOrReopenFollowUpFromEscalation` dentro de `escalateSupervisorFinding`, só quando `created || reopened`.
- `backend/src/agents/escalations/supervisor-integration.test.ts` — teste novo confirmando a geração automática do FollowUp; cleanup de `agentOperationalFollowUps` no `after()`.
- `backend/src/db/schema/index.ts` — exporta o novo módulo de schema.
- `backend/src/db/seed.ts` — 2 novas permissions.
- `backend/src/routes/agents/index.ts` — registra `followUpsRoutes`.
- `backend/drizzle/meta/_journal.json` — entrada da migration 0019 (autogerado).

**Frontend:**
- `frontend/types/agents.ts` — tipos v2.7.
- `frontend/services/agents.ts` — funções de serviço v2.7.
- `frontend/lib/query/keys.ts` — query keys v2.7.
- `frontend/lib/agents/derived.ts` — 3 novas funções de label.
- `frontend/lib/agents/derived.test.ts` — testes das 3 novas funções.
- `frontend/components/agents/status-badge.tsx` — `FollowUpStatusBadge`.
- `frontend/components/agents/agents-sub-nav.tsx` — 1 novo item de navegação.

## 16. Testes adicionados por arquivo

| Arquivo | Testes |
|---|---|
| `backend/src/agents/followups/service.test.ts` | 14 |
| `backend/src/routes/agents/follow-ups.test.ts` | 10 |
| `backend/src/agents/escalations/supervisor-integration.test.ts` (novo teste) | 1 |
| **Total backend** | **25** |
| `frontend/lib/agents/derived.test.ts` (3 funções × 2) | 6 |
| **Total frontend** | **6** |

## 17. Números exatos das suítes

**Backend:**
```
ℹ tests 669
ℹ pass 669
ℹ fail 0
```

**Frontend:**
```
ℹ tests 117
ℹ pass 117
ℹ fail 0
```

## 18. Reconciliação com baseline

- Backend: baseline `644` + `25` testes novos = `669` esperado → `669` medido. **Reconciliado exatamente.**
- Frontend: baseline `111` + `6` testes novos = `117` esperado → `117` medido. **Reconciliado exatamente.**

Nenhuma divergência de baseline.

## 19. Typecheck

- Backend: `npx tsc --noEmit` — sem erros (2 execuções: após schema/service, e novamente após rotas/seed/testes).
- Frontend: `npx tsc --noEmit` — sem erros (limpo já na primeira execução desta rodada).

## 20. Build

- Frontend: `npm run build` — sucesso, `✓ Compiled successfully`, todas as rotas novas presentes (`/agents/follow-ups` + 8 rotas `/api/agents/follow-ups/**`).
- Backend: sem build de produção separado (roda TypeScript direto via `tsx`, conforme `Dockerfile`).

## 21. Bugs encontrados

Nenhum bug foi encontrado no código de produção entregue — a suíte completa (669 backend + 117 frontend) está 100% verde desde a primeira execução após a implementação. Nenhum retrabalho de correção foi necessário nesta rodada (diferente da v2.6, onde 2 pequenos problemas de fixture de teste precisaram de ajuste).

## 22. Limitações reais

- `dueAt`/`nextReviewAt` são campos persistidos com filtros (`overdue`), mas nenhum scheduler/lembrete automático foi construído — conforme pedido explicitamente na seção 11 ("não construir mecanismo complexo somente para 'usar' os campos"). Um FollowUp vencido só aparece destacado quando alguém consulta a listagem.
- O resumo de atenção do frontend (seção 19) é calculado sobre uma janela de até 100 FollowUps mais recentes (mesmo limite de página usado em outras dashboards do módulo) — em um volume muito maior que isso, os contadores deixariam de refletir o total real. Não foi criado um endpoint de agregação dedicado por ser exatamente o tipo de "novo sistema de analytics" que a seção 19 pede para evitar.
- Reassignment (seção 9) foi implementado só para `assignedUserId` (humano) — não existe "reassign de owner" (agente), porque o owner é estruturalmente a Responsibility, e trocar o dono de uma Responsibility já é uma operação do módulo v2.6 (`PATCH /agents/responsibilities/:id`), não do FollowUp.

## 23. Débitos técnicos

- Nenhum débito técnico novo introduzido nesta rodada. Os 3 erros de lint pré-existentes (rodadas anteriores, arquivos não tocados) continuam fora do escopo desta entrega.

## 24. git diff --stat

```
 backend/drizzle/meta/_journal.json                        |    7 +
 backend/src/agents/escalations/supervisor-integration.test.ts |  25 +-
 backend/src/agents/escalations/supervisor-integration.ts      |  28 +
 backend/src/db/schema/index.ts                             |    3 +-
 backend/src/db/seed.ts                                     |   10 +
 backend/src/routes/agents/index.ts                         |    2 +
 frontend/components/agents/agents-sub-nav.tsx              |    1 +
 frontend/components/agents/status-badge.tsx                |   19 +
 frontend/lib/agents/derived.test.ts                        |   45 +
 frontend/lib/agents/derived.ts                              |   36 +
 frontend/lib/query/keys.ts                                 |    2 +
 frontend/services/agents.ts                                |   62 +
 frontend/types/agents.ts                                    |   41 +
 13 files changed, 278 insertions(+), 3 deletions(-)
```

Arquivos novos (untracked, `git diff --stat` padrão não os lista): 24 arquivos novos no backend e frontend (seção 14), totalizando aproximadamente 2.500 linhas de código/teste novo — mais o `meta/0019_snapshot.json` autogerado (9.895 linhas, dump completo do estado do schema pelo Drizzle, não código escrito à mão).

## 25. git status

```
Changes not staged for commit:
  modified:   backend/drizzle/meta/_journal.json
  modified:   backend/src/agents/escalations/supervisor-integration.test.ts
  modified:   backend/src/agents/escalations/supervisor-integration.ts
  modified:   backend/src/db/schema/index.ts
  modified:   backend/src/db/seed.ts
  modified:   backend/src/routes/agents/index.ts
  modified:   correio.md
  modified:   frontend/components/agents/agents-sub-nav.tsx
  modified:   frontend/components/agents/status-badge.tsx
  modified:   frontend/lib/agents/derived.test.ts
  modified:   frontend/lib/agents/derived.ts
  modified:   frontend/lib/query/keys.ts
  modified:   frontend/services/agents.ts
  modified:   frontend/types/agents.ts

Untracked files:
  backend/drizzle/0019_agent_operational_follow_ups.sql
  backend/drizzle/meta/0019_snapshot.json
  backend/src/agents/followups/
  backend/src/db/schema/agent-operational-follow-ups.ts
  backend/src/routes/agents/follow-ups.test.ts
  backend/src/routes/agents/follow-ups.ts
  frontend/app/(dashboard)/agents/follow-ups/
  frontend/app/api/agents/follow-ups/
  frontend/components/agents/follow-ups/
  frontend/hooks/agents/use-follow-ups.ts
```

`correio.md` aparece modificado porque já continha a v2.7 no início desta execução (não foi alterado por mim).

---

## Critério final de aprovação (seção 29)

> A empresa agora consegue acompanhar formalmente uma responsabilidade operacional do surgimento até sua conclusão, sabendo quem é responsável, qual é o estado, qual é o prazo e qual foi a resolução — sem conceder novas permissões nem criar um caminho paralelo de execução.

Confrontado: ✅ Toda escalation aberta pelo Supervisor gera automaticamente um FollowUp com owner real (da Responsibility), estado determinístico, prazo opcional e histórico de conclusão auditável. Nenhuma nova permissão de execução foi criada (`agents.followups.*` só gerenciam o registro de acompanhamento). Nenhum caminho paralelo de execução existe — `FollowUp` nunca chama tool/Action Plan/Executor; qualquer ação real identificada por um follow-up precisa passar pelo pipeline oficial já existente, iniciada por um humano/agente autorizado.

Todos os 12 princípios bloqueantes (seção 1) foram respeitados — nenhuma coluna concede permission ou altera autonomia, nenhuma execução direta, LLM nunca decide ownership/transição, toda associação aponta para registros reais (validado + FK), histórico nunca destruído, transições determinísticas, dedup atômico testado sob concorrência real, nenhum mecanismo paralelo de Jobs/Action Plans/Approvals/Decisions foi criado, nenhuma comunicação agent-to-agent livre existe.

---

Aguardando aprovação do Diretor/CEO. Nenhum commit foi feito nesta rodada.
