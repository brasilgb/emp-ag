# Agentes v2.6 — Agent Responsibilities, Operational Ownership & Escalation
## Relatório de execução do correio.md

**Não foi feito commit.** Todas as alterações estão no working tree, aguardando revisão e aprovação do Diretor/CEO.

---

## 1. Resumo

Implementada a camada formal de responsabilidade operacional pedida pela v2.6: quem observa cada domínio da empresa, o que deve fazer, e para quem escala quando algo precisa de atenção. Dois conceitos novos e persistidos — `AgentResponsibility` (ownership determinístico por domínio) e `OperationalEscalation` (notificação formal, nunca execução) — mais uma integração best-effort, orgânica, com o Operational Supervisor v2.5. Nenhum mecanismo paralelo foi criado onde algo reutilizável já existia: a Decision Queue v1.9 continua servindo `manual_attention` sem alteração; o pipeline oficial (Planner → Policy → Executor → Approval) nunca foi tocado; Recovery v2.4 e Circuit Breaker v1.5 permanecem intactos. Resolução de ownership e transições de estado são 100% determinísticas — nenhuma decisão de autorização, ownership ou segurança passa por LLM.

## 2. Revisão da arquitetura encontrada

Antes de escrever qualquer código, revisei (leitura real, não inferência por nome):
- `backend/src/agents/director/decisions/` (Decision Queue v1.9) — `agent_director_decisions` tem `assignedUserId` (só humano), chave por sinal operacional bruto (domain/type/entityId), sem conceito de "responsibility" persistida nem de "target agent". Reaproveitada sem alteração para `manual_attention` (v2.4/v2.5).
- `backend/src/agents/operations/` (Operational Supervisor v2.5) — `OperationalIncident` tem `entityType`/`entityId` mas nenhum campo de domínio; `runOperationalSupervision()` já tem o loop `for (const incident of incidents)` onde a integração v2.6 se encaixa sem duplicar o `applyResponse()` existente.
- `backend/src/agents/director/types.ts` — comentário documentando a convenção `department → domain` (nunca implementada até agora); reaproveitada literalmente em `resolveDomainForJob`.
- `backend/src/routes/agents/event-rules.ts` — confirmado o idioma de rota DELETE (fetch → 404 → delete → audit → 204) usado como referência para as novas rotas.
- `backend/src/db/schema/` — convenções de `check()` constraint (`agent_approvals`), `onDelete: 'restrict'` para preservar histórico, índices únicos para dedup atômico (`agentDirectorDecisions.deduplicationKey`).
- `backend/src/db/seed.ts` — catálogo real de permissions; nenhuma permission existente (`agents.director.*`, `agents.operations.*`, `agents.recovery.manage`) cobre "quem é dono de um domínio" ou "escalations operacionais" — confirmando a necessidade de 4 permissions novas.

## 3. Modelo conceitual adotado

- **Responsibility ≠ Permission**: nenhuma coluna de `agent_responsibilities` concede autonomia, role ou permission. Toda execução real continua exigindo o pipeline oficial.
- **Ownership 100% determinístico**: `resolveOperationalResponsibility()` só lê `domain` + `enabled=true` (+ opcionalmente `responsibilityType`), ordenado por prioridade. Zero LLM.
- **Escalation ≠ execução**: `agent_operational_escalations` não referencia Action Plan, tool ou execução — é puramente uma notificação/registro gerencial.
- **Integração best-effort e ortogonal**: a escalation para o dono do domínio é independente de qual resposta técnica (`safe_recovery`/`observe`/etc.) o Supervisor já aplicou.

## 4. Responsibilities

`AgentResponsibility` (tabela `agent_responsibilities`): `agentId`, `name`, `description`, `domain` (reaproveita o vocabulário `SignalDomain`: `crm|projects|finance|support|agents`), `responsibilityType` (`monitor|review|coordinate|follow_up`), `enabled`, `priority` (reaproveita o vocabulário já usado por Goals/Initiatives/Decisions: `low|medium|high|critical`), `conditions` (jsonb descritivo, nunca DSL executável), `escalationPolicy`, `escalationTargetAgentId`/`escalationTargetUserId`, `createdBy`, timestamps.

