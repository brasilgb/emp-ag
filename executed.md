# Entrega — Agentes v1.9: Director Decision & Prioritization

Nenhum commit foi feito (correio.md v1.9 seção 38: "não fazer commit
automático" / "aguardar revisão do Diretor/CEO") — tudo abaixo está no
working tree, aguardando sua revisão.

## 1. Resumo

Transformada a Mesa do Diretor (v1.8) em uma fila executiva real: os
Operational Signals determinísticos agora alimentam uma **Director
Decision Queue** persistida — itens deduplicados, priorizados por score
explicável, com ciclo de vida (reconhecer/atribuir/dispensar) e
integração com o pipeline oficial de Action Plan/Policy Evaluator/
Approval já existente. Nenhum executor novo, nenhuma autorização
paralela, nenhum bypass — um Decision Item nunca significa "execute
automaticamente", só "isto merece acompanhamento".

## 2. Arquitetura final

```
Operational Signal (v1.8, sem mudança)
        ↓
syncDirectorDecisionQueue() — upsert por deduplicationKey, concorrência segura
        ↓
agent_director_decisions (Decision Item) — priorityScore + priorityFactors explicáveis
        ↓
propose (POST /director/decisions/:id/propose)
        ↓
planEvaluateAndPersistActionPlan() + executeActionPlan() — MESMAS funções da v1.2/v1.8
        ↓
Policy Evaluator (autoridade real, inalterada) → Action Plan Item → Approval (se necessário)
```

## 3. Inventário explorado antes de implementar

Backend: schemas/migrations v1.0–v1.8, `operational-signals.ts`,
`operations-service.ts`, `workflows/catalog.ts`, Action Plans,
Approvals, Jobs, Events, Governance, auditoria, incidents, settings,
circuit breakers, permissions existentes. Frontend: `use-director.ts`,
`director-dashboard.tsx`, `domain-section.tsx`,
`propose-action-button.tsx`, `status-badge.tsx`, `derived.ts`/
`format.ts`, `permission-gate.tsx`, `use-users-directory.ts`,
`pagination-bar.tsx`, kit de UI (dialog/select/textarea), padrão das
rotas-proxy `app/api/**`.

## 4. Decision Item — schema

Nome escolhido: `agent_director_decisions` (consistente com o prefixo
`agent_*` já usado por `agent_autonomy_blocks`,
`agent_operational_settings` etc.).

Campos: id, `deduplicationKey` (único, normalizado —
`signalType::entityType::entityId`, com fallback estável para sinais
sem `entityId`), `signalType`, `domain`, `entityType`/`entityId`,
`title`/`description`, `severity`/`impact`/`urgency`, `priorityScore` +
`priorityFactors` (jsonb, persistidos — não derivados a cada leitura,
decisão documentada no código), `status`, `requiresHumanAttention`,
`firstDetectedAt`/`lastDetectedAt`/`occurrenceCount`,
`resolvedAt`/`resolvedBy`, `actionPlanId` (FK), `assignedUserId` (FK),
`acknowledgedAt`/`acknowledgedBy`, `dismissedAt`/`dismissedBy`/
`dismissReason`, `metadata`, `createdAt`/`updatedAt`.

**`approvalId` deliberadamente não existe como coluna** — um approval
real já é relacionável via `action_plan_id → agent_action_plan_items →
agent_approvals` (mesma cadeia real do domínio, sem cópia
inconsistente).

## 5. Deduplication strategy

Chave única `deduplicationKey` (nunca constraint composto com colunas
nullable — mesmo problema já resolvido na v1.7 com índices parciais,
aqui resolvido normalizando tudo em uma string sempre presente).
Upsert via `ON CONFLICT` nesta coluna é o mecanismo real de
deduplicação sob concorrência (correio.md seção 30) — nunca
find-then-insert. Provado por teste de concorrência real (duas
sincronizações simultâneas para o mesmo sinal).

## 6. State machine

`open → acknowledged → action_planned → awaiting_approval → resolved`
e `dismissed` (soft state, a partir de qualquer estado não-terminal,
com `reason` obrigatório). Toda transição valida origem/estado atual/
permission e é auditada. Reabertura por reocorrência: item resolvido
reabre quando a condição reaparece no próximo sync (regra clara,
testada).

## 7. Priority algorithm

`priorityScore = severityWeight + impactWeight + urgencyWeight +
agingWeight + recurrenceWeight`, pesos e thresholds centralizados em
`agents/director/decisions/thresholds.ts` (aging: 2 pontos/dia, capado
em 40; recurrence: 5 pontos/ocorrência extra, capado em 30) — sem
números mágicos espalhados, `now` sempre parametrizável (nunca
`Date.now()`/`new Date()` direto em regra de negócio). Persistido em
`priorityFactors` para explicabilidade sem recálculo redundante em
cada leitura.

## 8. Impacto e urgência

Regras fixas por `signalType` (`impact.ts`/`urgency.ts`) — nunca
inventadas pelo LLM. `finance.receivable_overdue` usa o valor real do
sinal quando disponível, cai no default do tipo quando não;
`support.ticket_critical`/`agents.job_circuit_open` → impacto alto;
`projects.task_unassigned` → impacto baixo. Urgência por SLA vencido/
circuit breaker aberto → immediate; due-soon → soon; hygiene → normal.

## 9. Integração com Operational Signals

`syncDirectorDecisionQueue()` — coleta sinais, cria/atualiza itens,
recalcula prioridade, resolve itens cuja condição desapareceu,
**preserva intocados os itens de domínios cuja coleta falhou** (regra
obrigatória da seção 7, testada explicitamente). Retorna
`{created, updated, resolved, unchanged, errors}`.

## 10. Integração com Action Plans

`POST /director/decisions/:id/propose` reutiliza exatamente
`planEvaluateAndPersistActionPlan()` + `executeActionPlan()` — as
mesmas funções de `POST /agents/action-plans` (v1.2) e de `POST
/director/signals/:id/propose` (v1.8, mantido **sem nenhuma mudança**,
compatibilidade total). Ao nascer um Action Plan a partir de um
Decision Item: relação persistida (`actionPlanId`), status atualizado
para `action_planned` ou `awaiting_approval` conforme a decisão real do
Policy Evaluator, audit trail mantido.

## 11. Integração com Approvals

Nenhum segundo approval criado — `getPendingApprovalForPlan()` consulta
o approval real via `action_plan_items → agent_approvals` sob demanda.

## 12. Integração com Jobs

Tool nova `director.sync_decision_queue` (WRITE, `risk='low'`,
`mutatesData=true`) — **nunca** reaproveita `director.generate_daily_brief`
(READ, v1.8) para isso, decisão arquitetural explícita da seção 21
(transformar silenciosamente uma tool READ em mutação foi proibido).
Passa pelo mesmo Action Policy Evaluator que qualquer outra tool
mutante, sem tratamento especial. Também existe `POST
/director/decisions/sync` como trigger administrativo direto — ambos
chamam a mesma função, nenhuma lógica duplicada.

## 13. Events

Nenhum evento novo implementado — decisão documentada (seção 22:
"somente se houver consumidores reais"). Extensão futura se algum
fluxo passar a reagir a `director.decision.created/resolved/escalated`
em tempo real.

## 14. Escalation

Não implementada como mecanismo separado nesta versão —
`requiresHumanAttention` já cobre o conceito de "atenção humana" na
sincronização (marcado quando `awaiting_approval`), que é o caso de uso
central da seção 24. Escalada por aging/recurrence acima de threshold
fica como extensão futura documentada, não bloqueante para os
critérios de aprovação.

## 15. Permissions

**Uma permission nova**, justificada individualmente:
`agents.director.decisions.manage` — reconhecer/atribuir/dispensar/
sincronizar. Leitura segue em `agents.read` (já usada por todo o
módulo Director); propor ação segue em `agents.use` + `agents.plan`
(mesma exigência de `POST /agents/action-plans`). CEO recebe todas as
permissions automaticamente no seed (padrão já existente).

## 16. Endpoints

```
GET  /agents/director/decisions              agents.read
GET  /agents/director/decisions/overview     agents.read
GET  /agents/director/decisions/:id          agents.read
POST /agents/director/decisions/sync         agents.director.decisions.manage
POST /agents/director/decisions/:id/acknowledge  agents.director.decisions.manage
POST /agents/director/decisions/:id/assign       agents.director.decisions.manage
POST /agents/director/decisions/:id/dismiss      agents.director.decisions.manage
POST /agents/director/decisions/:id/propose      agents.use + agents.plan
```

Filtros: `?status=&domain=&severity=&assignedUserId=&requiresHumanAttention=`.
Ordenação: `priorityScore DESC`, desempate `firstDetectedAt ASC`
(determinístico, documentado no código).

## 17. Auditoria

```
agents.director.decision.acknowledged
agents.director.decision.assigned
agents.director.decision.dismissed
agents.director.decision.action_proposed
```

(`resolved` é resultado de sync automático, sem ator humano — não
auditado como ação de usuário, coerente com o resto do módulo.) Mesmo
serviço `audit()` existente, nenhum sistema paralelo.

## 18. Frontend

Expandida `/agents/director` (nenhuma área desconectada): nova seção
**"Fila de Prioridades"** abaixo das seções de domínio existentes —
resumo executivo (abertos/críticos/requerem decisão humana/aguardando
aprovação/recorrentes), filtros (status/domínio/severidade/atenção
humana), tabela com prioridade, severidade, domínio, título, tempo em
aberto, ocorrências, responsável, status, indicador de atenção humana,
e ações por permission (reconhecer/atribuir/propor ação/dispensar com
justificativa obrigatória). Drill-down dedicado em
`/agents/director/decisions/:id` — origem, entidade relacionada,
fatores do score, Action Plan e approval relacionados (reusando
`ApprovalStateBadge`/link para `/agents/plans/:id` já existentes),
ciclo de vida completo. Botão "Sincronizar" (gated por
`agents.director.decisions.manage`) chama o trigger administrativo.

## 19. Arquivos criados

Backend:

```
db/schema/agent-director-decisions.ts
drizzle/0014_agent_director_decisions.sql (+ meta/0014_snapshot.json)
agents/director/decisions/{types,thresholds,impact,urgency,priority,dedup,
  queue-service,schemas,actions-service,sync-service}.ts
agents/director/decisions/{priority,sync-service,integration}.test.ts
routes/agents/director-decisions.ts
routes/agents/director-decisions.test.ts
```

Frontend:

```
app/api/agents/director/decisions/route.ts
app/api/agents/director/decisions/overview/route.ts
app/api/agents/director/decisions/sync/route.ts
app/api/agents/director/decisions/[id]/route.ts
app/api/agents/director/decisions/[id]/{acknowledge,assign,dismiss,propose}/route.ts
app/(dashboard)/agents/director/decisions/[id]/page.tsx
components/agents/director/{decision-queue,decision-detail,
  assign-decision-dialog,dismiss-decision-dialog}.tsx
hooks/agents/use-director-decisions.ts
```

## 20. Arquivos alterados

```
backend/src/agents/tools/director.ts   — tool director.sync_decision_queue
backend/src/db/schema/index.ts         — export do schema novo
backend/src/db/seed.ts                 — permission + tool + vínculo agente↔tool
backend/src/routes/agents/index.ts     — registro das rotas
frontend/types/agents.ts               — DirectorDecision/PriorityFactors/...
frontend/services/agents.ts            — 8 funções novas
frontend/lib/query/keys.ts             — chaves novas
frontend/lib/agents/derived.ts (+test) — labels + daysOpen/canProposeActionForDecision/isDecisionClosed
frontend/components/agents/status-badge.tsx — DecisionStatusBadge
frontend/components/agents/director/director-dashboard.tsx — <DecisionQueue />
```

## 21. Segurança

- Autorização 100% server-side (`requirePermission` em cada rota,
  `PermissionGate` no frontend é só UX).
- Nenhuma decisão de permission pelo LLM; nenhuma execução direta pelo
  Decision Queue; zero SQL/tool/shell/credential acessível ao LLM.
- Nenhum bypass do Policy Evaluator ou do Approval — `propose` sempre
  passa pelas mesmas duas funções oficiais.
- Nenhum aumento de privilégio por severity/priority: `critical` e
  `priorityScore` alto nunca autorizam nada sozinhos.
- Validação Zod em toda rota mutante; `assign` rejeita usuário
  inexistente; `dismiss` exige `reason` não-vazio.

## 22. Testes

**Backend — 37 testes novos** (5 `computePriority` + 2 `daysBetween` +
5 `resolveImpact` + 2 `resolveUrgency` + 3 `buildDeduplicationKey` + 7
`syncDirectorDecisionQueue` — incluindo concorrência e preservação em
falha de domínio — + 12 API (autorização/transições/propose/filtros/
dismiss) + 1 cenário integrado obrigatório fim-a-fim, seção 34).
**Frontend — 8 testes novos** em `lib/agents/derived.test.ts` (labels,
`isDecisionClosed`/`canProposeActionForDecision`, `daysOpen` com `now`
controlado).

```
backend typecheck:   limpo, 0 erros
backend tests:       363/363, 0 fail (suíte completa v1.0–v1.9, --test-concurrency=1)
frontend typecheck:  limpo, 0 erros
frontend tests:      22/22, 0 fail (lib/agents/derived.test.ts completo)
frontend build:      limpo, 0 erros — 8 rotas novas compilam
```

## 23. Cenário integrado (correio.md seção 34)

Provado em `agents/director/decisions/integration.test.ts` com
componentes reais (DB real, Planner real, Policy Evaluator real —
só o provider LLM mockado para determinismo): lead real → signal →
sync cria Decision Item → sync de novo não duplica → propose → Action
Plan persistido com a decisão real do Policy Evaluator → status do
item reflete → lead resolvido → sync → item `resolved`.

## 24. Bugs encontrados durante o desenvolvimento

Nenhum bug de lógica encontrado na implementação já presente no início
desta execução — validação (typecheck + suíte completa + build)
confirmou que o backend estava correto de ponta a ponta. Os únicos
ajustes feitos nesta sessão foram no frontend, recém-criado: dois
erros de tipo pegos pelo `tsc` (Select `onValueChange` aceitando
`null`; `signalEntityHref` recebendo `entityType: string | null` sem
normalizar para `undefined`) — corrigidos antes de qualquer commit.

## 25. Riscos / débitos técnicos

1. Escalation (seção 23) não tem mecanismo automático dedicado além de
   `requiresHumanAttention` já setado no sync quando há approval
   pendente — aging/recurrence acima de threshold como gatilho
   explícito de escalada fica como extensão futura.
2. Nenhum evento (`director.decision.*`) implementado — sem
   consumidor real hoje; documentado, não bloqueante.
3. Frontend não tem testes de componente React para `DecisionQueue`/
   `DecisionDetail` — só a lógica pura em `lib/agents/derived.ts` foi
   testada, consistente com o padrão já usado no resto do módulo
   Agentes (nenhum outro componente do módulo tem teste de
   componente).

## 26. Compatibilidade v1.0–v1.8

Confirmada pela suíte completa (363/363, incluindo todos os testes
anteriores a esta versão). `POST /director/signals/:id/propose` (v1.8)
intocado. Nenhuma rota/comportamento/permission existente alterado —
tudo aditivo.

## 27. Comandos de migration/seed/deploy

```bash
npm run db:migrate   # aplica 0014_agent_director_decisions.sql
npm run db:seed      # cria a permission agents.director.decisions.manage,
                      # a tool director.sync_decision_queue e o vínculo agente↔tool (idempotente)
```

## 28. Git status

```
?? backend/drizzle/0014_agent_director_decisions.sql
?? backend/drizzle/meta/0014_snapshot.json
?? backend/src/agents/director/decisions/
?? backend/src/db/schema/agent-director-decisions.ts
?? backend/src/routes/agents/director-decisions.test.ts
?? backend/src/routes/agents/director-decisions.ts
?? frontend/app/api/agents/director/decisions/
?? frontend/app/(dashboard)/agents/director/decisions/
?? frontend/components/agents/director/assign-decision-dialog.tsx
?? frontend/components/agents/director/decision-detail.tsx
?? frontend/components/agents/director/decision-queue.tsx
?? frontend/components/agents/director/dismiss-decision-dialog.tsx
?? frontend/hooks/agents/use-director-decisions.ts
 M backend/drizzle/meta/_journal.json
 M backend/src/agents/tools/director.ts
 M backend/src/db/schema/index.ts
 M backend/src/db/seed.ts
 M backend/src/routes/agents/index.ts
 M correio.md
 M frontend/components/agents/director/director-dashboard.tsx
 M frontend/components/agents/status-badge.tsx
 M frontend/lib/agents/derived.test.ts
 M frontend/lib/agents/derived.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
```

Nenhum commit foi feito. Aguardando revisão final.
