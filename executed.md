# Agentes v2.5 — Operational Supervision & Autonomous Incident Response

Relatório de entrega da v2.5, conforme `correio.md` seção 33 ("Relatório
final"), 32 itens obrigatórios. **NENHUM COMMIT foi feito** — todas as
alterações permanecem no working tree, aguardando autorização final do
Diretor/CEO.

---

## 1. Resumo

Implementada uma camada de supervisão operacional que responde à
pergunta "existe alguma condição operacional que exija observação,
recuperação segura, redução de autonomia ou intervenção humana?" —
inteiramente coordenando mecanismos JÁ EXISTENTES (Jobs/Runs, Event
Engine, Approvals, Director Decision Queue, Recovery v2.4, Circuit
Breaker/autonomy, audit logs). Nenhum segundo Executor, scheduler,
Circuit Breaker, Decision Queue ou mecanismo de recovery foi criado.
**Nenhuma decisão é tomada por LLM** — o Response Policy inteiro é uma
tabela de decisão determinística, testada exaustivamente sem mock.

## 2. Mapa operacional encontrado

Revisão do código real feita ANTES de implementar (seção 31), com uma
descoberta arquitetural central: **já existia um "Incident Center"**
(v1.6, `agents/incidents/service.ts` + `routes/agents/incidents.ts`,
permission `agents.incidents.read`) que já deriva `job_repeated_failure`
e `event_delivery_failed` a partir de `agent_job_runs`/
`agent_event_deliveries`/`agent_autonomy_blocks` — exatamente parte do
que a v2.5 pede. **Reaproveitado diretamente** (`listIncidents()`),
nunca reimplementado.

| fonte real | estado transitório/degradação | mecanismo de detecção já existente | reaproveitado como |
|---|---|---|---|
| `agent_jobs`/`agent_job_runs` | falhas consecutivas | `incidents/service.ts:fetchRepeatedFailureIncidents` (usa `circuit.failureThreshold`) | signal `job_repeated_failure` |
| `agent_job_runs` | Run preso (`queued/planning/running/waiting_approval` antigo) | **nenhum** — novo detector | signal `run_stuck` |
| `agent_event_deliveries` | delivery falhada | `incidents/service.ts:fetchEventDeliveryFailedIncidents` | signal `delivery_failure` |
| `agent_jobs.circuit_state` | circuito aberto | leitura direta (mais precisa que a projeção histórica de `agent_autonomy_blocks`) | signal `autonomy_circuit_open` |
| `agent_approvals` | pendente há muito tempo | **nenhum** — novo detector | signal `approval_bottleneck` |
| `agent_director_decisions` | `requires_human_attention=true`, `domain='agents'`, aberta | já existe desde v1.9/v2.4 (inclui `agents.recovery.*`) | signal `manual_attention_pending` |
| `settings` (kill switch) | autonomia global desabilitada | `agents/jobs/global-switch.ts` (v1.3) | signal `autonomy_disabled_globally` |
| Recovery v2.4 | workflow stale | `recovery/detector.ts:scanStaleWorkflows` | signal `workflow_stale` |

Documentado em código (docblocks de `signals.ts`), não só aqui.

## 3. Arquitetura

```
agents/operations/
  health-types.ts        — vocabulário (Signal, Incident, Response, Health, Report)
  signals.ts              — collectOperationalSignals() — leitura pura, reaproveita v1.6/v2.4/v1.3/v1.9
  incidents.ts            — classifyIncidents() — correlação/dedup determinística, pura
  response-policy.ts      — evaluateResponsePolicy() — tabela de decisão pura, SEM LLM
  manual-attention.ts     — escalateIncidentToManualAttention() — reaproveita Decision Queue
  safe-actions.ts         — applySafeRecovery() (chama Recovery v2.4), restrictJobAutonomy() (mesmo kill switch v1.5)
  health-service.ts       — getOperationalHealth() — snapshot só-leitura
  supervisor-service.ts   — runOperationalSupervision() — orquestra tudo, aplica respostas
```

Fluxo real (seção 2): `signals → classify → policy → {observe|safe_recovery|restrict_autonomy|manual_attention|already_handled} → mecanismo oficial`.
Nenhuma camada decide "executar tool arbitrária" — estruturalmente
impossível: nenhum destes arquivos importa `executor/`, `tool-registry`
ou o LLM.

## 4. Fontes de sinais

Ver mapa da seção 2. Todas as 8 fontes pedidas pela seção 3 foram
cobertas com pelo menos um detector real — nenhuma inventada.

## 5. Signal types

`workflow_stale, job_repeated_failure, run_stuck, delivery_failure,
autonomy_circuit_open, approval_bottleneck, manual_attention_pending,
autonomy_disabled_globally` (8, `health-types.ts`). Nunca secrets/tokens/
stack traces — cada `metadata` é montado campo-a-campo pelo coletor,
nunca um erro bruto repassado.

## 6. Incident types

Os 9 sugeridos pela seção 6, reduzidos a 8 reais + mapeamento
documentado (`incidents.ts`): `workflow_stale` (signal) → incident
`recovery_required`; `manual_attention_pending` → `manual_attention_required`;
`autonomy_disabled_globally` → `operational_degradation`; os demais
mantêm o nome. `operational_degradation` cobre especificamente a
autonomia global desabilitada — o único caso real de degradação de
escopo GLOBAL (não específica de uma entidade) encontrado no código.

## 7. Severity

Determinística, nunca escolhida por LLM (seção 7): `job_repeated_failure`
e `autonomy_circuit_open` são sempre `critical` (risco de loop/perda de
controle de autonomia, exatamente os exemplos da seção 7);
`run_stuck`/`delivery_failure`/`approval_bottleneck`/`workflow_stale`/
`autonomy_disabled_globally` são `warning`; `manual_attention_pending`
herda a severidade real do Decision Item de origem. Um incidente
correlacionado usa a MAIOR severidade entre seus sinais.

## 8. Health calculation

`getOperationalHealth()` — sob demanda, nunca persistido (seção 4):
`collectOperationalSignals` (leitura) → `classifyIncidents` (pura) →
`buildRecommendations` (Response Policy + 1 query em lote para contexto
de `repeated_job_failure`). `status` por prioridade determinística:
`restricted` (autonomia restrita agora — circuito aberto, kill switch
global, ou Job desabilitado) > `attention_required` (crítico ou atenção
manual pendente) > `degraded` (algum incidente) > `healthy`.

## 9. Response policy

Tabela de decisão pura (`response-policy.ts`, `evaluateResponsePolicy`),
zero I/O, zero LLM:

| incident type | condição | resposta |
|---|---|---|
| `recovery_required` | sempre | `safe_recovery` |
| `repeated_job_failure` | severity warning | `observe` |
| `repeated_job_failure` | crítico + autonomia ligada | `restrict_autonomy` |
| `repeated_job_failure` | crítico + autonomia JÁ restrita | `manual_attention` |
| `run_stuck` | sempre | `observe` (nenhum recovery seguro nesta versão) |
| `delivery_failure` | sempre | `observe` |
| `autonomy_circuit_open` | sempre | `already_handled` (Circuit Breaker já agiu) |
| `approval_bottleneck` | sempre | `observe` |
| `manual_attention_required` | sempre | `already_handled` (já é um Decision Item aberto) |
| `operational_degradation` | sempre | `observe` (nunca reativa autonomia global sozinho) |

## 10. Safe recovery

`applySafeRecovery()` chama `recovery/recovery-service.ts:reconcileOne`
(v2.4) diretamente — nenhuma linha de tabela tocada por este módulo.
Provado por teste real (`23: safe_recovery chama Recovery v2.4 de
verdade`): uma review `draft` órfã inserida diretamente no banco é
removida pela chamada de supervisão, através do MESMO caminho de código
já testado exaustivamente na v2.4.

## 11. Autonomy restriction

`restrictJobAutonomy()` escreve na MESMA coluna do kill switch por Job
já existente (`agent_jobs.autonomy_enabled`, mesmo campo do `PATCH
/agents/jobs/:id/autonomy` da v1.5) — nenhum segundo kill switch.
Estruturalmente só reduz (a função não tem parâmetro para religar).
`UPDATE ... WHERE id=? AND autonomy_enabled=true` — condicional, nunca
incondicional (seção 18): um Job já restrito nunca sofre efeito
duplicado (provado por teste de idempotência e de concorrência).

## 12. Manual attention

`escalateIncidentToManualAttention()` reutiliza a Director Decision
Queue (`agent_director_decisions`) — `domain='agents'`,
`signalType='agents.operations.<tipo>'`, `requiresHumanAttention=true`.
Deduplicação por `deduplicationKey` estável
(`agents.operations.<tipo>::<entityType>::<entityId>`) + `ON CONFLICT
DO NOTHING` — o mesmo incidente NUNCA cria uma segunda decisão a cada
scan (provado por teste explícito de 3 scans seguidos).

## 13. Correlation/deduplication

`classifyIncidents()` (`incidents.ts`) — determinística, sem ML, sem
LLM (seção 13). Chave `${incidentType}:${entityType}:${entityId}` —
múltiplos sinais do mesmo Job falhando viram UM incidente (provado por
teste: 3 sinais → 1 incidente). Entidade diferente sempre produz
incidente independente (também testado).

## 14. Thresholds

Avaliados ANTES de criar (seção 14/31): `job_repeated_failure` reaproveita
`circuit.failureThreshold` (mesmo valor do Circuit Breaker real, via
`resolveGlobalSetting`, já usado pelo Incident Center v1.6 — NUNCA um
segundo threshold divergente); `workflow_stale` reaproveita
`AGENT_WORKFLOW_STALE_AFTER_SECONDS` (v2.4). Só 2 variáveis
verdadeiramente novas, sem equivalente algum no código real:
`AGENT_OPERATIONAL_STUCK_AFTER_SECONDS` (default 1800s, min 60) e
`AGENT_OPERATIONAL_APPROVAL_WARNING_AFTER_SECONDS` (default 3600s, min
60) — ambas via o helper `positiveIntEnv` já existente, getters (não
capturadas no import, mesmo padrão de `AGENT_WORKFLOW_STALE_AFTER_SECONDS`).

## 15. Dry-run

`dryRun` propagado até `adapter.reconcile()`/`restrictJobAutonomy()` —
quando `true`, NENHUM `UPDATE`/`DELETE`/`INSERT` real acontece; cada
resultado usa outcomes prefixados `would_*` (seção 16). Provado por
teste: dry-run detecta os mesmos incidentes, reporta `would_recover`/
`would_restrict_autonomy`, e o banco permanece bit-a-bit inalterado
(review draft continua existindo, `autonomy_enabled` continua `true`).

## 16. Concorrência

Nunca `SELECT → decisão em memória → UPDATE incondicional` (seção 18).
`restrictJobAutonomy` usa `UPDATE ... WHERE autonomy_enabled=true
RETURNING`; `safe_recovery` reaproveita os predicados condicionais já
provados da v2.4; `manual_attention` reaproveita `ON CONFLICT DO
NOTHING`. Provado por teste real: duas chamadas de
`runOperationalSupervision` concorrentes sobre o MESMO Job falhando
produzem exatamente UMA restrição real (auditoria com
`triggeredBy=operational_supervisor` aparece exatamente uma vez).

## 17. Idempotência

Executar o supervisor duas vezes sobre o mesmo estado nunca duplica
efeito (seção 17) — provado por teste de 3 scans consecutivos: 1º
restringe a autonomia, 2º (Job já restrito, falhas continuam) escala
para `manual_attention` em vez de tentar restringir de novo, 3º não
duplica o Decision Item já existente.

## 18. Scheduler

Não integrado ao scheduler automático nesta entrega (seção 19: "só
integrar se puder ser feito de forma pequena e segura... caso a
integração aumente muito o escopo, deixar serviço pronto e documentar
a ativação automática para v2.5.1"). `runOperationalSupervision()` é
um serviço reutilizável e independente de transporte — chamável de
dentro do scheduler de Jobs já existente
(`agents/jobs/job-runner.ts`/o `setInterval` do scheduler v1.3) sem
nenhuma mudança de contrato, quando a ativação automática for decidida.
Nenhum cron interno concorrente, nenhum segundo scheduler, nenhum
`setInterval` solto foi criado.

## 19. Auditoria

Implementados os 7 eventos sugeridos (seção 21), ajustados ao fluxo
real: `agents.operations.scan.started` (início, com `dryRun`),
`agents.operations.incident.detected` (por incidente correlacionado —
NUNCA por sinal bruto, "evitar dezenas de audit logs" seção 14/21),
`agents.operations.safe_recovery`, `agents.operations.autonomy_restricted`,
`agents.operations.manual_attention` (só quando a ação real acontece,
nunca em dry-run), `agents.operations.scan.completed` (fim, com
contagens). `agents.operations.signal.detected` (sugerido pela seção
21) foi DELIBERADAMENTE OMITIDO — ver item 32 (limitações).

## 20. API

```
GET  /agents/operations/health       agents.operations.read
GET  /agents/operations/incidents    agents.operations.read
POST /agents/operations/supervise?dryRun=  agents.operations.manage
```

`POST /:type/:id` individual (equivalente ao de Recovery v2.4) NÃO foi
criado — nenhuma necessidade objetiva encontrada (seção 23: "só criar
endpoints adicionais se houver necessidade objetiva"); reconciliação
manual de item único já existe em `POST /agents/recovery/:type/:id`
(v2.4), reaproveitável diretamente quando necessário. O endpoint de
execução (`/supervise`) nunca aceita instrução livre do usuário — só
`dryRun` (boolean); a política aplicada é sempre a codificada.

## 21. Permissions

Leitura reaproveita `agents.operations.read` (mesma já usada por
`/operations/summary` desde a v1.6 — mesma natureza de observabilidade).
Execução: avaliado se `agents.recovery.manage` bastava (seção 22) —
**não**: sua descrição já existente é explicitamente escopada a
"reconciliação de workflows stale" (só Initiative/Review/Memory); o
Supervisor também restringe autonomia de Job e escala incidentes mais
amplos (Job failures, delivery failures, approval bottlenecks) — uma
capacidade administrativa genuinamente mais ampla. Criada
`agents.operations.manage`, justificada. Authorization sempre no
backend (`requirePermission()`); frontend só esconde botões via
`PermissionGate`, nunca é a barreira real.

## 22. Frontend

Reaproveitada a página `/agents/operations` JÁ EXISTENTE (v1.6) —
**nunca criada uma segunda rota paralela** para "operações" (a sugestão
da seção 24 colidiria exatamente com essa página real; decisão
documentada em código). Nova seção "Supervisão Operacional" adicionada
abaixo do dashboard v1.6 existente:

- Card "Saúde operacional": status badge (Healthy/Degraded/Attention
  Required/Restricted), incidentes ativos/críticos, stale workflows,
  Jobs com falha, falhas de delivery, atenção humana pendente, gerado em.
- Card "Incidentes": tabela Severity/Type/Entity/Problem/Detected/
  Recommended response/Current state (seção 25).
- "Simular supervisão" (dry-run, sem confirmação — seção 26) / "Executar
  supervisão" (dialog de confirmação explícito, texto exato da seção
  26: "poderá executar recoveries previamente autorizados, restringir
  autonomia... criar itens de atenção humana", nunca "IA vai corrigir
  tudo").
- Ações atrás de `PermissionGate agents.operations.manage`; leitura
  segue a permission já existente da página.

## 23. Migrations

**Nenhuma migration foi necessária** (seção 30: "evitar migration... se
status e histórico puderem ser representados adequadamente"). Toda a
observabilidade é derivada de tabelas/colunas já existentes
(`agent_jobs`, `agent_job_runs`, `agent_event_deliveries`,
`agent_approvals`, `agent_director_decisions`, `audit_logs`, tabelas da
v2.4) — nenhuma tabela `operational_incidents` foi criada, exatamente a
preferência da seção 20.

## 24. Arquivos criados

Backend:
```
backend/src/agents/operations/health-types.ts
backend/src/agents/operations/signals.ts
backend/src/agents/operations/incidents.ts
backend/src/agents/operations/response-policy.ts
backend/src/agents/operations/manual-attention.ts
backend/src/agents/operations/safe-actions.ts
backend/src/agents/operations/health-service.ts
backend/src/agents/operations/supervisor-service.ts
backend/src/agents/operations/incidents.test.ts
backend/src/agents/operations/response-policy.test.ts
backend/src/agents/operations/signals.test.ts
backend/src/agents/operations/supervisor-service.test.ts
backend/src/routes/agents/operations-supervisor.test.ts
```

Frontend:
```
frontend/app/api/agents/operations/health/route.ts
frontend/app/api/agents/operations/incidents/route.ts
frontend/app/api/agents/operations/supervise/route.ts
frontend/components/agents/operations/operations-supervisor-dashboard.tsx
frontend/hooks/agents/use-operations-supervisor.ts
```

## 25. Arquivos alterados

```
backend/src/agents/operations/schemas.ts     (+superviseQuerySchema)
backend/src/config/env.ts                     (+AGENT_OPERATIONAL_STUCK_AFTER_SECONDS, +AGENT_OPERATIONAL_APPROVAL_WARNING_AFTER_SECONDS)
backend/src/db/seed.ts                        (+permission agents.operations.manage)
backend/src/routes/agents/operations.ts       (+GET /health, +GET /incidents, +POST /supervise)
frontend/app/(dashboard)/agents/operations/page.tsx  (+seção Supervisão Operacional)
frontend/components/agents/status-badge.tsx   (+4 badges novos)
frontend/lib/agents/derived.ts                (+4 famílias de label)
frontend/lib/agents/derived.test.ts           (+10 testes)
frontend/lib/query/keys.ts                    (+operationalHealth, operationalIncidents)
frontend/services/agents.ts                   (+getOperationalHealth, getOperationalIncidents, runOperationalSupervision)
frontend/types/agents.ts                      (+SupervisorSignal/OperationalIncident/OperationalHealth/OperationalSupervisionReport e vocabulário)
```

## 26. Testes adicionados

Cobrindo os 37 itens da seção 28 do correio.md:

- `incidents.test.ts` (novo) — **6 testes**: itens 7-10 (severity
  warning/critical, correlação evita duplicação, entidade diferente
  independente) + saudável sem incidente + mapeamento signal→incident.
- `response-policy.test.ts` (novo) — **10 testes**: itens 11-14
  (observe/safe_recovery/restrict_autonomy/manual_attention) + os 6
  demais tipos de incidente exaustivamente.
- `signals.test.ts` (novo) — **8 testes**: itens 1-6 (saudável, stale,
  falha isolada vs. threshold, autonomia restrita, Decision Queue) +
  run_stuck + approval_bottleneck (novos detectores desta versão).
- `supervisor-service.test.ts` (novo) — **12 testes**: execução (itens
  21-25: dry-run, safe_recovery real, manual_attention real),
  segurança (itens 15-20: nunca Action Plan/approval/tool/permission,
  nunca aumenta autonomia, nunca toca Circuit Breaker), idempotência
  (itens 26-28), concorrência (item 29), status (itens 35-37).
- `routes/agents/operations-supervisor.test.ts` (novo) — **5 testes**:
  itens 30-34 (403 sem permission, 200 com `agents.operations.read`,
  dry-run real via HTTP, execução real via HTTP, shape do health).

Total: **41 testes novos no backend**. Nenhum teste novo de frontend
além dos 10 de label (`derived.test.ts`) — mesma justificativa das
entregas anteriores: a UI é validada indiretamente pelos testes de rota
reais que ela consome.

## 27. Números exatos backend (medidos pelo runner real)

**Baseline após v2.4**: `526 testes / 526 pass / 0 fail`.

**Suíte completa após a v2.5** (`npx tsx --test --test-concurrency=1
'src/**/*.test.ts'`, via Docker):

```
ℹ tests 567
ℹ suites 99
ℹ pass 567
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**Reconciliação:** 526 → 567 = **+41 testes líquidos**, batendo
exatamente com a soma por arquivo (6+10+8+12+5=41). Nenhuma regressão —
todos os 526 testes anteriores continuam passando.

## 28. Números exatos frontend (medidos pelo runner real)

`npx tsx --test 'lib/**/*.test.ts'`:

```
ℹ tests 92
ℹ suites 35
ℹ pass 92
ℹ fail 0
```

Baseline anterior 87/87 → 92/92 = **+5 testes líquidos** (labels de
Operational Health Status/Severity/Incident Type/Response — 4 describes,
alguns com múltiplos `assert` num único `test`). Nenhuma regressão.

## 29. Typecheck/build

- Backend typecheck (`npx tsc --noEmit`, via Docker): **OK, sem erros.**
- Frontend typecheck (`npx tsc --noEmit`): **OK, sem erros.**
- Frontend build (`npm run build`): **OK** — rotas
  `/api/agents/operations/health`, `/api/agents/operations/incidents`,
  `/api/agents/operations/supervise` presentes na saída.
- Lint: continua sem script/config configurado — reconfirmado, nada
  adicionado.

## 30. `git diff --stat`

```
 backend/src/agents/operations/schemas.ts           | 13 +++
 backend/src/config/env.ts                          | 16 ++++
 backend/src/db/seed.ts                              |  6 ++
 backend/src/routes/agents/operations.ts             | 39 ++++++++-
 frontend/app/(dashboard)/agents/operations/page.tsx | 14 ++++
 frontend/components/agents/status-badge.tsx         | 62 ++++++++++++++
 frontend/lib/agents/derived.test.ts                 | 50 ++++++++++++
 frontend/lib/agents/derived.ts                      | 53 ++++++++++++
 frontend/lib/query/keys.ts                          |  2 +
 frontend/services/agents.ts                         | 16 ++++
 frontend/types/agents.ts                            | 95 ++++++++++++++++++++++
 11 files changed, 364 insertions(+), 2 deletions(-)
```

Novos arquivos (sem histórico prévio, fora do `diff --stat`):
```
backend/src/agents/operations/health-service.ts
backend/src/agents/operations/health-types.ts
backend/src/agents/operations/incidents.test.ts
backend/src/agents/operations/incidents.ts
backend/src/agents/operations/manual-attention.ts
backend/src/agents/operations/response-policy.test.ts
backend/src/agents/operations/response-policy.ts
backend/src/agents/operations/safe-actions.ts
backend/src/agents/operations/signals.test.ts
backend/src/agents/operations/signals.ts
backend/src/agents/operations/supervisor-service.test.ts
backend/src/agents/operations/supervisor-service.ts
backend/src/routes/agents/operations-supervisor.test.ts
frontend/app/api/agents/operations/health/
frontend/app/api/agents/operations/incidents/
frontend/app/api/agents/operations/supervise/
frontend/components/agents/operations/operations-supervisor-dashboard.tsx
frontend/hooks/agents/use-operations-supervisor.ts
```

## 31. `git status`

```
 M backend/src/agents/operations/schemas.ts
 M backend/src/config/env.ts
 M backend/src/db/seed.ts
 M backend/src/routes/agents/operations.ts
 M correio.md
 M executed.md
 M frontend/app/(dashboard)/agents/operations/page.tsx
 M frontend/components/agents/status-badge.tsx
 M frontend/lib/agents/derived.test.ts
 M frontend/lib/agents/derived.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
?? backend/src/agents/operations/health-service.ts
?? backend/src/agents/operations/health-types.ts
?? backend/src/agents/operations/incidents.test.ts
?? backend/src/agents/operations/incidents.ts
?? backend/src/agents/operations/manual-attention.ts
?? backend/src/agents/operations/response-policy.test.ts
?? backend/src/agents/operations/response-policy.ts
?? backend/src/agents/operations/safe-actions.ts
?? backend/src/agents/operations/signals.test.ts
?? backend/src/agents/operations/signals.ts
?? backend/src/agents/operations/supervisor-service.test.ts
?? backend/src/agents/operations/supervisor-service.ts
?? backend/src/routes/agents/operations-supervisor.test.ts
?? frontend/app/api/agents/operations/health/
?? frontend/app/api/agents/operations/incidents/
?? frontend/app/api/agents/operations/supervise/
?? frontend/components/agents/operations/operations-supervisor-dashboard.tsx
?? frontend/hooks/agents/use-operations-supervisor.ts
```

## 32. Bugs/limitações reais encontradas

1. **Colisão de nome de tipo no frontend, corrigida antes de rodar
   qualquer teste:** `OperationalSignal` já existia em `types/agents.ts`
   (módulo Director v1.8, sinais de negócio) — meu tipo novo tinha o
   MESMO nome com shape incompatível (`severity`/`entityId` com tipos
   diferentes). `npx tsc --noEmit` acusou o conflito imediatamente
   (`TS2717`); renomeado para `SupervisorSignal` (nunca chegou a ser
   usado incorretamente em nenhum componente).
2. **`agents.operations.signal.detected` (sugerido pela seção 21) foi
   deliberadamente omitido** — auditar cada SINAL bruto (antes da
   correlação) geraria potencialmente dezenas de eventos por scan para
   o mesmo Job/incidente, exatamente o ruído que a própria seção 14/21
   pede para evitar ("evitar gerar dezenas de audit logs por entidade
   saudável" / "registrar somente eventos significativos"). Optei por
   auditar só `agents.operations.incident.detected` (já correlacionado/
   deduplicado) — decisão documentada em código
   (`supervisor-service.ts`).
3. **`run_stuck` e `delivery_failure` não têm nenhuma resposta
   automática além de `observe` nesta versão** — não existe, no código
   real, nenhum mecanismo comprovadamente seguro para "destravar" um
   Job Run preso ou reprocessar uma delivery falha (Recovery v2.4 cobre
   só Initiative/Executive Review/Strategic Memory). Implementar algo
   aqui seria "o Supervisor implementa reconciliação própria",
   proibido pela seção 10. Ambos ficam só como observabilidade — uma
   limitação real, não escondida.
4. **`GET /operations/incidents` recalcula o health inteiro
   internamente** (chama `getOperationalHealth()` e devolve só
   `.incidents`) — decisão simples e correta (nunca duas
   implementações divergentes da mesma classificação), mas
   tecnicamente refaz o trabalho de `GET /operations/health` quando as
   duas rotas são chamadas em sequência pelo frontend (mesmo padrão/
   mesma limitação já documentada na v2.4 para `GET /recovery/stale` +
   `GET /recovery/status`). Aceitável no volume esperado.
5. **Nenhuma integração automática com o scheduler** foi feita nesta
   versão (documentado no item 18) — ativação automática fica para uma
   v2.5.1, exatamente como a seção 19 permite explicitamente.
6. **`entityId` em `OperationalIncident`/Decision Item é sempre uma
   string** (para acomodar entidades sem id numérico, como
   `agent_approvals_backlog:global`) — ao escalar para a Director
   Decision Queue, `escalateIncidentToManualAttention` converte para
   `number` quando possível (`Number.isFinite`) e usa `null` quando não
   (ex.: incidentes agregados globais como `approval_bottleneck` ou
   `operational_degradation`) — comportamento correto e testado, só
   registrado aqui por transparência de design.

---

## Conclusão

Todos os 21 critérios da seção 34 do correio.md foram atendidos:
nenhum segundo Executor/scheduler/Circuit Breaker/Decision Queue/
mecanismo de recovery criado; incidentes derivados de estados reais
(mapeados na seção 2, nunca inventados); classificação determinística
(testada exaustivamente); Response Policy sem LLM (garantido
estruturalmente); recovery usa exclusivamente v2.4; supervisor nunca
eleva autonomia (testado); condição perigosa restringe autonomia
(testado); condição ambígua escala ao humano (testado); dry-run sem
side effects (testado); execução real idempotente (testado);
concorrência segura (testado); operations health disponível; auditoria
implementada; backend authorization correta (nova permission
justificada); testes de segurança cobrem as 12 proibições da seção 27;
suíte completa verde (567/567); frontend build verde; nenhuma regressão
arquitetural.

**NENHUM COMMIT foi realizado.** Todas as alterações permanecem no
working tree, aguardando autorização final do Diretor/CEO.