## 5. Ownership resolution

`resolveOperationalResponsibility({ domain, responsibilityType? })` em `backend/src/agents/responsibilities/ownership.ts`: filtra por `domain` exato + `enabled=true`, ordena por prioridade (`critical` → `high` → `medium` → `low`, empate por `createdAt` mais antigo). `resolvePrimaryResponsibility()` é o atalho usado pela integração com o Supervisor. Determinístico do início ao fim — nenhuma chamada a LLM em nenhum ponto deste módulo.

## 6. Escalation model

`OperationalEscalation` (tabela `agent_operational_escalations`): `responsibilityId` (FK restrict), `sourceAgentId` (cópia do dono no momento da criação — nunca segue mudanças posteriores de ownership), `targetAgentId`/`targetUserId`, `reason`, `severity`, `status`, `entityType`/`entityId`, `dedupKey` (índice único), `metadata`, timestamps de criação/acknowledge/resolve/dismiss com os respectivos atores.

## 7. Escalation policy

`none | agent | human | agent_then_human`. `agent_then_human` é interpretado como "ambos os alvos populados na MESMA escalation" — nunca um estágio temporal automático (isso seria exatamente o "multi-stage escalation engine" que a v2.6 pede explicitamente para NÃO construir). CHECK constraint no banco (`agent_responsibilities_escalation_target_matches_policy`) garante que o(s) alvo(s) certo(s) estão preenchidos para a política escolhida — validado em 3 camadas: Zod (`.superRefine`) no create, validação de serviço no update (cobre PATCH parcial), CHECK constraint como garantia definitiva no banco.

## 8. Severity

`info | warning | critical` — vocabulário fechado, reaproveitado 1:1 do `OperationalSeverity` do Supervisor v2.5 (nome de tipo distinto — `EscalationSeverity` — mas mesmos valores, permitindo passthrough direto em `severityFromIncident()`).

## 9. Estados

`open → acknowledged → resolved` ou `open → dismissed` ou `acknowledged → dismissed`. `resolved`/`dismissed` são terminais para ações de usuário — só reabrem via o mecanismo interno de reocorrência (nunca por uma ação humana direta).

## 10. Transitions

Validadas no backend via `ESCALATION_TRANSITIONS` (`backend/src/agents/escalations/types.ts`) e aplicadas em `assertTransition()` (`service.ts`), que lança `AgentError('conflict', ...)` → HTTP 409 para qualquer transição fora do mapa. Testado explicitamente (item 16 do correio, testes 17 do arquivo `service.test.ts` e teste "29" do arquivo de rota).

## 11. Integração com Operational Supervisor

`backend/src/agents/escalations/supervisor-integration.ts`. Dentro do loop principal de `runOperationalSupervision()`, após `results.push(result)`, chama `escalateSupervisorFinding(incident)` — sempre `best-effort` (try/catch com `audit({ action: 'agents.escalation.creation_failed', ... })` em caso de falha, o scan NUNCA é interrompido) e NUNCA em dry-run (zero side effects preservados da v2.5). `resolveIncidentDomain()` mapeia `entityType` → domínio de forma determinística: `initiative`/`executive_review`/`strategic_memory` via coluna `domain` real (direto ou via FK); `agent_job`/`agent_job_run` via `agents.department → DEPARTMENT_TO_DOMAIN`; os 4 tipos sem entidade de origem inequívoca (`delivery_failure`, `approval_bottleneck`, `manual_attention_required`, `operational_degradation`) retornam `null` deliberadamente — nunca adivinhados.

## 12. Estratégia de deduplicação

`dedupKey = "${responsibilityId}:${incidentType}:${entityType}:${entityId}"`, índice único simples (`agent_operational_escalations_dedup_idx`). Criação via `INSERT ... ON CONFLICT (dedup_key) DO NOTHING RETURNING *` — nunca um SELECT-then-INSERT desprotegido. Reocorrência após `resolved`/`dismissed` reabre a MESMA linha (mesmo padrão já usado por `goals/review-service.ts` desde a v2.0) em vez de inserir uma segunda.

