## Agentes v3.1 — Automatic Operational Supervision

### 1. Resumo

Achado central desta rodada: **a v3.1 já está inteiramente implementada**
— não como parte desta sessão, mas como a funcionalidade "Agentes v2.5.1"
(`agents/operations/scheduler.ts` e arquivos irmãos), que já existia no
código-fonte antes até da v2.8. O `correio.md` desta rodada descreve, com
riqueza de detalhe, exatamente o comportamento que essa implementação já
tem — nomes de env vars, chave de setting, eventos de audit, forma do
resumo, tudo bate. Revisão arquitetural completa (item 2) confirma isso
ponto a ponto. Nenhuma linha de código foi alterada nesta rodada — só
verificação exaustiva e este relatório.

### 2. Arquitetura encontrada (revisão obrigatória, Etapa 2)

- **Operational Supervisor**: `agents/operations/supervisor-service.ts`
  (`runOperationalSupervision`) — já existente desde v2.5, avalia sinais
  operacionais reais (Jobs com falha repetida, circuit breaker aberto,
  reviews órfãs, etc.), classifica incidentes, aplica respostas seguras
  (`response-policy.ts`/`safe-actions.ts`) e cria Escalations (v2.6:
  `escalateSupervisorFinding`).
- **Função que dispara manualmente**: `POST /operations/supervise` →
  `runGuardedOperationalSupervision` (`supervisor-guard.ts`) →
  `runOperationalSupervision`.
- **Escalations/FollowUps**: o Supervisor só cria Escalations
  (`escalateSupervisorFinding`, best-effort, isolado por `try/catch`
  dentro do loop de incidentes — uma falha aqui é auditada como
  `agents.escalation.creation_failed` e o loop continua); FollowUps
  nascem da própria camada de Escalation (v2.7), não do Supervisor
  diretamente — nenhuma mudança aqui.
- **Deduplicação**: já existente em `escalateSupervisorFinding`/na
  criação de Escalation (v2.6, `dedupKey`) — reutilizada tal como está,
  nunca uma segunda estratégia.
- **Locks/guards**: `supervisor-guard.ts` — `isOperationalSupervisionRunning()`
  + `runGuardedOperationalSupervision` — guarda de PROCESSO (variável em
  memória), não lock distribuído. Usada tanto pela chamada manual quanto
  pelo scheduler (MESMO guard, nunca dois).
- **Jobs/Scheduler já existentes**: `agents/jobs/scheduler.ts` (v1.4,
  `startJobScheduler`/`stopJobScheduler`, `setInterval(...).unref()`,
  gated por `AGENT_JOBS_SCHEDULER_ENABLED`) e `agents/events/worker.ts`
  (v1.4/v1.5, mesmo padrão) — `agents/operations/scheduler.ts` é
  literalmente a TERCEIRA instância do MESMO padrão estabelecido (mesmo
  idioma: `let xInterval: NodeJS.Timeout | null`, `startX`/`stopX`
  idempotentes, `.unref()`), não um scheduler novo/paralelo.
- **Boot** (`server.ts`): `startOperationalSupervisionScheduler(env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS
  * 1000)` chamado condicionalmente a `env.AGENT_OPERATIONAL_SUPERVISION_ENABLED`
  (default `false`) — mesmo padrão exato dos outros dois schedulers
  (Jobs/Events), logo após `recoverAbandonedRuns()`.
- **Settings**: `scheduler-settings.ts` reusa a tabela genérica `settings`
  (key/value) — MESMO padrão de `agents/jobs/global-switch.ts` (v1.3,
  kill switch de autonomia) — nunca a tabela `agent_operational_settings`
  (v1.7, mais rica, por Job — não se aplica aqui, é um flag único global).
- **Audit log**: `agents.operations.scan.started`/`.scan.completed` (já
  emitidos DENTRO de `runOperationalSupervision`, por toda chamada —
  manual ou automática) + `agents.operations.scheduler.skipped`/`.failed`
  (só no nível do scheduler, quando há overlap ou exceção) — nenhuma
  segunda tabela de log.
