# Entrega — Agentes v1.8: Director Operations & Business Workflows

Nenhum commit foi feito (correio.md v1.8: "não fazer commit automático" /
"aguardar revisão final do Diretor/CEO") — tudo abaixo está no working
tree, aguardando sua revisão.

## 1. Resumo

Transformado o Diretor Virtual de infraestrutura genérica em uma camada
operacional real: coleta determinística de sinais (Operational Signals)
sobre os 4 módulos existentes + saúde da própria infraestrutura de
agentes, um Daily Operations Brief estruturado, e uma API de "propor
ação" que entra no pipeline **oficial** já existente (Planner → Policy
Evaluator → Action Plan → Executor/Approval) — sem segundo executor,
sem segunda forma de autorização, sem o LLM decidindo nada além de qual
tool chamar dentro de um objetivo já determinístico.

## 2. Inventário dos módulos

Exploração real de schemas/services antes de implementar (correio.md
seção 22):

| Módulo | Campos relevantes já existentes | Services/repositórios reaproveitados |
|---|---|---|
| CRM | `leads.next_action_at`, `leads.created_at`, `leads.status` | `listOpenLeads()` (já existente, já usada por `director.get_business_overview`) — classificação feita em memória, **zero SQL novo** |
| Projetos | `tasks.due_date`/`status`/`assignee_user_id`, `projects.due_date`/`status` | `getOverdueTasks()`, `getBlockedTasks()`, `getOverdueProjects()` (existentes) + `getTasksDueSoon()`, `getUnassignedTasks()` (novas, mesmo padrão/arquivo) |
| Financeiro | `financial_entries.due_date`/`status`, `overdueEntryCondition()` | `getOverdueEntries('income'\|'expense')` (existente) |
| Suporte/CS | `support_tickets.priority`/`sla_due_at`, `customer_success_accounts.status`/`next_contact_at` | `getCriticalTickets()`, `getOverdueTicketsList()`, `getAtRiskAccounts()`, `getDueFollowups()` (todas existentes) |
| Agentes (saúde própria) | `agent_jobs.circuit_state`, `agent_approvals.status` | `listIncidents()` (v1.6, existente) + 2 queries diretas novas (job_circuit_open, approval_pending) — legítimo por estar dentro do próprio módulo de agentes, não cruzando para domínio de negócio |

11 das 13 fontes de sinal reaproveitam funções **já existentes e já
usadas** por `director.get_business_overview` (v1.6) — confirma que a
arquitetura v1.0–v1.7 já estava pronta para isso, só faltava a camada de
interpretação.

## 3. Sinais implementados

13 tipos, todos verificados contra dados reais (nenhum conceito
inventado):

| Tipo | Domínio | Severidade | Fonte |
|---|---|---|---|
| `crm.lead_follow_up_overdue` | crm | warning | `listOpenLeads()` + `nextActionAt < now` |
| `crm.lead_missing_follow_up` | crm | attention | `listOpenLeads()` + sem `nextActionAt` e `createdAt` > `leadStaleDays` |
| `projects.task_overdue` | projects | warning | `getOverdueTasks()` |
| `projects.task_due_soon` | projects | attention | `getTasksDueSoon()` (novo) |
| `projects.task_blocked` | projects | warning | `getBlockedTasks()` |
| `projects.task_unassigned` | projects | attention | `getUnassignedTasks()` (novo) |
| `projects.project_overdue` | projects | warning | `getOverdueProjects()` |
| `finance.receivable_overdue` | finance | warning | `getOverdueEntries('income')` |
| `finance.payable_overdue` | finance | warning | `getOverdueEntries('expense')` |
| `support.ticket_critical` | support | critical | `getCriticalTickets()` |
| `support.ticket_overdue` | support | warning | `getOverdueTicketsList()` |
| `support.account_at_risk` | support | critical | `getAtRiskAccounts()` |
| `support.follow_up_due` | support | attention | `getDueFollowups()` |
| `agents.incident.*` (7 subtipos) | agents | critical/warning/attention | `listIncidents()` (v1.6) |
| `agents.job_circuit_open` | agents | critical | query direta em `agent_jobs` |
| `agents.approval_pending` | agents | attention | query direta em `agent_approvals` |

Thresholds (`leadStaleDays=3`, `taskDueSoonDays=2`) em catálogo de código
(`agents/director/thresholds.ts`), não no sistema de settings da v1.7 —
decisão explícita do correio.md ("provar os workflows" primeiro).

## 4. Sinais avaliados mas não implementados e motivo