## 13. Proteção contra race condition

Quando o INSERT atômico perde a corrida (0 linhas retornadas), uma transação curta com `SELECT ... FOR UPDATE` sobre a linha do `dedupKey` decide: se sumiu (corrida extrema), reinsere; se terminal (`resolved`/`dismissed`), reabre; se ainda ativa (`open`/`acknowledged`), devolve como está — um no-op real. Testado com concorrência de verdade: 8 chamadas simultâneas via `Promise.all` sobre a mesma `dedupKey` produzem exatamente 1 linha (`service.test.ts`, teste "20").

## 14. Target agent

`escalationTargetAgentId` referencia `agents.id` (FK `onDelete: 'set null'`). Sempre validado contra a tabela real (`assertAgentExists`) antes de persistir uma Responsibility com política `agent`/`agent_then_human`.

## 15. Target human

`escalationTargetUserId` referencia `users.id` (FK `onDelete: 'set null'`), sempre validado contra a tabela real (`assertUserExists`) — nunca uma string arbitrária como "CEO"/"admin".

## 16. Comportamento de responsibility disabled

`resolveOperationalResponsibility()` filtra `enabled=true` na query — uma Responsibility desabilitada nunca é candidata a ownership, logo nunca gera escalation automática nova. Histórico de escalations já criadas anteriormente é preservado intacto (nunca apagado ao desabilitar). Testado explicitamente (`ownership.test.ts` e `supervisor-integration.test.ts`, item 24).

## 17. Alteração de ownership

`sourceAgentId` é gravado como cópia no momento da criação da escalation — escalations antigas mantêm o agente de origem histórico, nunca acompanham uma mudança posterior de dono da Responsibility. Nenhuma rotina de "backfill" retroativo foi criada.

## 18. Política de delete/disable

`PATCH { enabled: false }` sempre disponível. `DELETE` real só é permitido quando a Responsibility não tem nenhuma escalation associada (checado no serviço com uma consulta prévia amigável, e reforçado estruturalmente pelo FK `onDelete: 'restrict'` em `agent_operational_escalations.responsibility_id`, que faria o DELETE falhar de qualquer forma). Com histórico, retorna 409 e a mensagem orienta a desabilitar.

## 19. Permissions

Avaliado reuso primeiro (documentado em cada arquivo): nenhuma permission existente cobria os dois conceitos novos. 4 permissions criadas em `backend/src/db/seed.ts` (descrições mantidas curtas por causa do `varchar(255)` na coluna `description`, que já causou truncamento em rounds anteriores):
- `agents.responsibilities.read`
- `agents.responsibilities.manage`
- `agents.escalations.read`
- `agents.escalations.manage`

CEO recebe automaticamente todas (mecanismo existente do seed, inalterado).

## 20. Auditoria

Reaproveitado 100% o serviço `audit()` existente. Eventos novos: `agents.responsibility.created`, `.updated`, `.enabled`, `.disabled` (só quando o valor de fato muda — nunca redundante com `.updated`), `.deleted`; `agents.escalation.created` (inclui o caso `reopened: true`), `.acknowledged`, `.resolved`, `.dismissed`; `agents.escalation.creation_failed` (falha best-effort da integração com o Supervisor).

## 21. API

Todas as rotas exigem `authenticate` + `requirePermission`, seguindo o idioma exato de `event-rules.ts`/`director-decisions.ts`:

**Responsibilities** (`backend/src/routes/agents/responsibilities.ts`):
- `GET /agents/responsibilities` — `agents.responsibilities.read`
- `GET /agents/responsibilities/:id` — `agents.responsibilities.read`
- `POST /agents/responsibilities` — `agents.responsibilities.manage`
- `PATCH /agents/responsibilities/:id` — `agents.responsibilities.manage`
- `DELETE /agents/responsibilities/:id` — `agents.responsibilities.manage`