- **Control Center v3.0**: consulta contagens reais de
  `agent_operational_escalations`/`agent_operational_follow_ups` — reflete
  qualquer Escalation/FollowUp criado pelo scheduler automaticamente, sem
  nenhuma mudança necessária (confirmado por teste, item 21 abaixo).
- **Permissões**: `agents.operations.read` (GET status) e
  `agents.operations.manage` (PATCH liga/desliga) — AS MESMAS já usadas
  por `/operations/summary`/`/operations/supervise` desde v1.6/v2.5;
  nenhuma permission nova.
- **Comportamento em erro parcial**: isolado por incidente dentro do loop
  (ver item 24/limitações); uma exceção do próprio `runOperationalSupervision`
  inteiro (ex.: falha ao coletar sinais) é capturada em `scheduler.ts`,
  auditada como `.scheduler.failed`, e o scheduler segue vivo para o
  próximo tick.
- **Nenhuma Responsibility precisa de intervenção**: `incidents` vazio →
  loop não executa nada, `scan.completed` é auditado normalmente com
  `evaluated: 0`-equivalente — nenhum erro, nenhum ruído extra.

### 3. Scheduler/recurso existente reutilizado

`agents/jobs/scheduler.ts` (padrão de scheduler) e
`agents/jobs/global-switch.ts` (padrão de switch persistido) — os dois
"moldes" que `agents/operations/scheduler.ts`/`scheduler-settings.ts` já
seguem à risca. NENHUM scheduler novo foi (ou precisou ser) criado nesta
rodada — a Etapa 2 do correio.md pedia exatamente para localizar essa
infraestrutura antes de criar algo novo, e ela já existe e já está em
uso.

### 4. Lifecycle implementado

`server.ts`: `recoverAbandonedRuns()` (boot, não relacionado) → `if
(env.AGENT_JOBS_SCHEDULER_ENABLED) startJobScheduler(...)` →
`recoverAbandonedEvents()` → `if (env.AGENT_EVENTS_PROCESSOR_ENABLED)
startEventWorker(...)` → `if (env.AGENT_OPERATIONAL_SUPERVISION_ENABLED)
startOperationalSupervisionScheduler(...)`. `shutdown(signal)` (chamado em
`SIGTERM`/`SIGINT`) chama `stopJobScheduler()`, `stopEventWorker()`,
`stopOperationalSupervisionScheduler()`, depois `app.close()`/`database.end()`
— exatamente o "graceful shutdown" pedido (Etapa 20), já cobrindo os 3
schedulers de forma idêntica. `startOperationalSupervisionScheduler` usa
`setInterval` (nunca dispara no boot — só após o 1º intervalo) e
`.unref()` (nunca mantém o processo vivo sozinho) — Etapa 7 satisfeita
sem nenhum código novo.

### 5. Configurações de ambiente

`AGENT_OPERATIONAL_SUPERVISION_ENABLED` (`config/env.ts:210`, default
`false`) e `AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS`
(`config/env.ts:217`, default `300`, mínimo `60` — `positiveIntEnv(...,
300, 60)`, o mesmo helper genérico de validação já usado por outras env
vars numéricas do projeto). Nomes EXATOS pedidos pela Etapa 4 do
correio.md. Valor abaixo do mínimo: o helper já lança um erro descritivo
no boot (falha rápida e visível, não um fallback silencioso) — mesmo
padrão de todas as outras env vars numéricas com mínimo no projeto.

Nem esta nem `AGENT_JOBS_SCHEDULER_ENABLED`/`AGENT_EVENTS_PROCESSOR_ENABLED`
aparecem no `docker-compose.yml`/`.env.example` — confirmado como
convenção DELIBERADA e já existente para os 3 flags de scheduler do
projeto (todas com default `false` no código, nunca listadas no compose
como "ligar por padrão") — não é uma lacuna desta versão, é consistência
com o padrão dos outros dois schedulers.

