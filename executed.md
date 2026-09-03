# Agentes v2.5.1 — Automatic Operational Supervision

Relatório de entrega da v2.5.1, conforme `correio.md` seção 41
("Relatório final"), 34 itens obrigatórios. **NENHUM COMMIT foi feito**
— todas as alterações permanecem no working tree, aguardando
autorização final do Diretor/CEO.

---

## 1. Resumo

O `Operational Supervisor` da v2.5 foi integrado ao mecanismo de
agendamento já existente da plataforma — o mesmo idioma de
`setInterval`/`start()`/`stop()` já usado 2x no projeto
(`agents/jobs/scheduler.ts`, `agents/events/worker.ts`), agora numa
TERCEIRA instância, nunca um segundo motor de scheduling genérico.
Ativação automática começa desabilitada em dois níveis independentes
(capacidade de infraestrutura via env + decisão operacional via setting
persistido), protegida por um guard central único compartilhado entre a
execução manual (HTTP) e a automática (scheduler) — nunca duas
execuções reais simultâneas, nunca dois guards independentes.

## 2. Scheduler existente encontrado

Revisão feita ANTES de implementar (seção 3), dos dois pollers reais já
existentes:

**`agents/jobs/scheduler.ts`** (`pollDueJobs`/`startJobScheduler`/
`stopJobScheduler`): inicia via `setInterval` só quando
`env.AGENT_JOBS_SCHEDULER_ENABLED` (default `false`); `.unref()` — nunca
mantém o processo vivo sozinho; primeiro tick só após o 1º intervalo
(nunca no boot); overlap por Job é resolvido DENTRO de `runAgentJob`
(lock+budget), não no nível do scheduler; erro por Job capturado
individualmente, e o `.catch()` externo no `setInterval` protege contra
qualquer rejeição escapar; `stopJobScheduler()` só limpa o timer (sem
esperar tick em andamento); `start`/`stop` idempotentes
(`if (schedulerInterval) return`).

**`agents/events/worker.ts`** (`drainPendingEvents`/`startEventWorker`/
`stopEventWorker`): estrutura idêntica, poller do Event Engine, mesmo
padrão de lifecycle.

**`server.ts`**: os dois são iniciados condicionalmente logo após
recovery de boot (`recoverAbandonedRuns`/`recoverAbandonedEvents`,
executados uma única vez), e parados em `shutdown()` (chamado por
SIGTERM/SIGINT) antes de fechar app/DB/Redis.

## 3. Forma de integração adotada

Nova TERCEIRA instância do MESMO idioma —
`agents/operations/scheduler.ts` (`startOperationalSupervisionScheduler`/
`stopOperationalSupervisionScheduler`/`runScheduledOperationalSupervision`)
— nunca compartilha o timer do Jobs scheduler (concerns diferentes: um
polla `agent_jobs`, este dispara `runOperationalSupervision`).
`Operational Supervisor != AgentJob` (seção 4): esta função nunca cria
`agent_jobs`, nunca chama `runAgentJob`/`pollDueJobs`.

## 4. Lifecycle

```
server.ts boot
  → if (env.AGENT_OPERATIONAL_SUPERVISION_ENABLED) startOperationalSupervisionScheduler(intervalMs)
  → timer criado, primeiro tick só após 1 intervalo completo (nunca no boot)
  → a cada tick: runScheduledOperationalSupervision()
       → if (!setting persistido) return (sem nenhum audit — seção 16)
       → runGuardedOperationalSupervision({triggeredBy:'scheduler'})
            → guard livre? executa runOperationalSupervision() real
            → guard ocupado? SupervisionAlreadyRunningError → audit scheduler.skipped
       → exceção não capturada pelo guard? audit scheduler.failed (nunca escapa)
server.ts shutdown (SIGTERM/SIGINT)
  → stopOperationalSupervisionScheduler() (limpa o timer — nenhum tick novo)
  → app.close()/database.end()/redis.disconnect()
```

## 5. Configuração

`AGENT_OPERATIONAL_SUPERVISION_ENABLED` (env, default `false`) +
`AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS` (env, default `300`,
min `60`) — só 2 variáveis, exatamente as sugeridas.

## 6. Default de segurança