**Escalations** (`backend/src/routes/agents/escalations.ts`):
- `GET /agents/escalations` — `agents.escalations.read`
- `GET /agents/escalations/:id` — `agents.escalations.read`
- `POST /agents/escalations/:id/acknowledge` — `agents.escalations.manage`
- `POST /agents/escalations/:id/resolve` — `agents.escalations.manage`
- `POST /agents/escalations/:id/dismiss` — `agents.escalations.manage` (exige `reason`)

Deliberadamente **não existe** `POST /agents/escalations` (criação livre) nem qualquer `/execute`/`/command` — a única origem real de uma escalation é a integração interna com o Supervisor (`escalateSupervisorFinding`), nunca exposta via HTTP. Confirmado por teste de rota (`escalations.test.ts`, "nenhum endpoint de criação livre... 404").

## 22. Frontend

Integrado à navegação existente do módulo Agentes (`AgentsSubNav`) em vez de criar uma área desconectada — dois novos itens: "Responsibilities" e "Escalations", cada um atrás da respectiva permission `.read`. Duas páginas novas (`/agents/responsibilities`, `/agents/escalations`), seguindo exatamente o padrão de `RecoveryDashboard`/`DecisionQueue`: listagem filtrável (Card + Table + Select + PaginationBar), ações por `PermissionGate`, toasts via `sonner`, hooks TanStack Query com invalidação por prefixo de query key. Formulário de criação de Responsibility (`CreateResponsibilityDialog`) é 100% estruturado — todos os campos de vocabulário fechado são `<Select>`, nunca um campo livre que resulte em execução; `name`/`description` são texto livre puramente descritivo, nunca interpretado como código. Dismiss de escalation exige `reason` (Textarea obrigatória), mesmo padrão de `DismissDecisionDialog`.

## 23. Migrations

`npx drizzle-kit generate --name agent_responsibilities_escalations` → `backend/drizzle/0018_agent_responsibilities_escalations.sql` (+ `meta/0018_snapshot.json` + entrada em `meta/_journal.json`, ambos autogerados). Aplicada via `npx drizzle-kit migrate` — fluxo oficial limpo, sem reconciliação manual (confirmado: `agent_responsibilities` 15 colunas / 3 índices / 4 FKs; `agent_operational_escalations` 21 colunas / 6 índices / 7 FKs; `[✓] migrations applied successfully!`).

## 24. Arquivos criados

**Backend:**
- `backend/drizzle/0018_agent_responsibilities_escalations.sql`
- `backend/drizzle/meta/0018_snapshot.json`
- `backend/src/db/schema/agent-responsibilities.ts`
- `backend/src/db/schema/agent-operational-escalations.ts`
- `backend/src/agents/responsibilities/types.ts`
- `backend/src/agents/responsibilities/schemas.ts`
- `backend/src/agents/responsibilities/service.ts`
- `backend/src/agents/responsibilities/ownership.ts`
- `backend/src/agents/responsibilities/service.test.ts`
- `backend/src/agents/responsibilities/ownership.test.ts`
- `backend/src/agents/escalations/types.ts`
- `backend/src/agents/escalations/schemas.ts`
- `backend/src/agents/escalations/service.ts`
- `backend/src/agents/escalations/supervisor-integration.ts`
- `backend/src/agents/escalations/service.test.ts`
- `backend/src/agents/escalations/supervisor-integration.test.ts`
- `backend/src/routes/agents/responsibilities.ts`
- `backend/src/routes/agents/responsibilities.test.ts`
- `backend/src/routes/agents/escalations.ts`
- `backend/src/routes/agents/escalations.test.ts`

**Frontend:**
- `frontend/app/api/agents/responsibilities/route.ts`
- `frontend/app/api/agents/responsibilities/[id]/route.ts`
- `frontend/app/api/agents/escalations/route.ts`
- `frontend/app/api/agents/escalations/[id]/route.ts`
- `frontend/app/api/agents/escalations/[id]/acknowledge/route.ts`
- `frontend/app/api/agents/escalations/[id]/resolve/route.ts`
- `frontend/app/api/agents/escalations/[id]/dismiss/route.ts`
- `frontend/app/(dashboard)/agents/responsibilities/page.tsx`
- `frontend/app/(dashboard)/agents/escalations/page.tsx`
- `frontend/components/agents/responsibilities/responsibilities-list.tsx`
- `frontend/components/agents/responsibilities/create-responsibility-dialog.tsx`
- `frontend/components/agents/escalations/escalations-list.tsx`
- `frontend/components/agents/escalations/dismiss-escalation-dialog.tsx`
- `frontend/hooks/agents/use-responsibilities.ts`
- `frontend/hooks/agents/use-escalations.ts`