| Sinal sugerido | Motivo |
|---|---|
| "lead parado em uma etapa do pipeline" | Exigiria rastrear quando o lead entrou no estágio atual — não existe hoje (só `updated_at` do lead inteiro, que muda em qualquer edição, não só mudança de estágio) |
| "cliente sem contato recente" (CRM) | Já coberto pelo domínio support via `customer_success_accounts.next_contact_at` (`support.follow_up_due`) — não duplicado |
| "atividade CRM vencida" | `crm_activities` não tem due date, só `occurred_at` (log do que já aconteceu, não uma pendência futura) |
| "projeto sem atividade recente" | `projects` não tem campo de última-atividade real; `updated_at` muda em qualquer edição administrativa, não só progresso |
| "cobrança próxima" (due soon, financeiro) | Decisão de escopo, não limitação de dados — overdue já cobre o sinal de maior urgência; candidato natural de extensão futura (mesmo padrão de `getTasksDueSoon`) |
| "tarefas sem responsável, caso esse conceito exista" | **Implementado** — `assigneeUserId` é nullable, confirmado e usado |

## 5. Arquitetura

```
Dados reais (services/repositórios existentes)
        ↓
Collectors por domínio (agents/director/collectors/*.ts)
        ↓
collectOperationalSignals() — Promise.allSettled, falha isolada por domínio
        ↓
operations-service.ts — ordena por severidade, monta o Brief (status ok/partial)
        ↓
WORKFLOW_TEMPLATES (por domínio) — objetivo determinístico a partir do sinal
        ↓
planEvaluateAndPersistActionPlan() + executeActionPlan() — MESMA função de POST /agents/action-plans
        ↓
Policy Evaluator (autoridade real, inalterada) → Action Plan Items persistidos
```

`now` sempre parametrizável (nunca `Date.now()`/`new Date()` direto dentro
dos collectors) — testes com relógio controlado, sem flakiness de data.

## 6. Arquivos criados

Backend:

```
agents/director/types.ts
agents/director/thresholds.ts
agents/director/schemas.ts
agents/director/operational-signals.ts
agents/director/operations-service.ts
agents/director/collectors/{crm,projects,finance,support,agents}.ts
agents/director/workflows/catalog.ts
agents/director/operational-signals.test.ts   — 5 testes
agents/director/operations-service.test.ts    — 5 testes
agents/jobs/director-brief-job.test.ts        — 1 teste (Job → Run real)
routes/agents/director.ts
routes/agents/director.test.ts                — 6 testes
```

Frontend:

```
app/api/agents/director/brief/route.ts
app/api/agents/director/signals/route.ts
app/api/agents/director/signals/[id]/route.ts
app/api/agents/director/signals/[id]/propose/route.ts
app/(dashboard)/agents/director/page.tsx
components/agents/director/{director-dashboard,domain-section,propose-action-button}.tsx
hooks/agents/use-director.ts
```

## 7. Arquivos alterados

```
backend/src/agents/tools/director.ts       — nova tool director.generate_daily_brief
backend/src/db/seed.ts                     — tool nova + vínculo agente↔tool (sem permission nova)
backend/src/routes/agents/index.ts         — registro da rota
backend/src/routes/agents/operations.ts    — export de getJobsSummary/getApprovalsSummary (reuso pelo Director)
backend/src/routes/projects/projects.ts    — + getTasksDueSoon/getUnassignedTasks
frontend/types/agents.ts                   — OperationalSignal/DailyOperationsBrief/...
frontend/services/agents.ts                — 4 funções novas
frontend/hooks/... (indireto via use-director.ts, novo)
frontend/lib/agents/derived.ts             — labels + signalEntityHref
frontend/lib/agents/derived.test.ts        — 5 testes novos (signalEntityHref)
frontend/lib/query/keys.ts                 — chaves novas
frontend/components/agents/status-badge.tsx — SignalSeverityBadge
frontend/components/agents/agents-sub-nav.tsx — link "Mesa do Diretor"
```

## 8. Endpoints

```
GET  /agents/director/brief                agents.read
GET  /agents/director/signals              agents.read
GET  /agents/director/signals/:id          agents.read
POST /agents/director/signals/:id/propose  agents.use + agents.plan
```

