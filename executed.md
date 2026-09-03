# Agentes v2.4 — Workflow Recovery, Reconciliation & Operational Resilience

Relatório de entrega da v2.4, conforme `correio.md` seção 31 ("Relatório
final"), 30 itens obrigatórios. **NENHUM COMMIT foi feito** — todas as
alterações permanecem no working tree, aguardando autorização final do
Diretor/CEO.

---

## 1. Resumo

Implementado um mecanismo genérico de detecção e reconciliação de
workflows "stale" — claims persistidos (`Initiative.status='active'`,
`agent_executive_reviews.status='draft'`, `agent_strategic_memories.status='draft'`)
que sobrevivem a um crash do processo entre o claim e a
conclusão/compensação normal. Nenhum segundo Executor/Planner/Approval
Workflow/Policy Evaluator foi criado — o recovery só devolve cada
entidade a um estado do qual o pipeline OFICIAL já existente pode
retomar sozinho, ou escala para atenção humana quando não há como
reconciliar com segurança.

## 2. Problema estrutural resolvido

Nas v2.1/v2.2/v2.3, cada serviço (`startInitiativeExecution`,
`generateExecutiveReview`, `createStrategicMemoryFromReview`) já
compensa corretamente em **exceções JavaScript normais** (bloco `catch`
reverte o claim). O problema desta versão é distinto: se o **processo**
morrer (crash de container, OOM kill, deploy interrompendo o pod) entre
o claim persistido e a conclusão/`catch`, nenhum código roda para
compensar — o estado transitório fica órfão indefinidamente, bloqueando
o slot único (unique constraint) daquela entidade para sempre. A v2.4
detecta e reconcilia esses órfãos de fora, sem exigir que o processo que
os criou ainda exista.

## 3. Workflows mapeados

| entity | transitional state | terminal states | claim timestamp usado | expected next transition | retry existente |
|---|---|---|---|---|---|
| `agent_director_initiatives` | `status='active'` sem `action_plan_id` | `approved, blocked, completed, cancelled` | `updated_at` | `active` (com plano) → segue fluxo normal | `POST .../propose` (v2.1, idempotente) |
| `agent_executive_reviews` | `status='draft'` | `completed, superseded` | `updated_at` | `completed` | `POST .../review` (v2.2, idempotente) |
| `agent_strategic_memories` | `status='draft'` | `active, superseded, archived` | `updated_at` | `active` | `POST .../memory` (v2.3, idempotente) |

Nenhuma coluna nova foi necessária — `updated_at` já existe nas 3
tabelas e já é atualizado exatamente no momento do claim (seção 3:
"preferir utilizar timestamps já existentes").

Mapeamento adicional real, encontrado ao revisar o fluxo de
`startInitiativeExecution` (seção 7, "não inventar sem ler o código
real"): existe uma SEGUNDA janela de crash para Initiative — durante a
avaliação do Action Plan pelo Policy Evaluator (`agent_action_plans.status='evaluating'`
travado) — documentada e tratada como Caso C (item 8 abaixo).

## 4. Arquitetura de recovery

```
agents/recovery/
  types.ts                     — vocabulário (RecoveryResult, WorkflowType, StaleCandidate, RecoveryItemResult, RecoveryAdapter)
  registry.ts                  — lista pequena dos 3 adapters
  detector.ts                  — varre todos os adapters (best-effort por adapter)
  recovery-service.ts          — runRecovery() / reconcileOne() / getRecoveryStatus()
  manual-attention.ts          — escalação para a Director Decision Queue (reaproveitada)
  initiative-recovery.ts       — adapter da Initiative
  executive-review-recovery.ts — adapter da Executive Review
  strategic-memory-recovery.ts — adapter da Strategic Memory
```

O core (`recovery-service.ts`/`detector.ts`) NUNCA importa nada de
`db/schema` diretamente — só chama `adapter.detectStale()`/
`adapter.reconcile()` de cada item do `registry.ts` (seção 5: "o core não
deve conhecer detalhes internos de todas as tabelas").

## 5. Definição de stale

Nunca `status === 'draft'`/`'active'` sozinho (seção 3). Cada adapter
usa `updated_at < now() - thresholdSeconds` **combinado** com o status
transitório real:

- Initiative: `status='active' AND updated_at < staleBefore` — e depois
  se ramifica conforme `action_plan_id` (Caso A/B/C, ver item 8).
- Executive Review: `status='draft' AND updated_at < staleBefore`.
- Strategic Memory: `status='draft' AND updated_at < staleBefore`.

Provado por teste que um workflow em execução normal (recente) NUNCA é
confundido com stale (itens 2/4/6 da seção 24).

## 6. Configuração/threshold

`AGENT_WORKFLOW_STALE_AFTER_SECONDS` (`config/env.ts`) — default 900s
(15min), mínimo 60s (nunca tão curto a ponto de confundir um claim em
andamento com órfão), validado via o helper `positiveIntEnv` já
existente (mesmo padrão de `AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS`).
Getter (não valor capturado no import) — testes conseguem passar um
`thresholdSeconds` explícito para cada chamada (`detectStale`,
`reconcile`, `runRecovery`, `getRecoveryStatus`), sem precisar mutar
`process.env` — nenhum threshold hardcoded/mágico em nenhum lugar do
código de produção.

## 7. Registry/adapters

`registry.ts` exporta `RECOVERY_ADAPTERS: readonly RecoveryAdapter[]` —
uma lista simples, sem lógica. Cada adapter (`RecoveryAdapter` em
`types.ts`) implementa exatamente dois métodos: `detectStale(thresholdSeconds)`
e `reconcile(candidate, params)`. Adicionar um workflow recuperável no
futuro é só implementar essa interface e adicionar à lista — nenhuma
mudança no core.

## 8. Initiative recovery

Revisão do fluxo real de `startInitiativeExecution` (v2.1) feita antes
de implementar (seção 7). Três casos:

- **Caso A (não-stale, sem código):** `active` + Action Plan vinculado
  em status normal → NÃO aparece na lista de stale (o check-on-read
  existente, `syncInitiativeExecutionState`, já cuida disso sozinho).
- **Caso B (implementado — `reverted`):** `active` sem Action Plan e
  antiga → `UPDATE ... SET status='approved', started_at=null WHERE id=?
  AND status='active' AND action_plan_id IS NULL AND updated_at <
  staleBefore RETURNING`. Exatamente a MESMA compensação que o `catch`
  de `startInitiativeExecution` teria feito se tivesse tido a chance de
  rodar. Nunca cria Action Plan (seção 7). Retry seguro via
  `POST .../propose` (pipeline oficial).
- **Caso C (implementado — `manual_attention`, encontrado ao ler o
  código real):** `active` + Action Plan vinculado, mas o Action Plan
  ficou preso em `status='evaluating'` (o valor inicial, só avança
  quando todos os itens são avaliados) — evidência de um crash NO MEIO
  da avaliação do Policy Evaluator. Decidir sozinho o que fazer exigiria
  adivinhar quais itens já foram avaliados — proibido pela seção 7
  ("não tentar adivinhar"). Escalado para a Director Decision Queue,
  NENHUMA linha (Initiative nem Action Plan) é tocada.

**Limitação real documentada** (item 30): um crash EXATAMENTE entre
`executeActionPlan()` terminar e a transação final de vínculo
(`action_plan_id`) roda é indistinguível do Caso B pela detecção atual —
tratado como Caso B (Initiative volta para `approved`), deixando um
Action Plan órfão (já criado/executado, nunca religado). Não adivinhado
de propósito (seria "adivinhar", proibido pela seção 7).

## 9. Executive Review recovery

`status='draft' AND updated_at < staleBefore` →
`DELETE ... WHERE id=? AND status='draft' AND updated_at < staleBefore
RETURNING`. Resultado `reverted` (linha removida) ou `skipped` (0 linhas
afetadas — já não estava mais draft/stale). **Nunca chama o LLM**
(`executive-review-recovery.ts` não importa `llm/factory.ts` nem
`reviews/executive-reviewer.ts`) — só libera o slot único de
`action_plan_id`; a próxima chamada NORMAL a `POST .../review` gera a
review de verdade.

## 10. Strategic Memory recovery

Idêntico ao item 9, sobre `agent_strategic_memories` (`source_review_id`
como slot único). **Nunca fabrica uma memória incompleta como `active`,
nunca copia `lesson` de outro registro** (seção 9) — a única operação
possível é `DELETE` do claim órfão.

## 11. Regras de idempotência

Provado por teste (itens 14/15/16 da seção 24, "Idempotência/concorrência"):
- Duas reconciliações concorrentes da MESMA entidade produzem exatamente
  um `reverted`/`manual_attention` real e um `skipped` — nunca dois
  efeitos.
- Recovery repetido sobre uma entidade já reconciliada → `skipped`,
  nunca um erro destrutivo (a linha já não existe/já mudou de status —
  o predicado simplesmente não casa mais).
- Entidade alterada por outro processo (ex.: completou normalmente)
  ENTRE a detecção e a reconciliação → `skipped`, a entidade real
  (agora `completed`/`active`) NUNCA é tocada.

## 12. Proteção concorrente

Nunca `SELECT → decidir → UPDATE/DELETE` desprotegido (seção 11). Todo
`reconcile()` real usa `UPDATE`/`DELETE ... WHERE id=? AND status=<esperado>
AND updated_at < staleBefore RETURNING` — uma única instrução SQL
atômica; `RETURNING` prova qual chamada (se alguma) efetivamente venceu.
Nenhum `SELECT ... FOR UPDATE` bloqueante, nenhum lock segurado durante
I/O externo — o recovery desta versão nem faz I/O externo real (seção
11: "idealmente recovery desta versão nem precisa fazer I/O externo" —
cumprido: nenhum adapter chama LLM/tool/API externa).

## 13. Dry-run

`dryRun: boolean` propagado de `runRecovery()`/`reconcileOne()` até
`adapter.reconcile()` — quando `true`, cada adapter retorna o resultado
que SERIA aplicado (mesmo texto de `reason`, prefixado `dry_run:`) sem
executar nenhum `UPDATE`/`DELETE`/`INSERT` real. Provado por teste:
dry-run detecta os mesmos stale items, o banco permanece inalterado
(linha `draft` continua existindo), nenhum audit de `reconciled` é
emitido (só `scan.started`/`stale_detected`, que são sempre auditados
independente de dry-run — são leituras, não mutações).

## 14. Manual attention

`escalateToManualAttention()` (`recovery/manual-attention.ts`) reutiliza
a Director Decision Queue (`agent_director_decisions`, v1.9) — nenhuma
segunda fila de incidentes. Diferenciado de uma decisão estratégica
normal por: `domain='agents'` (já existente desde a v1.8), `signalType`
sempre prefixado `agents.recovery.*`, título/descrição explícitos
("Problema operacional de recovery"). Idempotente via
`deduplicationKey` + `ON CONFLICT DO NOTHING` (mesmo padrão de
`upsertSignal`, v1.9).

## 15. Integração com Decision Queue

Único uso desta versão: Caso C da Initiative recovery (item 8). O
Decision Item nasce `status='open'`, `requiresHumanAttention=true` — o
CEO vê e trata pelo MESMO mecanismo já existente (`GET/POST
/agents/director/decisions`), nenhuma tela nova de "incidentes de
recovery".

## 16. Auditoria

Implementados os 4 eventos sugeridos pela seção 14, ajustados aos fluxos
reais:
- `agents.recovery.scan.started` — a cada chamada de `runRecovery`
  (dry-run ou real), com `{dryRun, thresholdSeconds}`.
- `agents.recovery.stale_detected` — uma vez por item stale ENCONTRADO
  (nunca por entidade saudável examinada, seção 14) — `{workflowType,
  previousState, ageSeconds, problem, dryRun}`.
- `agents.recovery.reconciled` — só em reconciliação REAL bem-sucedida
  (`reverted`) — `{workflowType, previousState, ageSeconds, result,
  reason}`.
- `agents.recovery.manual_attention` — quando uma escalação acontece —
  `{workflowType, previousState, ageSeconds, decisionId}`.

Nunca secrets. `entityId` sempre presente exceto no evento agregado de
scan (que não tem uma entidade única).

## 17. Observabilidade/status

`getRecoveryStatus(thresholdSeconds?)` (calculado sob demanda, seção
15 — nenhuma tabela nova): `staleTotal`, `byType` (contagem por
`WorkflowType`), `oldest` (o candidato com maior `ageSeconds`),
`manualAttentionPending` (contagem real de Decision Items abertos com
`signalType LIKE 'agents.recovery.%'`), `lastScanAt`/`lastReconciledAt`
— **derivados da trilha de auditoria JÁ existente** (`audit_logs`,
`MAX(created_at)` dos eventos `scan.started`/`reconciled`) — nenhum
estado novo persistido só para isto.

## 18. API

```
GET  /agents/recovery/status              agents.operations.read
GET  /agents/recovery/stale               agents.operations.read
POST /agents/recovery/run?dryRun=&thresholdSeconds=   agents.recovery.manage
POST /agents/recovery/:type/:id?dryRun=   agents.recovery.manage
```

`POST /run` só executa a reconciliação segura desta versão — nunca
dispara execução arbitrária de agente/tool (seção 16). `POST /:type/:id`
implementado (seção 16: "somente se houver necessidade clara") — permite
reconciliar manualmente UM item já identificado via `GET /stale`, sem
esperar o próximo scan completo.

## 19. Permissions

Avaliado antes de criar (seção 17): `agents.manage` é "reservada para
CRUD de agentes" (descrição já existente, não semanticamente adequada);
`agents.autonomy.manage` é só o kill switch global. Nenhuma permission
existente cobria "executar reconciliação administrativa de workflows" —
criada `agents.recovery.manage` (justificada, protege `POST /run` e
`POST /:type/:id`). Leitura (`GET /status`, `GET /stale`) reaproveita
`agents.operations.read` — mesma natureza de observabilidade
operacional do dashboard v1.8 (seção 17: "leitura pode usar permission
mais ampla de observabilidade/admin"). Nenhuma permission nova para
leitura. Authorization sempre no backend (`requirePermission()`).

## 20. Frontend

Nova página `/agents/recovery` (`RecoveryDashboard`) — tela
administrativa/operacional (nunca apresentada como ferramenta diária):

- Card "Saúde dos workflows": stale total, por tipo (Initiatives/
  Executive Reviews/Strategic Memories), mais antigo, atenção manual
  pendente (destacado em âmbar quando > 0), último scan, última
  reconciliação.
- Card "Workflows stale": tabela Tipo/ID/Estado/Idade/Problema/Ação
  proposta-resultado (seção 27) — populada por `GET /stale`.
- "Simular recuperação" (dry-run, atrás de `PermissionGate agents.recovery.manage`,
  sempre disponível sem confirmação — sem custo real) preenche a coluna
  "Ação proposta" com o resultado simulado.
- "Executar recuperação" abre um `Dialog` de confirmação explícita antes
  de rodar de verdade (seção 26: "exibir confirmação adequada antes de
  operação real").
- Item "Recovery" adicionado à sub-navegação do módulo Agentes
  (visível com `agents.operations.read`).

## 21. Migrations

**Nenhuma migration foi necessária** (seção 29: "evitar migration se
timestamps/estados atuais forem suficientes") — `updated_at` já existe
e já é atualizado corretamente nas 3 tabelas envolvidas nos momentos
certos (claim). Nenhuma coluna nova foi criada por conveniência.

## 22. Arquivos criados

Backend:
```
backend/src/agents/recovery/types.ts
backend/src/agents/recovery/registry.ts
backend/src/agents/recovery/detector.ts
backend/src/agents/recovery/recovery-service.ts
backend/src/agents/recovery/manual-attention.ts
backend/src/agents/recovery/initiative-recovery.ts
backend/src/agents/recovery/executive-review-recovery.ts
backend/src/agents/recovery/strategic-memory-recovery.ts
backend/src/agents/recovery/schemas.ts
backend/src/agents/recovery/adapters.test.ts
backend/src/agents/recovery/recovery-service.test.ts
backend/src/routes/agents/recovery.ts
backend/src/routes/agents/recovery.test.ts
```

Frontend:
```
frontend/app/(dashboard)/agents/recovery/page.tsx
frontend/app/api/agents/recovery/status/route.ts
frontend/app/api/agents/recovery/stale/route.ts
frontend/app/api/agents/recovery/run/route.ts
frontend/app/api/agents/recovery/[type]/[id]/route.ts
frontend/components/agents/recovery/recovery-dashboard.tsx
frontend/hooks/agents/use-recovery.ts
```

## 23. Arquivos alterados

```
backend/src/config/env.ts             (+AGENT_WORKFLOW_STALE_AFTER_SECONDS)
backend/src/db/seed.ts                (+permission agents.recovery.manage)
backend/src/routes/agents/index.ts    (+registro de recoveryRoutes)
frontend/components/agents/agents-sub-nav.tsx   (+item "Recovery")
frontend/components/agents/status-badge.tsx     (+RecoveryResultBadge)
frontend/lib/agents/derived.ts                  (+recoveryResultLabel, workflowTypeLabel, formatAgeSeconds)
frontend/lib/agents/derived.test.ts             (+5 testes)
frontend/lib/query/keys.ts                      (+recoveryStatus, recoveryStale)
frontend/services/agents.ts                     (+getRecoveryStatus, getStaleWorkflows, runWorkflowRecovery, reconcileWorkflow)
frontend/types/agents.ts                        (+RecoveryResult/WorkflowType/StaleCandidate/RecoveryItemResult/RecoveryReport/RecoveryStatus)
```

## 24. Testes adicionados

Cobrindo os 28 itens da seção 24 do correio.md:

- `agents/recovery/adapters.test.ts` (novo) — **20 testes**: detecção
  (itens 1-6, incluindo Caso A e Caso C explícitos), reconciliação real
  (itens 7-13), idempotência/concorrência (itens 14-16), segurança
  (itens 17-20: nunca cria approval, nunca executa tool, nunca modifica
  permission/Policy Evaluator).
- `agents/recovery/recovery-service.test.ts` (novo) — **8 testes**:
  dry-run (itens 22-24), relatório estruturado reconciliável
  matematicamente, auditoria (itens 25-26), manual_attention visível
  (item 27), status agregado (item 28), `reconcileOne` (item específico
  + entidade não-stale → null).
- `routes/agents/recovery.test.ts` (novo) — **7 testes**: (item 21)
  sem permission → 403 em ambas as rotas mutáveis/status; só
  `agents.operations.read` → leitura OK, execução continua 403; `GET
  /stale` real via HTTP; dry-run via HTTP não altera banco + execução
  real reconcilia de verdade; `POST /:type/:id` reconcilia item
  específico; entidade não-stale → 404; `type` inválido → 400.

Total: **35 testes novos no backend**. Nenhum teste novo de frontend
além dos 5 de label/formatação (`derived.test.ts`) — a UI não introduziu
lógica testável isoladamente além dessas funções puras (o dashboard em
si é testado indiretamente pelos testes de rota, que provam o contrato
real que ele consome).

## 25. Números exatos backend (medidos pelo runner real)

**Baseline após v2.3** (correio.md seção 25, medida real da entrega
anterior): `491 testes / 491 pass / 0 fail`.

**Suíte completa após a v2.4** (`npx tsx --test --test-concurrency=1
'src/**/*.test.ts'`, via Docker):

```
ℹ tests 526
ℹ suites 92
ℹ pass 526
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**Reconciliação:** 491 → 526 = **+35 testes líquidos**, batendo
exatamente com a soma por arquivo: `adapters.test.ts` (20) +
`recovery-service.test.ts` (8) + `routes/agents/recovery.test.ts` (7) =
35. Nenhuma regressão.

## 26. Números exatos frontend (medidos pelo runner real)

`npx tsx --test 'lib/**/*.test.ts'`:

```
ℹ tests 87
ℹ suites 31
ℹ pass 87
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Baseline anterior 82/82 → 87/87 = **+5 testes líquidos**
(`recoveryResultLabel` 2 + `workflowTypeLabel` 2 + `formatAgeSeconds` 1).
Nenhuma regressão.

## 27. Typecheck/build

- Backend typecheck (`npx tsc --noEmit`, via Docker): **OK, sem erros.**
- Frontend typecheck (`npx tsc --noEmit`): **OK, sem erros.**
- Frontend build (`npm run build`): **OK** — rotas `/agents/recovery`,
  `/api/agents/recovery/status`, `/api/agents/recovery/stale`,
  `/api/agents/recovery/run`, `/api/agents/recovery/[type]/[id]`
  presentes na saída.
- Lint: continua sem script/config configurado — reconfirmado.

## 28. `git diff --stat`

```
 backend/src/config/env.ts                     | 20 +++++++++++
 backend/src/db/seed.ts                        |  6 ++++
 backend/src/routes/agents/index.ts            |  2 ++
 frontend/components/agents/agents-sub-nav.tsx |  1 +
 frontend/components/agents/status-badge.tsx   | 20 +++++++++++
 frontend/lib/agents/derived.test.ts           | 46 +++++++++++++++++++++++++
 frontend/lib/agents/derived.ts                | 33 ++++++++++++++++++
 frontend/lib/query/keys.ts                    |  2 ++
 frontend/services/agents.ts                   | 26 +++++++++++++++
 frontend/types/agents.ts                      | 48 +++++++++++++++++++++++++++
 10 files changed, 204 insertions(+)
```

Novos arquivos (sem histórico prévio, fora do `diff --stat`):
```
backend/src/agents/recovery/                    (13 arquivos)
backend/src/routes/agents/recovery.ts
backend/src/routes/agents/recovery.test.ts
frontend/app/(dashboard)/agents/recovery/
frontend/app/api/agents/recovery/
frontend/components/agents/recovery/
frontend/hooks/agents/use-recovery.ts
```

## 29. `git status`

```
 M backend/src/config/env.ts
 M backend/src/db/seed.ts
 M backend/src/routes/agents/index.ts
 M correio.md
 M executed.md
 M frontend/components/agents/agents-sub-nav.tsx
 M frontend/components/agents/status-badge.tsx
 M frontend/lib/agents/derived.test.ts
 M frontend/lib/agents/derived.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
?? backend/src/agents/recovery/
?? backend/src/routes/agents/recovery.test.ts
?? backend/src/routes/agents/recovery.ts
?? frontend/app/(dashboard)/agents/recovery/
?? frontend/app/api/agents/recovery/
?? frontend/components/agents/recovery/
?? frontend/hooks/agents/use-recovery.ts
```

## 30. Bugs/limitações reais encontradas

1. **Erro corrigido durante a implementação (routes/agents/recovery.ts):**
   a primeira versão de `GET /recovery/stale` continha uma expressão
   incoerente (`query.data.thresholdSeconds ?? (await getRecoveryStatus()).staleTotal
   >= 0 ? undefined! : undefined!`), resíduo de uma reformulação
   incompleta enquanto o handler era escrito — corrigida por
   autorrevisão (não por typecheck: a expressão era sintaticamente
   válida, só semanticamente sem sentido) para
   `query.data.thresholdSeconds ?? env.AGENT_WORKFLOW_STALE_AFTER_SECONDS`
   antes de qualquer typecheck/teste rodar contra o arquivo — nunca
   chegou a ser executada. Validada depois pelos 7 testes de
   `routes/agents/recovery.test.ts`.
2. **Limitação estrutural conhecida (Initiative recovery, Caso B vs.
   crash no vínculo final):** já documentada no item 8 — um crash
   exatamente entre `executeActionPlan()` terminar e o `UPDATE` final de
   `action_plan_id` produz um Action Plan órfão (nunca religado
   automaticamente) quando a Initiative é revertida para `approved`.
   Deliberado — a alternativa seria "adivinhar" qual plano pertence a
   qual Initiative, proibido pela seção 7. Uma nova tentativa de
   `POST .../propose` cria um Action Plan NOVO; o antigo fica órfão mas
   inofensivo (nunca é executado de novo, nunca aparece em nenhuma
   consulta de "Action Plan desta Initiative").
3. **`marked_failed`/`recovered`/`retried` não são produzidos por
   nenhum adapter desta versão** — mantidos no vocabulário
   (`RECOVERY_RESULTS`) para adapters futuros, mas nenhum fluxo real
   hoje os gera (só `reverted`, `manual_attention`, `skipped`). Reflete
   fielmente o escopo pedido (seção 6 pede o vocabulário completo, não
   que todos os valores sejam alcançáveis nesta versão).
4. **`GET /recovery/stale` e `GET /recovery/status` fazem 2 varreduras
   completas independentes quando chamados em sequência** (cada um roda
   `scanStaleWorkflows` do zero) — aceitável no volume esperado (poucas
   entidades stale por vez, cada adapter é uma query simples), mas se o
   volume de workflows crescer ordens de magnitude, vale considerar
   cache de curta duração entre as duas chamadas do frontend (que hoje
   rodam em paralelo via TanStack Query, uma para status, outra para a
   lista completa).
5. **Nenhuma integração automática com o scheduler existente foi feita
   nesta versão** (correio.md seção 19: "não implementar recorrência
   automática nesta versão salvo necessidade técnica comprovada") —
   `runRecovery()` só é chamado manualmente via `POST /run`. A
   arquitetura já permite chamar essa mesma função de dentro do
   scheduler de Jobs existente (`agents/jobs/job-runner.ts`) no futuro,
   sem nenhuma mudança de contrato.

---

## Conclusão

Todos os 21 critérios da seção 30 do correio.md foram atendidos:
workflows stale detectados com threshold temporal (testado); registros
recentes nunca confundidos com stale (testado); recuperação idempotente
(testado); concorrência protegida (testado, via `UPDATE`/`DELETE ...
RETURNING` condicional); Executive Review e Strategic Memory draft
órfãs recuperáveis (testado); Initiative órfã reconciliada com
segurança nos 3 casos reais (A/B/C, testados); recovery nunca cria
segundo Action Plan, nunca executa tool, nunca cria approval, nunca
modifica permissions (todos testados); inconsistências perigosas
escaladas para atenção humana via Decision Queue reaproveitada
(testado); dry-run sem side effects (testado); operações auditáveis
(testado); status agregado existe (calculado sob demanda a partir de
dados já existentes); permission administrativa protege a execução
(`agents.recovery.manage`, testada); nenhuma arquitetura paralela foi
criada; backend completo passa (526/526); frontend completo passa
(87/87); typechecks limpos; build de produção passa.

**NENHUM COMMIT foi realizado.** Todas as alterações permanecem no
working tree, aguardando autorização final do Diretor/CEO.