## 25. Arquivos alterados

**Backend:**
- `backend/src/agents/operations/supervisor-service.ts` — integração best-effort com `escalateSupervisorFinding` no loop principal.
- `backend/src/db/schema/index.ts` — exporta os 2 novos módulos de schema.
- `backend/src/db/seed.ts` — 4 novas permissions.
- `backend/src/routes/agents/index.ts` — registra `responsibilitiesRoutes`/`escalationsRoutes`.
- `backend/drizzle/meta/_journal.json` — entrada da migration 0018 (autogerado).

**Frontend:**
- `frontend/types/agents.ts` — tipos v2.6.
- `frontend/services/agents.ts` — funções de serviço v2.6.
- `frontend/lib/query/keys.ts` — query keys v2.6.
- `frontend/lib/agents/derived.ts` — 4 novas funções de label.
- `frontend/lib/agents/derived.test.ts` — testes das 4 novas funções.
- `frontend/components/agents/status-badge.tsx` — `EscalationStatusBadge`, `EscalationSeverityBadge`.
- `frontend/components/agents/agents-sub-nav.tsx` — 2 novos itens de navegação.

## 26. Testes adicionados por arquivo

| Arquivo | Testes |
|---|---|
| `backend/src/agents/responsibilities/service.test.ts` | 7 |
| `backend/src/agents/responsibilities/ownership.test.ts` | 4 |
| `backend/src/agents/escalations/service.test.ts` | 10 |
| `backend/src/agents/escalations/supervisor-integration.test.ts` | 7 |
| `backend/src/routes/agents/responsibilities.test.ts` | 9 |
| `backend/src/routes/agents/escalations.test.ts` | 8 |
| **Total backend** | **45** |
| `frontend/lib/agents/derived.test.ts` (5 funções × 2) | 10 |
| **Total frontend** | **10** |

## 27. Testes de Responsibilities (itens 1-8 do correio)

Cobertos em `responsibilities/service.test.ts`, `responsibilities/ownership.test.ts` e `routes/agents/responsibilities.test.ts`: criação válida com defaults corretos; rejeição de `agentId` inexistente; rejeição de `escalationTargetAgentId` inexistente; leitura por `agents.responsibilities.read` (inclusive para role só-leitura); escrita exige `agents.responsibilities.manage`; update altera campos e audita; enable/disable audita evento específico só quando o valor muda de fato; listagem filtra por domain/enabled; Responsibility desabilitada nunca aparece na resolução de ownership; resolução respeita prioridade (`critical` primeiro); política de delete/disable (409 com histórico, 204 sem histórico); payload com campo extra rejeitado (`.strict()`); `escalationPolicy=human` sem `escalationTargetUserId` rejeitado; `domain`/`agentId`/`responsibilityType` imutáveis via PATCH.

## 28. Testes de Escalation (itens 9-18 do correio)

Cobertos em `escalations/service.test.ts` e `routes/agents/escalations.test.ts`: criação via serviço interno persiste corretamente; target agent; target human; severity persistida como informada; acknowledge → resolve preservam histórico (timestamps/atores); dismiss exige e persiste `reason`; transição inválida rejeitada (`resolved → acknowledged`, 409); `open → dismissed` é válida diretamente; sem permission → 403 em todas as ações; read-only lista/lê mas não transiciona; histórico (acknowledgedBy/At) preservado mesmo após `resolve` subsequente.

## 29. Testes de concorrência/deduplicação (itens 19-21 do correio)