Dois níveis independentes (seção 7, "env = capacidade, setting =
decisão operacional atual" — exemplo literal do próprio correio.md):

- `AGENT_OPERATIONAL_SUPERVISION_ENABLED` (env): se `false`, o timer
  NEM É CRIADO no boot — capacidade de infraestrutura.
- Setting persistido (`agents_operational_supervision_enabled`, tabela
  `settings`, MESMO mecanismo do kill switch de autonomia v1.3) —
  decisão operacional atual, default `false` SEMPRE, independente do
  valor do env (nunca herdado dele) — só uma chamada explícita a
  `PATCH /agents/operations/scheduler` liga de verdade, mesmo com o
  timer já rodando. Direção do default deliberadamente OPOSTA à do kill
  switch de autonomia (que é `true` por padrão) — documentado em código
  (`scheduler-settings.ts`): aqui a supervisão automática só liga com
  decisão administrativa explícita (seção 5).

## 7. Intervalo

Só via env, NÃO editável em runtime nesta versão (seção 26: "não
adicionar edição apenas porque é fácil") — mínimo 60s (via
`positiveIntEnv`, mesmo helper já usado por todos os outros thresholds
do projeto), default 300s. `PATCH /agents/operations/scheduler` só
aceita `{enabled}`, nunca `{intervalSeconds}`.

## 8. Trigger automático

`runScheduledOperationalSupervision()` — checa o setting, e se ligado,
chama `runGuardedOperationalSupervision({dryRun: false, actorUserId:
null, triggeredBy: 'scheduler'})`. `triggeredBy` é a única mudança de
contrato sobre `runOperationalSupervision` da v2.5 (seção 15: "ajustar
contrato só se realmente necessário") — viaja até o metadata de
`agents.operations.scan.started`/`.scan.completed` (auditoria já
existente, reaproveitada — nenhum evento novo duplicado).

## 9. Guard de concorrência

`agents/operations/supervisor-guard.ts` — `runGuardedOperationalSupervision()`
é o guard CENTRAL único (seção 29: "não criar schedulerGuard/apiGuard
independentes") — usado pela rota HTTP manual E pelo scheduler
automático, nunca dois guards separados. Guard em memória (`let
running`), sem `await` entre checagem e escrita (event loop
single-threaded de Node — nunca há janela de corrida real entre as duas
linhas, ao contrário dos guards inter-processo das v2.1-v2.5 que
precisam de `SELECT`/`UPDATE` condicional). `runner` injetável só para
teste (mesmo padrão de `collectors?` em `sync-service.ts`).

## 10. Concorrência manual × automática

`POST /agents/operations/supervise` (rota HTTP) agora chama
`runGuardedOperationalSupervision(..., triggeredBy:'manual')` em vez de
`runOperationalSupervision` direto — MESMO guard do scheduler. Uma
chamada manual enquanto outra (manual OU automática) já está em
andamento devolve **409 Conflict** com mensagem clara (seção 28),
**nunca enfileira** (seção 27 preferência explícita). Provado por teste
real via HTTP: duas chamadas `POST /supervise` concorrentes → uma 200,
uma 409.

## 11. Multi-instance

`docker-compose.yml` real do projeto não define `replicas`/`scale` —
uma única instância de backend hoje. O guard em memória (`supervisor-guard.ts`)
é, portanto, suficiente nesta versão (seção 10: "se atualmente existe
uma única instância, pode ser usado guard local, desde que a limitação
seja documentada"). **Limitação real e documentada**: se o deploy
migrar para múltiplas réplicas, este guard NÃO protege contra execuções
automáticas simultâneas em processos DIFERENTES — precisaria de um
lock distribuído (Redis, já usado em outras partes do projeto, seria o
candidato natural) — não implementado, não necessário hoje.

## 12. Tratamento de exception

`runScheduledOperationalSupervision()` envolve a chamada em
`try/catch` — uma exceção real (não `SupervisionAlreadyRunningError`,
tratada separadamente) é capturada, auditada como
`agents.operations.scheduler.failed`, e NUNCA relançada. O
`.catch()` adicional no callback do `setInterval` (mesmo padrão dos
outros 2 pollers) protege em profundidade contra qualquer rejeição
residual. Provado por teste: injetando um `runner` que lança, o guard
libera, o erro é auditado, e o PRÓXIMO tick funciona normalmente — a
suíte completa (599/599) prova que nenhum teste subsequente foi afetado.

## 13. Isolamento do scheduler

Este é o critério bloqueante da seção 12 — provado por teste real
(`8/9/28` em `scheduler.test.ts`): supervisor lança exceção → guard
libera → auditoria `scheduler.failed` registrada → chamada seguinte a
`runScheduledOperationalSupervision()` executa normalmente, sem
nenhum estado residual travado.

## 14. Graceful shutdown

`stopOperationalSupervisionScheduler()` adicionado a `server.ts:shutdown()`,
ao lado de `stopJobScheduler()`/`stopEventWorker()` já existentes —
reaproveita o MESMO handler de SIGTERM/SIGINT já registrado (seção 21:
"não criar handlers duplicados"). `stop()` só limpa o timer — nenhum
tick NOVO dispara depois disso; um tick JÁ em andamento no momento do
sinal continua até resolver naturalmente (mesmo comportamento dos 2
pollers já existentes — nenhum mecanismo de "aguardar conclusão" foi
adicionado, por consistência com o padrão real já estabelecido).

## 15. Restart behavior

Nenhuma tentativa de "compensar" ticks perdidos — `lastTickAt`/
`schedulerStartedAt` são estado em memória, perdido no restart; o
scheduler simplesmente recomeça a contar do zero (seção 19: "missed
supervision tick != queued work" — a supervisão observa estado ATUAL,
nunca uma fila). Nenhuma supervisão acumulada é disparada no boot.

## 16. Auditoria

Eventos implementados (ajustados aos fluxos reais, seção 16):
`agents.operations.scheduler.skipped` (overlap real, nunca a cada tick
desabilitado — provado por teste: tick desabilitado gera ZERO audit
logs de scheduler), `agents.operations.scheduler.failed` (exceção não
tratada). `agents.operations.scheduler.started` foi DELIBERADAMENTE
OMITIDO — `agents.operations.scan.started`/`.scan.completed` (já
existentes desde a v2.5, agora carregando `triggeredBy` no metadata) já
cobrem exatamente essa informação; duplicar seria "ruído redundante"
(seção 16, texto literal). `PATCH /operations/scheduler` também audita
`agents.operations.scheduler.enabled`/`.disabled` (mesmo padrão do
`PATCH /agents/autonomy` v1.6).

## 17. Observabilidade

`GET /agents/operations/scheduler` → `OperationalSupervisionSchedulerStatus`
(`agents/operations/scheduler-status.ts`) — combina 3 fontes, nenhuma
tabela nova (seção 17/18): `enabled` do setting persistido;
`running`/`nextRunAt`/`intervalSeconds`/`active` de estado em memória do
próprio processo (`supervisor-guard.ts`/`scheduler.ts`);
`lastStartedAt`/`lastCompletedAt`/`lastFailedAt`/`lastDurationMs`/
`lastResult` DERIVADOS da trilha de auditoria já existente
(`agents.operations.scan.started`/`.scan.completed`/`.scheduler.failed`)
— best-effort por ordem temporal (não por ID compartilhado, documentado
em código), suficiente para uma tela de observabilidade.

## 18. API

```
GET   /agents/operations/scheduler   agents.operations.read
PATCH /agents/operations/scheduler   agents.operations.manage  (só aceita {enabled: boolean})
```

`POST /agents/operations/supervise` (v2.5) alterado para passar pelo
guard central (item 10) — comportamento externo idêntico exceto o novo
409 em caso de overlap. `PATCH` rejeita qualquer campo além de
`enabled` (`.strict()` do Zod) — nunca aceita `{"command": "..."}`
(provado por teste HTTP real).

## 19. Permissions

Reaproveitadas INTEGRALMENTE da v2.5 (seção 23: "não criar nova
permission sem necessidade objetiva") — `agents.operations.read`
(leitura) e `agents.operations.manage` (alteração). Nenhuma permission
nova criada nesta versão.

## 20. Frontend

Nova seção "Supervisão automática" (`OperationalSupervisionSchedulerCard`)
adicionada à MESMA página `/agents/operations` (v1.6/v2.5, nunca uma
rota nova) — mostra habilitada/desabilitada, executando agora,
intervalo, último início/conclusão/falha, duração, resultado, próximo
ciclo (seção 24). Botão Habilitar/Desabilitar atrás de `PermissionGate
agents.operations.manage`, com `window.confirm` (mesmo mecanismo já
usado por `GlobalAutonomyToggle`, v1.6) mostrando o TEXTO EXATO pedido
pela seção 25 ao habilitar — nunca "permitir que a IA corrija o sistema
sozinha". Os botões "Simular supervisão"/"Executar supervisão" da v2.5
continuam funcionando sem alteração de UI (seção 27) — um 409 real (se
houver overlap) aparece como toast de erro, mesmo mecanismo já usado em
todo o módulo.

## 21. Migrations

**Nenhuma migration foi necessária** (seção 39) — o setting reaproveita
a tabela `settings` já existente (mesmo padrão do kill switch de
autonomia v1.3), nenhuma tabela
`agent_operational_supervision_settings` foi criada.

## 22. Arquivos criados

Backend:
```
backend/src/agents/operations/scheduler-settings.ts
backend/src/agents/operations/scheduler-settings.test.ts
backend/src/agents/operations/supervisor-guard.ts
backend/src/agents/operations/supervisor-guard.test.ts
backend/src/agents/operations/scheduler.ts
backend/src/agents/operations/scheduler.test.ts
backend/src/agents/operations/scheduler-status.ts
backend/src/agents/operations/scheduler-status.test.ts
backend/src/routes/agents/operations-scheduler.test.ts
```

Frontend:
```
frontend/app/api/agents/operations/scheduler/route.ts
frontend/components/agents/operations/operational-supervision-scheduler-card.tsx
```

## 23. Arquivos alterados

```
backend/src/agents/operations/schemas.ts          (+patchSupervisionSchedulerSchema)
backend/src/agents/operations/supervisor-service.ts (+triggeredBy no contrato e na auditoria)
backend/src/config/env.ts                          (+AGENT_OPERATIONAL_SUPERVISION_ENABLED, +AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS)
backend/src/routes/agents/operations.ts             (+GET/PATCH /scheduler; POST /supervise agora usa o guard central)
backend/src/server.ts                                (+start/stopOperationalSupervisionScheduler no boot/shutdown)
frontend/app/(dashboard)/agents/operations/page.tsx (+OperationalSupervisionSchedulerCard)
frontend/hooks/agents/use-operations-supervisor.ts  (+useOperationalSupervisionSchedulerStatus, +useSetOperationalSupervisionSchedulerEnabled)
frontend/lib/agents/derived.ts                       (+schedulerLastResultLabel)
frontend/lib/agents/derived.test.ts                 (+2 testes)
frontend/lib/query/keys.ts                           (+operationalSupervisionScheduler)
frontend/services/agents.ts                          (+getOperationalSupervisionSchedulerStatus, +setOperationalSupervisionSchedulerEnabled)
frontend/types/agents.ts                             (+OperationalSupervisionSchedulerStatus, +SchedulerLastResult)
```

## 24. Testes adicionados

- `scheduler-settings.test.ts` (novo) — **3 testes**: itens 18/19/21
  (default seguro, round-trip persistido, nunca insere segunda linha).
- `supervisor-guard.test.ts` (novo) — **5 testes**: itens 5/6/7/9/11/
  12/13/14 (guard livre após sucesso/erro, chamada normal após falha
  anterior, duas chamadas concorrentes só uma executa, `running`
  reflete estado real).
- `scheduler.test.ts` (novo) — **12 testes**: itens 1/2/3/4/5/8/9/20/28
  (comportamento por tick) + itens 30-35 (lifecycle: start/stop
  idempotentes, `nextRunAt` coerente).
- `scheduler-status.test.ts` (novo) — **5 testes**: itens 24-30
  (observabilidade real, não simulada — usa `runOperationalSupervision`
  de verdade para provar que os timestamps derivados de audit log
  refletem a execução real).
- `routes/agents/operations-scheduler.test.ts` (novo) — **7 testes**:
  itens 22/23 (permissions), validação de body (`.strict()`, tipo
  errado), e item 11 (409 real via HTTP em concorrência manual×manual,
  mesmo guard do scheduler).

Total: **32 testes novos no backend**. Nenhum teste novo de frontend
além dos 2 de label — mesma justificativa das entregas anteriores.

## 25. Testes de concorrência

Itens 11-14 (seção 33) cobertos em `supervisor-guard.test.ts` (nível de
serviço, com `runner` injetado e delay controlado) e item 11 também
via HTTP real em `routes/agents/operations-scheduler.test.ts`
(`Promise.all` de duas chamadas `POST /supervise` → exatamente uma 200
e uma 409). Itens 15-17 (lock distribuído) **não aplicáveis** — seção
33: "executar somente os testes correspondentes à arquitetura realmente
implementada" — não há lock distribuído nesta versão (ver item 11 acima).

## 26. Testes de lifecycle

Itens 31-35 (seção 36) cobertos em `scheduler.test.ts`: `start()`
idempotente (chamar duas vezes não recria o timer — mesmo
`nextRunAt`), `stop()` limpa o timer e é seguro chamado repetidamente,
estado `inactive` correto quando nunca iniciado/já parado. Shutdown
real (SIGTERM matando o processo) não foi testado via `node:test` (exigiria
subprocesso real) — a garantia vem de `stopOperationalSupervisionScheduler()`
ser chamada de dentro do MESMO `shutdown()` já testado implicitamente
pela suíte de integração existente (nenhum handler novo, nenhuma
lógica nova de sinal).

## 27. Números exatos backend (medidos pelo runner real)

**Baseline após v2.5**: `567 testes / 567 pass / 0 fail`.

**Suíte completa após a v2.5.1** (`npx tsx --test --test-concurrency=1
'src/**/*.test.ts'`, via Docker):

```
ℹ tests 599
ℹ suites 107
ℹ pass 599
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**Reconciliação:** 567 → 599 = **+32 testes líquidos**, batendo
exatamente com a soma por arquivo (3+5+12+5+7=32). Nenhuma regressão —
todos os 567 testes anteriores continuam passando.

## 28. Números exatos frontend (medidos pelo runner real)

`npx tsx --test 'lib/**/*.test.ts'`:

```
ℹ tests 94
ℹ suites 36
ℹ pass 94
ℹ fail 0
```

Baseline anterior 92/92 → 94/94 = **+2 testes líquidos**
(`schedulerLastResultLabel`). Nenhuma regressão.

## 29. Typecheck/build

- Backend typecheck (`npx tsc --noEmit`, via Docker): **OK, sem erros.**
- Frontend typecheck (`npx tsc --noEmit`): **OK, sem erros.**
- Frontend build (`npm run build`): **OK** — rota
  `/api/agents/operations/scheduler` presente na saída.
- Lint: continua sem script/config configurado — reconfirmado.

## 30. `git diff --stat`

```
 backend/src/agents/operations/schemas.ts           |  6 +++
 .../src/agents/operations/supervisor-service.ts    | 24 +++++++--
 backend/src/config/env.ts                          | 29 +++++++++++
 backend/src/routes/agents/operations.ts            | 58 ++++++++++++++++++++--
 backend/src/server.ts                              | 14 ++++++
 .../app/(dashboard)/agents/operations/page.tsx     |  3 ++
 frontend/hooks/agents/use-operations-supervisor.ts | 28 ++++++++++-
 frontend/lib/agents/derived.test.ts                | 15 ++++++
 frontend/lib/agents/derived.ts                     | 12 +++++
 frontend/lib/query/keys.ts                         |  1 +
 frontend/services/agents.ts                        | 10 ++++
 frontend/types/agents.ts                            | 16 ++++++
 12 files changed, 208 insertions(+), 8 deletions(-)
```

Novos arquivos (sem histórico prévio, fora do `diff --stat`):
```
backend/src/agents/operations/scheduler-settings.ts
backend/src/agents/operations/scheduler-settings.test.ts
backend/src/agents/operations/supervisor-guard.ts
backend/src/agents/operations/supervisor-guard.test.ts
backend/src/agents/operations/scheduler.ts
backend/src/agents/operations/scheduler.test.ts
backend/src/agents/operations/scheduler-status.ts
backend/src/agents/operations/scheduler-status.test.ts
backend/src/routes/agents/operations-scheduler.test.ts
frontend/app/api/agents/operations/scheduler/route.ts
frontend/components/agents/operations/operational-supervision-scheduler-card.tsx
```

## 31. `git status`

```
 M backend/src/agents/operations/schemas.ts
 M backend/src/agents/operations/supervisor-service.ts
 M backend/src/config/env.ts
 M backend/src/routes/agents/operations.ts
 M backend/src/server.ts
 M correio.md
 M executed.md
 M frontend/app/(dashboard)/agents/operations/page.tsx
 M frontend/hooks/agents/use-operations-supervisor.ts
 M frontend/lib/agents/derived.test.ts
 M frontend/lib/agents/derived.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
?? backend/src/agents/operations/scheduler-settings.test.ts
?? backend/src/agents/operations/scheduler-settings.ts
?? backend/src/agents/operations/scheduler-status.test.ts
?? backend/src/agents/operations/scheduler-status.ts
?? backend/src/agents/operations/scheduler.test.ts
?? backend/src/agents/operations/scheduler.ts
?? backend/src/agents/operations/supervisor-guard.test.ts
?? backend/src/agents/operations/supervisor-guard.ts
?? backend/src/routes/agents/operations-scheduler.test.ts
?? frontend/app/api/agents/operations/scheduler/
?? frontend/components/agents/operations/operational-supervision-scheduler-card.tsx
```

## 32. Bugs encontrados

1. **Bug no meu PRIMEIRO teste de `scheduler-status.test.ts`, corrigido
   antes do relatório final:** o teste "26/27/29" injetava um `runner`
   fake em `runScheduledOperationalSupervision(runner)` para medir
   `lastStartedAt`/`lastCompletedAt` — mas esses timestamps são
   derivados dos eventos `agents.operations.scan.started`/`.scan.completed`,
   emitidos DENTRO da função REAL `runOperationalSupervision` (nunca
   pelo guard/scheduler) — injetar um runner fake SUBSTITUI essa função
   inteira, então nenhum desses eventos era emitido pelo teste, e a
   asserção acabava lendo uma auditoria STALE de uma execução de teste
   anterior (de outro arquivo, minutos antes) presente na mesma janela
   de "20 mais recentes" da query. Corrigido usando a
   `runOperationalSupervision` REAL (sem override) nesse teste
   específico — os demais testes que precisam de um runner controlado
   (falha simulada, delay) continuam injetando, corretamente, porque
   testam um comportamento que NÃO depende dos audits internos da
   função real. Bug de teste, nunca chegou a existir em código de
   produção.

## 33. Limitações reais

1. **Guard local, não distribuído** (item 11 acima) — documentado,
   aceitável para a única instância real hoje.
2. **`lastDurationMs`/`lastResult` são best-effort** (item 17 acima) —
   correlacionados por ordem temporal dos audit logs, não por um ID de
   execução compartilhado. Nunca produz um valor SILENCIOSAMENTE errado
   de forma perigosa (na pior hipótese, mostra `null`/um valor levemente
   impreciso numa tela de observabilidade), mas não é uma garantia
   transacional.
3. **`intervalSeconds` não é editável em runtime** (item 7 acima) —
   decisão deliberada, documentada, para não adicionar complexidade sem
   necessidade comprovada (seção 26).
4. **Nenhum teste real de "restart não duplica timers"** com um
   processo Node de verdade reiniciando — a garantia é estrutural
   (estado 100% em memória, module-level `let`, zerado a cada novo
   processo) mas não há um teste de integração que suba/derrube o
   processo real (fora do escopo prático de `node:test` para este
   projeto).

## 34. Débitos técnicos identificados

1. **`agents.operations.scan.started`/`.scan.completed` agora carregam
   `triggeredBy`, mas nenhuma tela de auditoria filtra/destaca por essa
   dimensão ainda** — o dado está disponível (útil para responder "essa
   supervisão foi manual ou automática?"), mas a UI de audit logs
   genérica do projeto não foi estendida para exibi-lo de forma
   destacada. Não bloqueante — o dado está lá, consultável.
2. **`scheduler-status.ts` faz uma query de até 20 linhas de audit log
   a cada `GET /operations/scheduler`** — barato no volume atual, mas
   se o número de scans por dia crescer MUITO (não é o caso hoje, dado
   o intervalo mínimo de 60s e o baixo custo de cada tick), valeria
   revisitar (ex.: índice dedicado por `action`, ou cache de curta
   duração).

---

## Conclusão

Todos os 12 critérios bloqueantes da seção 40 do correio.md foram
atendidos: nenhum segundo scheduler (terceira instância do MESMO
padrão, documentado); supervisão nunca implementada como `AgentJob`;
execuções concorrentes protegidas (guard central, testado); erro do
supervisor nunca para o scheduler (testado); ativação automática nunca
silenciosa por default (dois níveis, ambos `false`); supervisor
automático nunca aumenta autonomia (mesma Response Policy da v2.5,
inalterada); scheduler nunca altera workflows diretamente (só dispara
`runOperationalSupervision`); política idêntica entre manual/automática
(mesma função, só `triggeredBy` difere); nenhum timer duplicado após
restart/start repetido (testado); permissões sempre no backend
(`requirePermission`, nunca só frontend); lock nunca fica preso após
exceção normal (testado exaustivamente); suíte completa permanece
verde (599/599, nenhuma regressão dos 567 anteriores).

**NENHUM COMMIT foi realizado.** Todas as alterações permanecem no
working tree, aguardando autorização final do Diretor/CEO.