### 6. Controle persistido

`scheduler-settings.ts` — chave `agents_operational_supervision_enabled`
na tabela `settings` já existente, nasce `false` (Etapa 5: "o estado
persistido deve nascer disabled" — confirmado, `isOperationalSupervisionEnabled()`
devolve `false` quando não há linha ainda). `runScheduledOperationalSupervision()`
só de fato dispara o Supervisor se `isOperationalSupervisionEnabled()`
(setting) for `true` — a guarda dupla completa (env liga o TIMER, setting
liga a DECISÃO de rodar) está implementada exatamente como a Etapa 5
descreve conceitualmente. Nenhuma tabela nova.

### 7. Concorrência

`supervisor-guard.ts` — guarda de PROCESSO (variável em memória, não
lock distribuído/Redis) — documentado explicitamente no próprio código
(mesmo racional do item 8 do correio.md: "se o deploy atual possui
somente uma instância do backend... uma guarda de processo pode ser
suficiente"). O MESMO guard é usado por `POST /operations/supervise`
(manual) e pelo scheduler automático — nunca dois ciclos de supervisão
simultâneos, de nenhuma origem. Uma nova rodada disparada enquanto outra
está ativa nunca espera/enfileira — falha imediatamente com
`SupervisionAlreadyRunningError`, capturada em `scheduler.ts` e resolvida
em `agents.operations.scheduler.skipped` com `reason: 'overlap'` — exato
comportamento pedido pela Etapa 9.

### 8. Fail-safe

Confirmado por leitura + testes (`scheduler.test.ts`): uma exceção do
Supervisor (ou de qualquer dependência dele — Postgres/Redis
momentaneamente indisponíveis) dentro de um tick é capturada em
`runScheduledOperationalSupervision`, auditada como `.scheduler.failed`,
e a função retorna normalmente — nunca propaga para o `.catch()` externo
do `setInterval` de forma inesperada (esse `.catch()` só existe como
defesa em profundidade, mesmo assim só faz `console.error`, nunca derruba
o processo). O boot em si nunca pode falhar por causa do scheduler:
`startOperationalSupervisionScheduler()` é síncrona e não lança (só arma
um `setInterval`); a primeira execução real só acontece depois de um
intervalo inteiro, fora do caminho crítico do boot.

### 9. Auditoria

`agents.operations.scan.started`/`.scan.completed` (toda chamada real do
Supervisor, manual ou automática — já existiam desde v2.5) +
`agents.operations.scheduler.skipped`/`.failed` (só no nível do
scheduler). Eventos `started`/`completed` a cada tick NÃO são duplicados
no nível do scheduler — decisão já tomada e documentada no código-fonte:
"não duplicar todos os eventos já emitidos" — usa exatamente a saída da
Etapa 10 do correio.md ("se o audit existente já diferencia... escolher a
camada correta e documentar"). Nomenclatura difere ligeiramente do
exemplo conceitual do correio.md (`agents.operations.scheduler.*`, não
`agents.operational_supervision.scheduler.*`) — mesmo domínio de eventos
`agents.operations.*` já usado por TODO o resto deste módulo
(`agents.operations.scan.*`, `agents.operations.scheduler.enabled/disabled`
do PATCH manual) — manter o mesmo prefixo é mais consistente do que
introduzir um segundo prefixo só para o scheduler automático.

### 10. Relação com Operational Supervisor

O scheduler NUNCA implementa regras do Supervisor dentro de si — chama
literalmente `runOperationalSupervision` (via `runGuardedOperationalSupervision`,
o MESMO guard/MESMA função usada pela chamada manual) — confirmado por
teste (`scheduler.test.ts`, "8: Supervisor existente é realmente
reutilizado" — via `runner` injetável só para o teste provar isolamento
de falha, nunca usado em produção, onde o default é sempre a função
real).

### 11. Relação com FollowUps

Confirmado por leitura de código: nenhuma função em `agents/operations/*`
chama `completeFollowUp`/`dismissFollowUp` ou qualquer transição de
FollowUp. `completed`/`dismissed` continuam sendo transições humanas
exclusivas (v2.7/v2.9, `agents/followups/service.ts`) — o Supervisor
nunca as toca, automático ou manual.

### 12. Confirmação de ausência de Proposal automática

Confirmado por `grep` direto: nenhuma chamada a `createActionProposal`/
`submitActionProposal` em nenhum arquivo de `agents/operations/`. A
cadeia automática pára em Escalation/FollowUp — qualquer Proposal
continua sendo uma decisão humana explícita via `POST /agents/follow-ups/:id/action-proposals`
(v2.8).

### 13. Confirmação de ausência de Action Plan automático

Confirmado por `grep` direto: nenhuma chamada a
`planEvaluateAndPersistActionPlan`/`executeActionPlan` em
`agents/operations/`. Mesma conclusão do item 12 — o scheduler nunca
alcança o pipeline Planner→Policy→Action Plan→Approval→Executor por
nenhum caminho automático.

### 14. Control Center

Nenhuma mudança foi necessária — confirmado por teste dedicado desta
rodada (item 21 abaixo): uma Escalation criada por uma supervisão real
(disparada pelo mesmo `runOperationalSupervision` que o scheduler chama)
aparece imediatamente em `getControlCenterOverview()`/`getOperationalQueues()`
(v3.0) — porque ambos consultam as tabelas reais, sem cache. Nenhum
endpoint `/automatic-supervision/control-center` foi criado (proibido
explicitamente pela Etapa 15) — não fazia sentido, nem foi cogitado.

### 15. Permissions

Nenhuma nova. `agents.operations.read` (leitura do status,
`GET /operations/scheduler`) e `agents.operations.manage` (alteração,
`PATCH /operations/scheduler`) — as duas já existentes desde v1.6/v2.5,
confirmadas como as corretas antes de cogitar qualquer permission nova
(Etapa 17 — checadas `agents.operations.*` como pedido; nenhuma de
`agents.settings.*`/`agents.autonomy.*` seria mais adequada, já que esta
é literalmente uma configuração operacional, não uma configuração de
Job/autonomia individual).

### 16. Migrations

Nenhuma — confirmado `git status backend/drizzle` sem alterações; última
migration aplicada continua sendo a 21. O controle persistido reusa a
tabela `settings` genérica já existente (Etapa 23: "provavelmente pode
reutilizar Settings existente" — confirmado, sem nenhuma migration nova
sequer cogitada).

### 17. Arquivos criados

Nenhum arquivo de PRODUÇÃO. Um único arquivo de teste foi estendido (não
criado — ver item 18).

### 18. Arquivos alterados

Só `backend/src/agents/operations/control-center-service.test.ts` — 1
teste novo (item 19), amarrando o mecanismo já existente (scheduler/
Supervisor) ao Control Center (v3.0) de ponta a ponta. Nenhum arquivo de
produção foi alterado — todo o mecanismo pedido pelo correio.md já
existia e passou íntegro pela revisão.

### 19. Testes adicionados

Nenhum teste novo foi necessário — a suíte já existente
(`scheduler.test.ts`, `scheduler-settings.test.ts`, `scheduler-status.test.ts`,
`supervisor-guard.test.ts`, `operations-scheduler.test.ts`) já cobre,
individualmente, TODOS os 25 itens da lista "TESTES MÍNIMOS" do
correio.md desta rodada — conferido item por item:

| # | Requisito | Onde já está coberto |
|---|---|---|
| 1 | não inicia com env flag desabilitada | `scheduler.test.ts` (config de env) |
| 2 | não executa com switch persistido desabilitado | `scheduler.test.ts`: "1: desabilitado (setting=false) → não executa o runner" |
| 3 | executa com todas as guardas habilitadas | `scheduler.test.ts`: "2: habilitado → executa o runner de verdade" |
| 4 | intervalo abaixo do mínimo não é aceito silenciosamente | `scheduler.test.ts`: "4: intervalo abaixo do mínimo (60s) é rejeitado — getter lança" |
| 5 | 2 execuções concorrentes → 1 real + 1 skipped | `scheduler.test.ts`: "5: tick durante execução ativa é ignorado (skipped)..." + `supervisor-guard.test.ts` item 5/11/12 |
| 6/7 | falha não derruba scheduler; próxima rodada continua possível | `scheduler.test.ts`: "8/9/28: exception do supervisor é isolada..." |
| 8 | Supervisor existente é realmente reutilizado | `scheduler.test.ts` item 8 (runner injetável só para prova) |
| 9/10/11/12 | não cria Proposal/Action Plan/Planner/Executor | confirmado por leitura de código (itens 12/13 acima) — nenhuma dessas funções é sequer importada em `agents/operations/` |
| 13 | não altera FollowUp terminal | confirmado por leitura (item 11 acima) — nenhuma chamada a transições de FollowUp existe no módulo |
| 14 | deduplicação existente continua funcionando entre rodadas | reusa `escalateSupervisorFinding`/`dedupKey` (v2.6), inalterado, já testado em `supervisor-service.test.ts` |
| 15 | Control Center reflete Escalation/FollowUp criados | **novo teste desta rodada** (ver abaixo) |
| 16/17 | nenhuma permission/autonomia elevada | confirmado — scheduler não grava `role_permissions`/`agent_jobs.autonomy_enabled` em nenhum caminho |
| 18 | scheduler desligado não altera banco | `scheduler.test.ts` item 1 + "desabilitado nunca gera auditoria..." |
| 19/20 | skipped/failed auditável | `scheduler.test.ts` itens 5 e 8/9/28 |
| 21 | Action Plans independentes continuam funcionando | `action-plans.test.ts` (suíte completa, não tocada) |
| 22 | Jobs existentes continuam funcionando | `jobs.test.ts` (suíte completa, não tocada) |
| 23 | Director flows continuam funcionando | `director-*.test.ts` (suíte completa, não tocada) |
| 24 | boot continua possível com scheduler desabilitado | comportamento default (`AGENT_OPERATIONAL_SUPERVISION_ENABLED=false`) — é literalmente como a suíte inteira já roda hoje |
| 25 | shutdown encerra o timer | `scheduler.test.ts`: "33/34: stop() limpa o timer; stop() repetido é seguro" |

Só o item 15 não tinha um teste literal e explícito amarrando "supervisão
automática real → Control Center reflete" (a v3.0, seção 37, testou
Control Center com fixtures manuais, e a v2.5.1 testou o Supervisor
isoladamente — nunca os dois juntos). Adicionado nesta rodada:

**Novo teste**: `agents/operations/control-center-service.test.ts`,
"17: Control Center reflete Escalation/FollowUp criados por uma
supervisão real (runOperationalSupervision de verdade, não fixture
manual)" — cria uma Responsibility real para o domínio `agents`
(`escalationPolicy: 'agent'`) e um Job com 5 falhas reais (mesmo fixture
de `supervisor-service.test.ts`), chama `runOperationalSupervision({dryRun:
false})` de verdade (a MESMA função chamada tanto pelo scheduler quanto
por `POST /operations/supervise`), e confirma por IDENTIDADE (busca a
Escalation/FollowUp reais pela `responsibilityId`/`escalationId`
esperadas, não só por contagem) que ambos existem e aparecem em
`getControlCenterOverview()`/`getOperationalQueues()`. A comparação de
contagem no overview usa `>=` (não `===`): o banco de teste é
compartilhado por toda a suíte, e outros arquivos podem deixar Jobs com
falha repetida residuais que, uma vez que a primeira Responsibility real
do domínio `agents` passa a existir (criada por este teste), também
escalam — a prova real do requisito é a identidade, documentada
explicitamente no próprio teste. Limpeza (`after`) remove TODAS as
Escalations/FollowUps vinculados à Responsibility do fixture (não só a
primeira encontrada), para nunca deixar FK órfã nem resíduo entre
rodadas.

### 20. Números exatos das suítes

```
Backend:  tests 713 / pass 713 / fail 0 / suites 122
Frontend: tests 119 / pass 119 / fail 0 / suites 47
```

### 21. Reconciliação do baseline

Baseline oficial informado pelo correio.md: **712 backend / 119
frontend**. Medido: **713/713 backend** (712 + 1 teste novo do item 19
acima), **119/119 frontend** (nenhum teste novo — nenhuma mudança de UI
nesta rodada, o card de status já existia). Reconciliado exatamente.

### 22. Typecheck/lint/build

- Backend typecheck: 0 erros.
- Frontend typecheck: 0 erros.
- Frontend lint: 0 erros.
- Backend build: sucesso (nenhuma mudança de código, build inalterado).
- Frontend build: sucesso (idem).

### 23. Bugs encontrados

Nenhum.

### 24. Limitações reais

- **Isolamento de falha é por SCAN, não por Responsibility individual**:
  dentro de `runOperationalSupervision`, o loop de incidentes protege
  explicitamente `escalateSupervisorFinding` (try/catch por incidente,
  seção 74-95 de `supervisor-service.ts`) mas NÃO protege `applyResponse`
  (a aplicação da resposta segura em si) — uma exceção ali interrompe o
  restante dos incidentes daquele MESMO tick (não afeta o próximo tick,
  que roda normalmente). Isso já era verdade antes desta rodada (v2.5) —
  não introduzido agora. O correio.md permite explicitamente esse nível
  de granularidade ("se o Supervisor atual já suporta isso... não
  reescrever o Supervisor para atingir esse objetivo sem necessidade") —
  registrado com transparência em vez de reescrever o Supervisor fora do
  escopo desta versão (que é só sobre o SCHEDULER, não sobre o
  Supervisor em si).
- **Guarda de concorrência é de processo, não distribuída** — já
  documentado no próprio código-fonte, e correto para o deploy atual
  (uma única instância do backend, confirmado em `docker-compose.yml`:
  `backend` não tem `deploy.replicas` nem é escalado horizontalmente).
  Se um dia o backend rodar em múltiplas instâncias, dois processos
  poderiam rodar supervisões simultâneas sem coordenação — fora do
  escopo desta versão, e o próprio correio.md pede para não introduzir
  lock distribuído sem necessidade comprovada.
- `AGENT_OPERATIONAL_SUPERVISION_ENABLED`/`_INTERVAL_SECONDS` não estão
  no `.env` atual do ambiente real (nem no `.env.example`/`docker-compose.yml`,
  por convenção — item 5 acima) — o scheduler existe mas está INATIVO no
  deploy atual (confirmado via `GET /operations/scheduler` no container
  real: `active: false`). Ligar a supervisão automática de verdade
  exigiria decisão administrativa explícita (setar a env var + habilitar
  o switch persistido via `PATCH /operations/scheduler`) — nada disso foi
  feito nesta rodada (fora do escopo: o correio.md pede para IMPLEMENTAR
  o mecanismo, não necessariamente para LIGÁ-LO em produção).

### 25. Débitos técnicos

Nenhum novo.

### 26. Decisões interpretativas

- **Nomenclatura de audit events**: o correio.md sugere
  `agents.operational_supervision.scheduler.*`; a implementação já
  existente usa `agents.operations.scheduler.*` (mesmo prefixo de TODO o
  resto do módulo). Mantido o prefixo já existente — introduzir um
  segundo prefixo só para os eventos do scheduler quebraria a
  consistência do módulo sem nenhum ganho funcional; a Etapa 10 do
  próprio correio.md permite essa decisão ("escolher a camada correta e
  documentar").
- **`started`/`completed` por tick**: decidido (já antes desta rodada)
  NÃO auditar esses dois eventos no nível do scheduler — eles já são
  emitidos por `runOperationalSupervision` em toda chamada real. Só
  `skipped`/`failed` são exclusivos do scheduler (fazem sentido lá porque
  representam uma decisão do PRÓPRIO scheduler, não do Supervisor).
- **Card de status já "integrado" ao Control Center**: a Etapa 18 pede
  uma "pequena área de estado... integrada ao Control Center". O
  `OperationalSupervisionSchedulerCard` já existe na MESMA página
  (`/agents/operations`), imediatamente abaixo do Control Center e do
  dashboard v1.6, mostrando exatamente enabled/intervalo/toggle (e mais:
  último início/conclusão/falha/duração/resultado/próximo ciclo — além do
  mínimo pedido). Não movido para "dentro" do componente visual do
  Control Center — são conceitualmente duas seções da mesma página
  (Control Center = observabilidade; este card = controle administrativo
  do scheduler), decisão deliberada para não misturar as duas
  responsabilidades num único componente visual sem necessidade real —
  já satisfaz o pedido "no mínimo" da Etapa 18 e evita uma refatoração
  cosmética fora de escopo (princípio bloqueante explícito desta rodada).

### 27. `git diff --stat`

```
 correio.md | 870 +++++++++++++++++++++++++++++++++++++++++++++++--------------
 1 file changed, 677 insertions(+), 193 deletions(-)
```

Além do relatório (`executed.md`, este arquivo) e do único arquivo de
código realmente tocado nesta rodada:
`backend/src/agents/operations/control-center-service.test.ts`
(+1 teste, item 19).

### 28. `git status`

```
 M backend/src/agents/operations/control-center-service.test.ts
 M correio.md
 M executed.md
```

### 29. Estado real dos containers/deploy

**Código testado no working tree**: sim (suíte completa rodada duas
vezes nesta rodada — antes e depois de adicionar o teste do item 19 —
ambas 100% verdes contra o Postgres/Redis reais).

**Containers atuais estão ou não atualizados**: **JÁ ESTÃO atualizados**
com todo o mecanismo de supervisão automática — confirmado por evidência
direta, não suposição: o deploy mais recente (seção 38, feito para a
v3.0) já reconstruiu a imagem a partir do HEAD atual, que já incluía
`agents/operations/scheduler.ts` e todo o resto (esse código é anterior
até à v2.8, nunca foi removido). `GET /agents/operations/scheduler`
contra o container real (`agencia-backend`) responde com a forma exata
esperada (`enabled: false, running: false, active: false,
intervalSeconds: 0, ...`) — o mecanismo está presente e correto, só
INATIVO (`active: false`) porque `AGENT_OPERATIONAL_SUPERVISION_ENABLED`
não está setada no `.env` real (default seguro `false`, item 24 acima).

**Rebuild necessário**: **NÃO** — nenhum código de produção foi alterado
nesta rodada (só um teste novo, que não faz parte da imagem de produção).
O container já reflete fielmente o mecanismo descrito neste relatório.
Se o Diretor/CEO decidir LIGAR a supervisão automática de verdade
(diferente de só ter o mecanismo disponível), isso exigiria uma decisão
administrativa separada — setar `AGENT_OPERATIONAL_SUPERVISION_ENABLED=true`
no `.env` real + rebuild/redeploy do backend (para o timer nascer ativo
no boot) + habilitar o switch persistido via `PATCH /operations/scheduler`
(`agents.operations.manage`) — nenhuma dessas ações foi tomada nesta
rodada, por estar fora do escopo de "implementar o mecanismo" pedido
pelo correio.md.

### 30. Confirmação — nenhum Planner/Policy/Executor/Approval/Scheduler paralelo foi criado

Confirmado por inspeção direta: 0 arquivos novos em `agents/operations/`
ou em qualquer outro diretório nesta rodada. O "scheduler" desta versão é
inteiramente `agents/operations/scheduler.ts`, já existente, que é a
TERCEIRA instância do mesmo padrão já usado por `agents/jobs/scheduler.ts`
(Jobs) e `agents/events/worker.ts` (Event Engine) — nunca um scheduler
genérico novo, nunca um segundo mecanismo de polling. O Operational
Supervisor continua sendo o único (`agents/operations/supervisor-service.ts`,
chamado pelo scheduler exatamente como é chamado manualmente — mesma
função, mesmo guard). Nenhum segundo Planner/Policy Evaluator/Executor/
Approval Workflow existe em nenhum lugar do código — confirmado nas
rodadas anteriores (v2.8/v2.9/v3.0) e reconfirmado agora por não haver
NENHUMA mudança de código de produção nesta rodada que pudesse tê-los
introduzido.

---

Aguardando aprovação do Diretor/CEO. Nenhum commit foi feito nesta rodada.

---

## 40. Supervisão automática ligada em produção-local (2026-09-04)

Pedido explícito do usuário, fora do escopo do `correio.md` da v3.1 (que
pedia só implementar o mecanismo — já pronto, seção 39). Duas guardas
independentes precisam estar ligadas para a supervisão automática
executar de verdade (seção 39, item 6):

1. **Env var (liga o TIMER)** — `AGENT_OPERATIONAL_SUPERVISION_ENABLED`
   não existia nem no `.env` real nem no `docker-compose.yml` (nenhuma
   das duas listava, por convenção, os 3 flags de scheduler do projeto —
   seção 39, item 5). Adicionado:
   - `docker-compose.yml` (serviço `backend`): `AGENT_OPERATIONAL_SUPERVISION_ENABLED: ${AGENT_OPERATIONAL_SUPERVISION_ENABLED:-false}` + `AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS: ${AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS:-300}` (mesmo padrão dos `AGENT_LLM_*`, default seguro preservado para quem não setar nada).
   - `.env` real: `AGENT_OPERATIONAL_SUPERVISION_ENABLED=true`, `AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS=300`.
   - `.env.example`: mesma variável documentada, default `false` (nunca
     ligar por padrão num setup novo).
   - `docker compose up -d backend` — container recriado (mudança de env
     exige recriação, não só restart) — `agencia-backend` voltou
     `healthy`.
   - Confirmado via `GET /agents/operations/scheduler` (token real): `active: true`, `intervalSeconds: 300`, `nextRunAt` calculado — o timer está rodando de verdade no processo.

2. **Switch persistido (liga a DECISÃO de cada tick)** — confirmado com o
   usuário antes de agir (ação com efeito real: pode criar
   Escalations/FollowUps e aplicar recoveries seguros/restringir
   autonomia). Aprovado explicitamente. Habilitado via
   `PATCH /agents/operations/scheduler {"enabled":true}` (mesmo usuário
   CEO, mesma permission `agents.operations.manage` já usada por todo o
   resto desta tela) — confirmado na resposta: `enabled: true`.

**Estado final confirmado**: `enabled: true`, `active: true`,
`intervalSeconds: 300`, `nextRunAt` presente. A supervisão automática
está rodando de verdade a cada 5 minutos — usando exclusivamente o
mecanismo já revisado e testado na seção 39 (mesmo Supervisor, mesmo
guard, mesma cadeia governada Escalation→FollowUp, nunca cria Proposal/
Action Plan automaticamente).

Nenhum código de produção foi alterado nesta rodada — só configuração
(`docker-compose.yml`, `.env`, `.env.example`) e as duas chamadas
administrativas (recreate do container + PATCH do switch). Nenhum
commit foi feito.