`escalations/service.test.ts`: mesma `dedupKey` enquanto `open`/`acknowledged` → no-op real, nunca segunda linha; **8 chamadas concorrentes reais via `Promise.all` sobre a mesma `dedupKey`** produzem exatamente 1 linha e só 1 delas reporta `created: true` (prova de ausência de race condition, não apenas ausência de erro); reocorrência após `resolved` reabre a mesma linha, nunca insere uma segunda, e limpa os campos terminais anteriores.

## 30. Testes de Supervisor (itens 22-25 do correio)

`escalations/supervisor-integration.test.ts`: `resolveIncidentDomain` resolve o domínio real de uma initiative; finding com Responsibility correspondente escala de verdade (target agent real, `created: true`); finding sem Responsibility correspondente retorna `null` e não cria nenhuma linha; `entityType` sem associação inequívoca (`delivery_failure`) nunca é mapeado; Responsibility desabilitada nunca recebe escalation automática; `escalationPolicy=none` nunca escala mesmo com Responsibility correspondente habilitada; `runOperationalSupervision` completa normalmente com a integração ativa (a suíte completa do Supervisor v2.5, 100% verde, é a prova mais forte de que o `try/catch` best-effort não introduziu regressão).

## 31. Testes de permissions (itens 26-29 do correio)

`routes/agents/responsibilities.test.ts` e `routes/agents/escalations.test.ts`: sem nenhuma permission → 403 em toda ação; permission `.read` habilita listagem/leitura mas não `.manage`; payload com campo extra rejeitado (400, `.strict()`); ID inválido (não numérico) → 400; ID inexistente → 404; transição inválida → 409.

## 32. Números exatos da suíte backend

```
ℹ tests 644
ℹ pass 644
ℹ fail 0
```
Medido via `npx tsx --test --test-concurrency=1 'src/**/*.test.ts'` (runner real, Docker + Postgres/Redis reais), nenhum número estimado.

## 33. Números exatos da suíte frontend

```
ℹ tests 104
ℹ pass 104
ℹ fail 0
```
Medido via `npm test` (`tsx --test`, runner real), nenhum número estimado.

## 34. Reconciliação com baseline 599/94

- Backend: baseline `599` + `45` testes novos = `644` esperado → `644` medido. **Reconciliado exatamente.**
- Frontend: baseline `94` + `10` testes novos = `104` esperado → `104` medido. **Reconciliado exatamente.**

Nenhuma divergência de baseline encontrada antes ou depois da implementação.

## 35. Typecheck

- Backend: `npx tsc --noEmit` (via Docker) — sem erros, rodado 2x (após camada de serviço/schema, e novamente após rotas/seed/testes).
- Frontend: `npx tsc --noEmit` (via Docker) — 6 erros de tipagem encontrados e corrigidos no formulário `CreateResponsibilityDialog` (estados `domain`/`responsibilityType` usando `| ""` causavam um estreitamento de tipo por alias via `canSubmit` que o TypeScript considerava sempre-falso; corrigido trocando para `| null` e ajustando os `onValueChange` do componente `Select`, que aceita `string | null`). Após a correção: sem erros.

## 36. Build

- Frontend: `npm run build` (produção) — **sucesso**. 89 páginas geradas, incluindo `/agents/responsibilities` e `/agents/escalations` e as 7 novas rotas de API (`/api/agents/responsibilities`, `/api/agents/responsibilities/[id]`, `/api/agents/escalations`, `/api/agents/escalations/[id]`, `/api/agents/escalations/[id]/acknowledge`, `/api/agents/escalations/[id]/resolve`, `/api/agents/escalations/[id]/dismiss`). *Nota operacional*: a primeira tentativa de build falhou por um problema de ambiente do container Docker ad hoc usado para validação (`node:24-alpine`/musl sem o binding nativo correto do Next.js — `node_modules` do host foi instalado para glibc), não relacionado ao código desta entrega; resolvido reexecutando com `node:24-slim` (glibc), compatível com o `node_modules` já presente.
- Backend: sem passo de build de produção separado (roda TypeScript direto via `tsx` em produção, conforme `Dockerfile`).

## 37. git diff --stat

