# Executado — v3.8: Operational Incident Ownership & Assignment

## 1. Análise prévia da persistência (descoberta obrigatória, seção 1)

Revisados antes de qualquer schema: `audit_logs`,
`agent_operational_incident_reviews` (v3.6), a fila `Needs Attention`
(v3.7), `supervision-insights-service.ts`, `supervisor-service.ts`,
`users`/`roles`/`permissions`/`role_permissions` (RBAC existente),
`SupervisionIncidentDetailDialog`, os hooks React Query envolvidos, e
Escalations (v2.6)/FollowUps (v2.7). Respostas explícitas pedidas pela
seção 1:

1. **Existe estrutura persistente que possa representar ownership de
   incidente sem ambiguidade?** Não. `agent_operational_escalations.targetUserId`
   e `agent_operational_follow_ups.assignedUserId` só existem quando
   `escalateSupervisorFinding` (v2.6) resolve uma Responsibility com
   domínio inequívoco — a maioria dos incidentes nunca tem uma
   Escalation/FollowUp correspondente (mesma lacuna já documentada para
   review em v3.6). Usar qualquer um desses campos como "responsável
   pelo incidente" deixaria a maioria dos incidentes sem ownership
   possível.
2. **`agent_operational_incident_reviews` pode receber essa
   responsabilidade sem misturar conceitos?** Não, deliberadamente.
   Review (acknowledged/resolved/dismissed) e ownership (quem está
   trabalhando nisso) são dimensões ortogonais — um incidente pode estar
   atribuído a alguém e ainda `unreviewed`, ou `resolved` e continuar
   atribuído para contexto histórico. Sobrecarregar a tabela de review
   violaria exatamente o que o correio.md pede para evitar ("não
   transformar `agent_operational_incident_reviews` em um registro
   genérico de workflow").
3. **Assignment precisa de nova persistência?** Sim — nenhuma estrutura
   existente representa "responsável corrente por incidente" sem
   ambiguidade. **Migration nova, portanto, justificada e criada.**
4. **Por que a decisão não cria uma segunda identidade de incidente?**
   `agent_operational_incident_assignments.incidentAuditLogId` é FK real
   (`onDelete: restrict`) para `audit_logs.id`, com a MESMA validação de
   "é um `agents.operations.incident.detected` de verdade"
   (`isValidIncidentAuditLog`, reexportada de `incident-review-service.ts`
   e reutilizada aqui — nunca uma segunda função de validação).

## 2. Decisão de migration

**Criada** — `0024_agent_operational_incident_assignments.sql`, gerada
via `drizzle-kit generate` e aplicada ao Postgres real (`drizzle-kit
migrate`), confirmada com `\d` no banco.

## 3. Schema final

```
agent_operational_incident_assignments
  id                     serial PK
  incident_audit_log_id  integer NOT NULL, FK→audit_logs.id (restrict), UNIQUE
  assignee_user_id       integer NOT NULL, FK→users.id (restrict)
  assigned_by            integer NOT NULL, FK→users.id (restrict)
  assigned_at            timestamptz NOT NULL
  created_at / updated_at timestamptz
  index (assignee_user_id)
```

Nenhum campo especulativo (`priority`/`due_date`/`sla`/`team_id`/
`auto_assign`/etc.) — exatamente a lista mínima pedida pelo correio.md.
Sem `tenant_id`/`workspace_id`: busca ampla no repositório (seção 1 da
descoberta) confirma que este sistema é **single-tenant** — nenhuma
tabela `tenants`/`workspaces`/`organizations`/`memberships` existe em
`db/schema/*`.

**"Não atribuído" = ausência de linha** (nunca uma linha com
`assignee_user_id` nulo — a coluna nem aceita `NULL`), mesmo idioma já
usado por `unreviewed` em `agent_operational_incident_reviews` (v3.6):
`unassignIncident` faz `DELETE`, nunca grava um valor nulo. O histórico
de quem foi responsável antes (mesmo depois de desatribuído) vive
exclusivamente em `audit_logs` (append-only) — esta tabela representa só
o presente.

## 4. Regra exata de assignment

- **Assign/Reassign**: uma única operação (`assignIncident`), nunca dois
  endpoints/serviços redundantes — "reassignment é consequência natural
  de assignIncident" (correio.md seção 9). `INSERT ... ON CONFLICT
  (incident_audit_log_id) DO UPDATE`, mesma instrução atômica já usada
  por `upsertIncidentReview` (v3.6).
- **Idempotência** (correio.md seção 5, preferência explícita): atribuir
  novamente o MESMO usuário nunca falha, sempre devolve o estado final
  correto. O audit trail registra a chamada mesmo assim
  (`previousAssigneeUserId === assigneeUserId` no metadata) — mesma
  escolha já feita por `upsertIncidentReview`, que audita toda chamada
  independente de o estado mudar.
- **Unassign**: `DELETE` da linha — idempotente por natureza (deletar 0
  linhas nunca é erro). Só gera audit quando havia algo a desatribuir de
  fato (nada mudou → nada auditado, testado explicitamente).
- **Vocabulário de audit** (seção 4): `agents.operations.incident.assigned`
  (quando não havia responsável antes), `.reassigned` (quando já havia,
  inclusive reatribuição idempotente ao mesmo usuário), `.unassigned`.
  Metadata: `incidentAuditLogId`, `previousAssigneeUserId`,
  `assigneeUserId`, `performedByUserId` — nenhuma cópia de nome/e-mail
  (resolvido pela fonte oficial, `users`, sempre que necessário).

## 5. Regra de elegibilidade do assignee

Único critério: **o `userId` existe na tabela `users`** — exatamente a
mesma checagem já usada em todo o projeto para "quem pode ser
responsável" (`reassignFollowUp`, criação de Goal/Initiative/
Responsibility, todos via um `assertUserExists` equivalente, nunca
escopado por papel/contexto). Confirmado (seção 1): este sistema não tem
nenhuma segunda dimensão de "contexto operacional/tenant/workspace" —
portanto não há uma segunda regra de elegibilidade a implementar. O item
12 dos testes obrigatórios ("usuário fora do contexto é rejeitado") é
coberto pelo mesmo teste do item 11 ("usuário inexistente"), documentado
explicitamente no código e nos testes — não existe uma segunda
dimensão para testar aqui.

## 6. Autorização

Nenhuma permission nova. Leitura (`GET .../assignment`, e o campo
`assignment` embutido no detalhe/histórico/fila) reaproveita
`agents.operations.read`; escrita (`PATCH`/`DELETE .../assignment`)
reaproveita `agents.operations.manage` — mesma semântica já usada pelo
review (v3.6): "read → pode ver; manage → pode mudar". Testado
explicitamente: `agents.operations.read` sozinho dá 403 em PATCH/DELETE.

## 7. Atomicidade/auditoria

Todo `assignIncident`/`unassignIncident` que efetivamente muda estado
sempre grava o audit correspondente na mesma chamada de função — nunca
existe um caminho de código que altera a linha e não audita (verificado
em código e testado). **Limitação documentada, não nova desta versão**:
o helper `audit()` compartilhado por todo o projeto não é
transaction-aware (confirmado em código — usa sempre o `db` do módulo,
nunca aceita um `tx`), e nenhum outro módulo do domínio Agentes
(inclusive `upsertIncidentReview`, v3.6, que o correio.md pediu
explicitamente para espelhar) envolve estado+audit na mesma transação
Postgres. Mudar isso exigiria alterar um helper de baixo nível
compartilhado por dezenas de call sites — fora do escopo desta versão
(evitar "aproveitar a rodada" para tocar infraestrutura não pedida).
Testado na prática: após `assignIncident`, tanto a linha de estado
quanto o audit correspondente existem de forma consistente (nenhum caso
de estado sem audit observado nos testes).

## 8. Estratégia de concorrência

`INSERT ... ON CONFLICT (incident_audit_log_id) DO UPDATE` — mesma
garantia nativa do Postgres já usada por `upsertIncidentReview`, ponto
de serialização no índice único, isolado POR INCIDENTE (nenhum lock
global do Supervisor). Testado com duas atribuições concorrentes reais
(`Promise.all`) ao MESMO incidente: exatamente uma linha ao final, valor
de uma das duas escritas (nunca corrompido).

## 9. Endpoints

Namespace coerente com v3.5–v3.7. `PATCH`/`DELETE` em vez do `PUT`
sugerido literalmente pelo correio.md — decisão documentada em código:
**nenhum `app.put` existe em todo o backend** (confirmado por busca);
`PATCH`/`DELETE` é a semântica REST já estabelecida no projeto, e o
correio.md já permitia essa alternativa ("ou outra semântica REST já
usada pelo projeto").

```
GET    /agents/operations/supervision-insights/incidents/:auditLogId/assignment   (agents.operations.read)
PATCH  /agents/operations/supervision-insights/incidents/:auditLogId/assignment   (agents.operations.manage) — assign/reassign
DELETE /agents/operations/supervision-insights/incidents/:auditLogId/assignment   (agents.operations.manage) — unassign
```

Nenhum endpoint redundante (`/assign`, `/reassign`, `/take`, `/claim`).
`GET .../needs-attention` ganhou `assigneeUserId`/`unassignedOnly` como
filtros opcionais — MESMO endpoint da fila reutilizado, nenhum endpoint
dedicado a "My Incidents" (seção 13).

## 10. Integração com v3.5/v3.6/v3.7

- `SupervisionIncidentSummary` (v3.5) ganhou o campo `assignment`
  (`{ assigneeUserId, assignedBy, assignedAt } | null`), resolvido pela
  MESMA `enrichIncidentRows` já usada por `listSupervisionIncidents`,
  `getSupervisionIncidentDetail` e `listAttentionQueue` — nenhum código
  duplicado, nenhuma segunda função de enriquecimento.
- `SupervisionIncidentDetail` (v3.5) e `AttentionQueueItem` (v3.7) já
  herdam `assignment` automaticamente por extensão de interface — nenhum
  campo extra precisou ser adicionado a esses tipos.
- `SupervisionIncidentDetailDialog` (v3.5/v3.6/v3.7) continua sendo o
  ÚNICO diálogo — ganhou uma seção "Responsável" própria
  (`IncidentAssignmentSection`), visualmente separada de "Review humano"
  (nunca misturadas, seção 6: assign ≠ acknowledge/resolve/dismiss).
- Ordenação da fila (v3.7) **intocada**: `compareAttentionPriority`
  continua exatamente `severity → recurrence → reviewStatus → aging →
  auditLogId` — testado explicitamente que um incidente atribuído de
  severidade menor nunca pula na frente de um crítico não atribuído.
- Testado explicitamente: acknowledge/resolve/dismiss NUNCA criam/trocam
  assignment; assign/reassign/unassign NUNCA alteram `reviewStatus`;
  `resolved` sai da fila default (regra v3.7 intocada) mas o assignment
  continua acessível via filtro explícito de `reviewStatus`, exatamente
  como pedido pela seção 6.

## 11. Estratégia anti-N+1

`getIncidentAssignmentsByAuditLogIds` (`IN (...)`, mesmo padrão de
`getIncidentReviewsByAuditLogIds`) resolve uma PÁGINA inteira de
incidentes em uma única query extra dentro de `enrichIncidentRows` —
nunca uma consulta por linha. Resolução de NOME do responsável fica a
cargo do frontend via `useUsersDirectory` (já carregado uma única vez
por página, mesmo padrão já usado para o nome do revisor em
`IncidentReviewSection`, v3.6) — evita um segundo join batched no
backend só para nomes, sem reintroduzir N+1 em lugar nenhum. Testado
com instrumentação real de `db.select`: resolver 6 incidentes custa
exatamente 1 query (mesmo custo de resolver 0 ou 60).

## 12. Arquivos criados

- `backend/drizzle/0024_agent_operational_incident_assignments.sql`
- `backend/drizzle/meta/0024_snapshot.json`
- `backend/src/db/schema/agent-operational-incident-assignments.ts`
- `backend/src/agents/operations/incident-assignment-service.ts`
- `backend/src/agents/operations/incident-assignment-service.test.ts`
- `frontend/app/api/agents/operations/supervision-insights/incidents/[auditLogId]/assignment/route.ts`

## 13. Arquivos alterados

- `backend/drizzle/meta/_journal.json`
- `backend/src/agents/operations/attention-queue-service.test.ts`
- `backend/src/agents/operations/incident-review-service.ts` — `isValidIncidentAuditLog` exportada para reuso.
- `backend/src/agents/operations/schemas.ts` — `updateIncidentAssignmentSchema`; `assigneeUserId`/`unassignedOnly` em `attentionQueueQuerySchema`.
- `backend/src/agents/operations/supervision-insights-service.ts` — `assignment` em `SupervisionIncidentSummary`, enriquecimento batched, filtros da fila.
- `backend/src/db/schema/index.ts`
- `backend/src/routes/agents/operations.ts` — rotas GET/PATCH/DELETE de assignment.
- `backend/src/routes/agents/operations.test.ts` — describe novo de assignment.
- `frontend/components/agents/operations/attention-queue-section.tsx` — coluna e filtro de responsável.
- `frontend/components/agents/operations/supervision-insights-section.tsx` — `IncidentAssignmentSection`.
- `frontend/hooks/agents/use-operations.ts` — `useIncidentAssignment`/`useAssignIncident`/`useUnassignIncident`.
- `frontend/lib/query/keys.ts` — `incidentAssignment`.
- `frontend/services/agents.ts` — `getIncidentAssignment`/`assignIncident`/`unassignIncident`; `ListAttentionQueueParams` estendido.
- `frontend/types/agents.ts` — `IncidentAssignment`; `assignment` em `SupervisionIncidentSummary`.

## 14. Testes adicionados

**`backend/src/agents/operations/incident-assignment-service.test.ts`
(7 testes, todos passando)**, contra o Postgres real: ciclo completo
(sem responsável → assign → reassign → unassign, tudo auditado com
metadata correto); idempotência de reatribuir o mesmo usuário; usuário
inexistente rejeitado (cobre também "fora do contexto"); incidente
inexistente rejeitado (GET/assign/unassign, inclusive audit que não é
`incident.detected`); unassign de incidente já sem responsável é
idempotente e não gera audit novo; ausência de N+1 (instrumentação real
de `db.select`, 1 query para 6 incidentes); concorrência (duas
atribuições simultâneas nunca corrompem/duplicam a linha).

**`backend/src/agents/operations/attention-queue-service.test.ts`
(4 testes novos)**: assignment aparece na fila e filtro `assigneeUserId`
combina com severity/reviewStatus; filtro `unassignedOnly`; assignment
NÃO altera a ordenação da fila (severidade continua decidindo); ausência
de ações automáticas cruzadas (acknowledge/resolve/dismiss não
criam/trocam assignment; assign não altera reviewStatus); `resolved`
sai da fila default sem destruir o assignment, ainda acessível via
filtro explícito.

**`backend/src/routes/agents/operations.test.ts` (6 testes novos)**:
403 em GET/PATCH/DELETE sem a permission correta; leitura só não implica
escrita; `.strict()` rejeita campos extra; usuário inexistente → 400;
audit que não é `incident.detected`/auditLogId inexistente → 404;
ciclo PATCH→GET→detalhe→fila→DELETE refletindo em cada um dos 4 lugares.

Total de testes novos: **17**.

## 15. Resultado completo da validação

Baseline pós-v3.7 descoberto no repositório (não assumido): **772/772**
no backend, **119/119** no frontend (mesmos números do relatório da
v3.7, confirmados antes de iniciar esta rodada).

| Item | Resultado |
|---|---|
| Migration | criada (`0024_agent_operational_incident_assignments`), aplicada e verificada no Postgres real |
| Backend typecheck (`tsc --noEmit`) | limpo |
| Testes específicos da v3.8 (assignment service + describe novo em attention-queue e operations.test.ts) | **17/17** |
| Suíte completa do backend (`--test-concurrency=1`) | **789/789** (772 + 17 novos — exatamente o esperado) |
| Frontend typecheck (`tsc --noEmit`) | limpo |
| Frontend lint (`eslint`) | limpo |
| Frontend testes (`node --test`) | **119/119** (baseline exata, nenhuma regressão) |
| Frontend build (`next build`, node 24) | sucesso (exit 0) |
| `supervisor-guard.ts` | **intocado** (`git diff --stat` vazio) |

Nenhuma divergência entre o total esperado (baseline + testes novos) e o
total observado — nenhuma investigação adicional necessária.

## 16. Confirmações explícitas

- `supervisor-guard.ts` **não foi alterado** (`git diff --stat` vazio
  para o arquivo).
- **Nenhum aumento de autonomia**: a v3.8 é 100% coordenação humana —
  toda mutação (assign/reassign/unassign) exige um `actorUserId`
  autenticado explícito; nenhum auto-assignment, round-robin,
  classificação por LLM, load balancing, reatribuição automática, prazo
  automático ou SLA — nenhum desses conceitos existe no código.
- **Nenhum novo Circuit Breaker** criado ou alterado.
- **Nenhuma segunda identidade de incidente**: `agent_operational_incident_assignments`
  referencia exclusivamente `audit_logs.id` via FK real, validado pela
  MESMA função (`isValidIncidentAuditLog`) já usada pelo review — nunca
  uma tabela paralela de "incidentes" nem um `incident_id` sintético.
- **Assignment nunca executa ação operacional automaticamente**: testado
  explicitamente que assign/reassign/unassign não alteram `reviewStatus`,
  `outcome`, a decisão (`response`) do Supervisor, nem a ordenação da
  fila por default — é puramente um rótulo de "quem está cuidando
  disso", nunca um gatilho.
- Response Policy, Planner, Policy Evaluator, Executor, Circuit Breaker,
  scheduler, recovery, detecção de incidentes, escalation automática e
  follow-up automático não foram tocados — validado pela suíte completa
  (789/789) rodando todos os testes desses módulos sem alteração.

Nenhum commit foi feito. Nenhum deploy. Nenhuma infraestrutura
reconstruída além da migration/validação local necessárias. Relatório
pronto para aprovação.