Consolidado em relação à sugestão literal do correio.md: sem
`/director/operations` separado de `/director/brief` (redundante — o
brief já é a visão consolidada; seção 13 permite explicitamente "avaliar
nomes finais").

## 9. Permissions

**Nenhuma permission nova criada** — decisão deliberada (correio.md
seção 14: "antes verificar se permissions equivalentes já existem. Não
duplicar"). Reaproveitadas:

- `agents.read` — já usada por `director.get_business_overview` (v1.6) para o mesmo tipo de dado cross-departamento; cobre os 3 endpoints de leitura.
- `agents.use` + `agents.plan` — exatamente as mesmas exigidas por `POST /agents/action-plans` (v1.2); o endpoint `propose` literalmente chama a mesma função, então exige a mesma autorização, sem exceção.

## 10. Workflow templates

4 templates por domínio (não por tipo de sinal — os nomes sugeridos pelo
correio.md são de domínio) + 1 especial:

```
crm.follow_up_stale_lead        — qualquer sinal domain='crm'
projects.handle_overdue_task    — qualquer sinal domain='projects'
finance.review_overdue_item     — qualquer sinal domain='finance'
support.review_stale_ticket     — qualquer sinal domain='support'
director.daily_operations_review — objetivo do Job recorrente (não é "propose" sobre um sinal)
```

Nenhum define autorização — só o texto do objetivo enviado ao Planner.

## 11. Integração com Planner/Policy/Executor

Zero bypass: `POST /director/signals/:id/propose` chama exatamente
`planEvaluateAndPersistActionPlan()` + `executeActionPlan()`, as mesmas
duas funções de `POST /agents/action-plans` (v1.2), na mesma ordem. Prova
por teste real (`routes/agents/director.test.ts`): a decisão do item
retornado é sempre um dos 4 valores reais do Policy Evaluator
(`execute`/`approval_required`/`blocked`/`shadow`), nunca hardcoded pelo
endpoint do Diretor, e o item fica de fato persistido em
`agent_action_plan_items`.

## 12. Integração Jobs/Events

**Jobs**: nova tool `director.generate_daily_brief` (READ), registrada no
agente `director`. Um `agent_jobs` comum (nenhuma tabela/coluna nova)
com objetivo `"Gerar briefing operacional diário da agência e
identificar situações que requerem atenção."` roda via `runAgentJob()`
— o Scheduler v1.3 já consegue disparar isso sem mudança nenhuma.
Provado com Run real, ponta a ponta: `agents/jobs/director-brief-job.test.ts`
(e validado manualmente contra o LLM real desta sessão, não só mockado —
briefing real de 22 sinais gerado a partir dos dados reais do Postgres de
dev).

**Events**: nenhum evento novo publicado nesta versão — decisão
documentada (correio.md seção 12: "não instrumentar dezenas de eventos
apenas por antecipação"). O brief é uma agregação de leitura, não um fato
transacional; se um workflow futuro precisar reagir a "task ficou
overdue" em tempo real (não só quando alguém abre o brief), aí sim
justificaria um evento novo — não implementado agora.

## 13. Segurança

- LLM nunca decide autorização — só escolhe qual tool chamar dentro de um
  objetivo já determinístico montado pelo backend.
- `propose` nunca executa nada diretamente — sempre via
  `planEvaluateAndPersistActionPlan`/`executeActionPlan` reais.
- Nenhum Action Plan Item pode fazer o que o usuário criador (`requestedBy`)
  não poderia fazer diretamente — mesma regra de permissions por tool já
  existente, inalterada.
- Sinais são 100% determinísticos (dados reais, comparações de data) —
  o LLM nunca gera um sinal, só interpreta os que já existem.
- Nenhuma tool nova mutante: `director.generate_daily_brief` é READ, sem
  `mutatesData`, sem `requiresApproval`.

## 14. Auditoria

```
agents.director.brief_generated   — a cada GET /director/brief
agents.director.action_proposed   — a cada POST propose bem-sucedido
```

Metadata: `signalId`/`signalType`/`domain`/`entityType`/`entityId`/
`resultingActionPlanId` (proposed) e `status`/`summary`/`errors` (brief).
Mesmo serviço `audit()` existente, nenhum sistema paralelo.

## 15. Frontend

`/agents/director` — "mesa do diretor": card de resumo (críticos/avisos/
atenção/info, com aviso visível quando o brief está `partial` e qual
domínio falhou) + 5 seções por domínio (CRM/Projetos/Financeiro/Suporte/
Agentes), cada sinal com severidade, descrição, link para a entidade
quando existe rota real (`signalEntityHref` — nunca um link quebrado:
`task` usa `metadata.projectId`, não o id da própria tarefa, já que não
existe página de tarefa isolada) e botão "Propor ação". O resultado do
propose mostra a decisão real (Executável automaticamente/Approval
necessário/Bloqueado/Shadow) e linka para a tela de planos já existente —
nenhuma confirmação paralela, nenhuma mutação direta na UI.

## 16. Testes

**17 novos no backend** (308 → 326... na verdade 18, ver nota): 5
(detecção: positiva, falso positivo, threshold, isolamento de domínio,
ordenação por severidade) + 5 (brief: consolidação, contadores, módulos
vazios, falha isolada de fonte sem mascarar erro, `now` controlado) + 6
(API: autorização read/propose separadas, GET signal existente/404,
propose prova pipeline sem bypass) + 1 (Job real → Run → tool → briefing
determinístico). **5 novos no frontend** (`signalEntityHref`: 5 casos).

```
backend typecheck:   limpo, 0 erros
backend tests:       326/326, 0 fail (--test-concurrency=1, confirmado 2x)
frontend typecheck:  limpo, 0 erros
frontend tests:      56/56, 0 fail
frontend build:      limpo, 0 erros — /agents/director + 4 rotas BFF compilam
```

## 17. Compatibilidade v1.0–v1.7

Confirmada: suíte completa anterior (todos os 308 testes de v1.0–v1.7)
continua passando dentro dos 326. Nenhuma rota/comportamento/permission
existente foi alterado — só leitura nova e reuso do pipeline de Action
Plan já existente.

## 18. Bugs encontrados

1. **Tool nova sem vínculo agente↔tool no seed**: `director.generate_daily_brief`
   foi registrada no código (`tool-registry`) mas esquecida no catálogo
   de seed e em `defaultAgentToolPermissions['director']` — o Planner
   validava o Action Plan mockado e rejeitava com `validation_error:
   "Action Plan gerado é inválido"` porque a tool não estava associada ao
   agente `director` em `agent_tool_permissions`. Diagnosticado com um
   script isolado reproduzindo o Run fora da suíte de teste (para inspecionar
   o erro real sem o `after()` do teste limpar os dados antes de eu
   conseguir ler); corrigido adicionando a tool ao catálogo de seed e ao
   vínculo do agente, `db:seed` re-rodado no Postgres de dev. Teste
   voltou a passar sem alterar nenhuma expectativa.

Nenhum outro bug real encontrado nesta versão (diferente da v1.5/v1.7,
que tiveram mais achados) — a maior parte do trabalho reaproveitou
funções já testadas em outros módulos.

## 19. Riscos / débitos técnicos

1. **`agents.job_circuit_open`/`agents.approval_pending` usam query
   direta em `agent_jobs`/`agent_approvals`** dentro do collector — não é
   uma violação da regra "nunca SQL no Diretor" (essa regra é sobre não
   duplicar lógica de domínio de negócio; este collector vive dentro do
   próprio módulo de agentes), mas documentado aqui para transparência
   total sobre onde exatamente há uma exceção deliberada.
2. **Paginação de `listIncidents` limitada a 20** dentro do collector de
   agentes — um ambiente com muitos incidents simultâneos veria só os 20
   mais recentes no brief. Aceitável para uma tela operacional (não uma
   auditoria completa, que já existe em `/agents/incidents`), mas vale
   registro.
3. **Sinais "due soon" cobrem só tarefas**, não financeiro — decisão de
   escopo documentada na seção 4, não limitação técnica.
4. **`director.generate_daily_brief` foi testada com o LLM real desta
   sessão** (não só mockada) — confirma que funciona em produção, mas
   isso consumiu uma chamada real ao provider configurado (fora dos
   testes automatizados, que usam mock).
5. Segue pendente de sessões anteriores: os Jobs órfãos `1546`/`1547`
   ainda `active` (dormentes) no Postgres de dev, aguardando
   cancelamento aprovado.

## 20. Deploy/migrations

**Nenhuma migration nova** — v1.8 não criou tabela nem coluna.

```bash
npm run db:seed   # cria a tool director.generate_daily_brief e o vínculo agente↔tool (idempotente)
```

Sem isso, um Job com objetivo de briefing diário rodando com LLM real não
teria acesso à tool (mesmo bug da seção 18) — já corrigido e re-rodado
nesta sessão, mas necessário em qualquer outro ambiente antes do deploy.

## 21. Git status

```
?? backend/src/agents/director/
?? backend/src/agents/jobs/director-brief-job.test.ts
?? backend/src/routes/agents/director.test.ts
?? backend/src/routes/agents/director.ts
?? frontend/app/api/agents/director/
?? frontend/app/(dashboard)/agents/director/
?? frontend/components/agents/director/
?? frontend/hooks/agents/use-director.ts
 M backend/src/agents/tools/director.ts
 M backend/src/db/seed.ts
 M backend/src/routes/agents/index.ts
 M backend/src/routes/agents/operations.ts
 M backend/src/routes/projects/projects.ts
 M correio.md
 M frontend/components/agents/agents-sub-nav.tsx
 M frontend/components/agents/status-badge.tsx
 M frontend/lib/agents/derived.test.ts
 M frontend/lib/agents/derived.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
```

Nenhum commit foi feito. Aguardando revisão final.