```
 backend/drizzle/meta/_journal.json                 |  7 ++
 backend/src/agents/operations/supervisor-service.ts | 24 ++++
 backend/src/db/schema/index.ts                      |  4 +-
 backend/src/db/seed.ts                              | 20 +++++
 backend/src/routes/agents/index.ts                  |  4 +
 frontend/components/agents/agents-sub-nav.tsx       |  2 +
 frontend/components/agents/status-badge.tsx         | 34 ++++++
 frontend/lib/agents/derived.test.ts                 | 75 ++++++++++++++
 frontend/lib/agents/derived.ts                       | 60 ++++++++++++
 frontend/lib/query/keys.ts                          |  4 +
 frontend/services/agents.ts                         | 91 ++++++++++++++++++
 frontend/types/agents.ts                            | 60 ++++++++++++
 12 files changed, 384 insertions(+), 1 deletion(-)
```

Arquivos novos (untracked, não contam em `git diff --stat` por padrão): 27 arquivos novos no backend e frontend (listados na seção 24), totalizando aproximadamente 3.660 linhas de código/teste novo — mais o `meta/0018_snapshot.json` autogerado (9.517 linhas, dump completo do estado do schema pelo Drizzle, não código escrito à mão).

## 38. git status

```
Changes not staged for commit:
  modified:   backend/drizzle/meta/_journal.json
  modified:   backend/src/agents/operations/supervisor-service.ts
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
  backend/drizzle/0018_agent_responsibilities_escalations.sql
  backend/drizzle/meta/0018_snapshot.json
  backend/src/agents/escalations/
  backend/src/agents/responsibilities/
  backend/src/db/schema/agent-operational-escalations.ts
  backend/src/db/schema/agent-responsibilities.ts
  backend/src/routes/agents/escalations.test.ts
  backend/src/routes/agents/escalations.ts
  backend/src/routes/agents/responsibilities.test.ts
  backend/src/routes/agents/responsibilities.ts
  frontend/app/(dashboard)/agents/escalations/
  frontend/app/(dashboard)/agents/responsibilities/
  frontend/app/api/agents/escalations/
  frontend/app/api/agents/responsibilities/
  frontend/components/agents/escalations/
  frontend/components/agents/responsibilities/
  frontend/hooks/agents/use-escalations.ts
  frontend/hooks/agents/use-responsibilities.ts
```

Nenhum commit foi feito. `correio.md` aparece modificado porque já continha a v2.6 no início desta execução (não foi alterado por mim nesta rodada).

## 39. Bugs encontrados durante implementação

1. **Auto-detectado, no meu próprio código de teste**: `domain` em `ownership.test.ts` e `supervisor-integration.test.ts` inicialmente usava strings de teste concatenadas com `runId` (ex.: `ownership-test-${runId}`) que excediam o limite de `varchar(20)` da coluna `domain`, causando erro Postgres `value too long`. Corrigido encurtando os prefixos (`own-`, `dis-`, `pnone-`, `dscope-`, `nodom-`). Não é um bug no código de produção — só nos meus fixtures de teste.
2. **Ambiente de validação (não é bug de código)**: ver item 36 — a primeira tentativa de `npm run build` falhou por incompatibilidade musl/glibc do container Docker ad hoc usado para checar o build, não por um erro real no código da aplicação.

Nenhum bug foi encontrado no código de produção entregue (Responsibilities/Escalations/integração com o Supervisor) — a suíte completa (644 backend + 104 frontend) está 100% verde.

## 40. Limitações reais

- `resolveIncidentDomain()` só cobre os tipos de incidente com uma entidade de origem inequívoca no schema real (`initiative`, `executive_review`, `strategic_memory`, `agent_job`, `agent_job_run`). Os outros 4 tipos (`delivery_failure`, `approval_bottleneck`, `manual_attention_required`, `operational_degradation`) nunca geram escalation automática nesta versão — decisão deliberada, não uma lacuna a corrigir sem uma fonte real de domínio.
- `resolvePrimaryResponsibility()` escolhe só a Responsibility de maior prioridade quando há mais de uma habilitada para o mesmo domínio — não há um mecanismo de "notificar todos os donos", por design (evita a "engine multi-estágio" explicitamente vetada).
- Não há criação manual de escalation via API (avaliado e descartado por não haver caso de uso real nesta versão, conforme a própria instrução do correio).
- O formulário de frontend para editar (`PATCH`) uma Responsibility existente ainda não tem uma tela dedicada — só criar/habilitar/desabilitar/excluir estão na UI; editar campos como `priority`/`escalationPolicy` de uma Responsibility já existente requer a API diretamente. Não bloqueante para esta entrega (a correio pede CRUD na API, e frontend "ideally integrado", não necessariamente com paridade total de formulários).

## 41. Débitos técnicos

- Os 3 erros de lint pré-existentes em `frontend/components/agents/jobs/job-detail.tsx` e `frontend/components/agents/operations/operations-supervisor-dashboard.tsx` (entidades HTML não escapadas, `Date.now()` chamado durante render) já existiam antes desta rodada, em arquivos não tocados por ela — não corrigidos aqui por estarem fora do escopo da v2.6 (regra "não refatore módulos anteriores sem necessidade objetiva").
- `frontend/components/agents/responsibilities/responsibilities-list.tsx` não tem um formulário de edição inline — só toggle enable/disable e delete. Se o Diretor pedir edição completa via UI numa próxima rodada, é um acréscimo aditivo simples sobre a API já pronta.

## 42. Conclusão — confronto com cada critério bloqueante

1. **Responsibility nunca concede permission** — ✅ nenhuma coluna de `agent_responsibilities` toca permissions/roles/autonomy.
2. **Responsibility nunca altera autonomy** — ✅ nenhum código desta entrega escreve em `agent_jobs.autonomyEnabled` ou circuit breaker.
3. **Ownership nunca decidido por LLM** — ✅ `resolveOperationalResponsibility`/`resolvePrimaryResponsibility` são 100% SQL determinístico, documentado explicitamente no código.
4. **Escalation nunca executa ação diretamente** — ✅ `agent_operational_escalations` não referencia Action Plan/tool/execução; é um registro puramente gerencial.
5. **Escalation nunca bypassa Planner/Policy/Executor** — ✅ nenhum caminho de código desta entrega chama `executeActionPlan`/tools.
6. **Supervisor nunca cria duplicatas continuamente** — ✅ dedup via `dedupKey` único + reabertura de linha, provado sob concorrência real (8 chamadas simultâneas → 1 linha).
7. **Deduplicação nunca tem race condition evidente** — ✅ `INSERT ... ON CONFLICT DO NOTHING` + `SELECT ... FOR UPDATE` na trilha de conflito, testado com `Promise.all`.
8. **Target humano sempre referencia usuário real** — ✅ `assertUserExists()` valida contra `users` antes de persistir; FK garante no banco.
9. **Target agent nunca inválido** — ✅ `assertAgentExists()` valida contra `agents`; FK garante no banco.
10. **Estado de escalation nunca aceita transições arbitrárias** — ✅ `ESCALATION_TRANSITIONS` + `assertTransition()`, testado (válidas e inválidas).
11. **Permissions nunca só no frontend** — ✅ toda rota tem `requirePermission` no backend; frontend só usa `PermissionGate` para UX, nunca como única barreira.
12. **Histórico nunca destrutível inadvertidamente** — ✅ FK `onDelete: 'restrict'` em `responsibility_id`; delete de Responsibility com histórico é bloqueado (409).
13. **Responsibility desabilitada nunca recebe escalation automática** — ✅ filtro `enabled=true` na query de resolução, testado.
14. **Alteração de ownership nunca reescreve histórico** — ✅ `sourceAgentId` é cópia congelada no momento da criação, nunca atualizada retroativamente.
15. **Suíte completa nunca regride** — ✅ backend 644/644 (599 baseline + 45 novos, exato), frontend 104/104 (94 baseline + 10 novos, exato), 0 falhas em ambos.

Todos os 15 critérios bloqueantes foram atendidos e verificados com evidência real (teste automatizado, constraint de banco, ou leitura direta do código), não por inferência.

---

Aguardando aprovação do Diretor/CEO. Nenhum commit foi feito nesta rodada.
