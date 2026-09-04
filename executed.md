## Agentes v3.3 — Distributed Operational Supervision Locking

### 1. Resumo

Implementada exclusão mútua distribuída de verdade para o Operational
Supervisor, via PostgreSQL advisory lock (`pg_try_advisory_lock`/
`pg_advisory_unlock`), substituindo a limitação explícita deixada pela
v3.2 ("guarda local ao processo, não distribuída"). Testado com duas
sessões PostgreSQL reais e distintas (não só duas Promises no mesmo
processo). 5 arquivos de produção/teste tocados (nenhum novo), suíte
completa 721→726 (100% verde), nenhum mecanismo paralelo criado.

### 2. Limitação anterior

`supervisor-guard.ts` (v2.5.1) usava só `let running = false` em memória
— suficiente para impedir duas chamadas concorrentes DENTRO do mesmo
processo Node (sem `await` entre check e set, sem corrida real ali), mas
cada instância de backend tem sua PRÓPRIA variável `running`. Duas
instâncias (dois containers, um deploy horizontal) rodando
`runOperationalSupervision` ao mesmo tempo não tinham NENHUMA
coordenação entre si — cada uma via `running=false` na sua própria
memória e prosseguia.

### 3. Estratégia adotada

PostgreSQL advisory lock — infraestrutura já obrigatória do projeto
(nenhum Redis/mecanismo novo), sem exigir migration (não é lock de
schema), com liberação automática garantida pelo Postgres se a conexão
morrer (rede de segurança, nunca o fluxo normal). Chave fixa e
documentada (`OPERATIONAL_SUPERVISION_LOCK_KEY = 7412583900n`, um bigint
constante, nunca aleatório/timestamp — trocar depois de implantada
quebraria a coordenação entre instâncias antigas/novas durante um
deploy).

### 4. Lifecycle da conexão

Ponto crítico do correio.md: advisory lock de sessão pertence à CONEXÃO,
não ao pool. `runGuardedOperationalSupervision` chama `database.connect()`
uma vez, reservando uma `PoolClient` DEDICADA; `pg_try_advisory_lock`
(aquisição), a execução do `runner`, e `pg_advisory_unlock` (liberação)
usam sempre essa MESMA `client` — nunca `database.query(...)` solto (que
pegaria uma conexão qualquer do pool a cada chamada e quebraria a
garantia). `client.release()` só devolve a conexão ao pool depois do
`unlock`.

### 5. Guard local

Preservado como fast-path (opção preferencial do correio.md) — nunca
como fonte de verdade paralela. `if (running) throw` evita o round-trip
ao Postgres no caso comum (chamada concorrente no MESMO processo);
`running` só vira `true` depois que o processo genuinamente detém o
lock, nunca antes/independentemente. Duas chamadas quase simultâneas
podem ambas passar pelo fast-path antes de qualquer uma setar
`running=true` (não há `await` ali ainda) — inofensivo: o advisory lock
decide de verdade quem executa; a perdedora dessa corrida recebe o mesmo
`SupervisionAlreadyRunningError`, só que via `acquired === false`.

### 6. Lock ocupado

`SupervisionAlreadyRunningError` — o MESMO contrato já existente desde a
v2.5.1 (nenhum contrato paralelo de "skipped"). `scheduler.ts` (skipped
+ audit) e a rota HTTP manual (409) continuam tratando esse erro
exatamente como antes — nenhuma mudança neles.

### 7. Falha de infraestrutura vs. lock ocupado

Separados explicitamente: uma exceção ao TENTAR `pg_try_advisory_lock`
(Postgres indisponível) libera a conexão e propaga o erro original —
nunca vira `SupervisionAlreadyRunningError`. `acquired === false` (lock
genuinamente ocupado) é o único caminho que gera
`SupervisionAlreadyRunningError`. Provado por teste (item 8 da lista
mínima): encerrar o pool antes de chamar o guard força uma falha real de
infraestrutura, e o teste confirma que o erro NÃO é
`SupervisionAlreadyRunningError`.

### 8. Release (`finally`)

`running=false` + `pg_advisory_unlock` + `client.release()` sempre
rodam, cobrindo sucesso, falha individual (v3.2, isolada dentro do
`runner`), falha estrutural do `runner`, e qualquer exceção inesperada.
Uma falha ao LIBERAR (`unlock`) é logada explicitamente (nunca um catch
silencioso — mesmo princípio já seguido pela v3.2) sem mascarar uma
exceção estrutural original do `runner`, que continua sendo a que
propaga.

### 9. Scheduler

Zero mudanças em `scheduler.ts` — continua chamando exatamente
`runGuardedOperationalSupervision`, nunca acessa o advisory lock
diretamente.

### 10. Manual

Zero mudanças em `routes/agents/operations.ts` — `POST
/operations/supervise` continua chamando a MESMA função. Nenhum branch
por origem (scheduler vs. manual) existe ou foi criado.

### 11. Testes cross-process (o cenário que motivou a v3.3)

`supervisor-guard.test.ts`, teste "20/21": duas `PoolClient`s reais
(`database.connect()` duas vezes), confirmadas como sessões PostgreSQL
DISTINTAS via `pg_backend_pid()` (`assert.notEqual`) — nunca duas
Promises no mesmo módulo/processo. Sequência provada literalmente:
conexão A adquire → conexão B falha → A libera → B adquire. Usa a MESMA
chave de produção (`OPERATIONAL_SUPERVISION_LOCK_KEY`, exportada só para
isto).

### 12. Interação com a v3.2

`runGuardedOperationalSupervision` trata `runner` como caixa-preta —
nunca inspeciona/altera o relatório. Teste dedicado confirma que o
`runner` PADRÃO real (`runOperationalSupervision`) é chamado sem
transformação através do guard distribuído, com o campo `failed` (v3.2)
intacto. O isolamento por incidente da v3.2 acontece inteiramente DENTRO
do `runner` — arquiteturalmente impossível do guard interferir, já que
ele só decide SE chama o runner, nunca COMO o runner se comporta
internamente.

### 13. Escalations/FollowUps

Nenhuma mudança de comportamento — confirmado por toda a suíte de
`supervisor-service.test.ts`/`control-center-service.test.ts`
continuando 100% verde (nada nelas foi alterado).

### 14. Proposal/Action Plan automáticos

Confirmado por `grep`: nenhuma chamada a `createActionProposal`/
`submitActionProposal`/`planEvaluateAndPersistActionPlan`/
`executeActionPlan`/Planner/Policy Evaluator/Executor/Approval Workflow
em `supervisor-guard.ts`. Nenhuma foi adicionada.

### 15. Permissions

Nenhuma nova — `agents.operations.read`/`agents.operations.manage`
inalteradas. O lock não é mecanismo de autorização (a chave é uma
constante fixa no código, nunca controlada por entrada do usuário).

### 16. Migrations

Zero — confirmado `git status backend/drizzle` sem alterações. Advisory
locks não exigem schema.

### 17. Arquivos criados/alterados

**Criados**: nenhum. **Alterados**: `backend/src/agents/operations/supervisor-guard.ts`
(a implementação do lock distribuído) e `backend/src/agents/operations/supervisor-guard.test.ts`
(reescrito, 5→10 testes). Nenhum outro arquivo de produção tocado — nem
`scheduler.ts`, nem `routes/agents/operations.ts`, nem frontend (o
correio.md pediu explicitamente "mudança frontend deve ser ZERO salvo
necessidade contratual real" — não houve).

### 18. Testes adicionados (10, substituindo os 5 anteriores)

Cobrem os 13 itens da lista mínima + a prova cross-process das seções
20/21: primeira execução adquire e executa; guard fica livre após
sucesso/falha; advisory lock (não só a flag local) confirmadamente
liberado no Postgres após sucesso e após falha estrutural (verificado
por uma segunda conexão real); concorrência (só uma executa, a outra
recebe o erro certo, nunca um erro genérico); falha de infraestrutura ao
adquirir propaga como erro estrutural (nunca `already_running`);
interação com a v3.2 preservada (runner padrão real, contrato intacto);
e o teste central de duas conexões PostgreSQL distintas.

**Achado durante os testes** (ambiente de teste, não bug de produção):
rodar múltiplos arquivos de teste que tocam o Operational Supervisor
(`scheduler.test.ts`, `supervisor-guard.test.ts`, `operations-scheduler.test.ts`,
`supervisor-service.test.ts`) em processos CONCORRENTES (sem
`--test-concurrency=1`) causa contenção real pelo MESMO advisory lock
global entre arquivos — exatamente a garantia que a v3.3 foi desenhada
para dar, agora também visível entre processos de teste, não só entre
instâncias de produção. A suíte completa deste projeto SEMPRE roda com
`--test-concurrency=1` (confirmado em todas as rodadas anteriores desta
sessão) — sob essa condição, 100% verde, sem nenhuma flakiness.
Registrado como comportamento esperado e documentado, não uma limitação
a corrigir.

### 19. Números exatos das suítes

```
Backend:  tests 726 / pass 726 / fail 0 / suites 123
Frontend: tests 119 / pass 119 / fail 0 / suites 47
```

### 20. Reconciliação do baseline

```
721 (baseline) + 5 (testes novos líquidos: 10 novos - 5 removidos) = 726 — bate exatamente
119 (baseline) + 0 (nenhuma mudança de frontend) = 119 — bate exatamente
```

### 21. Typecheck/lint/build

Backend typecheck: 0 erros. Frontend typecheck: 0 erros. Frontend lint:
0 erros. Backend: sem script de lint configurado (confirmado
novamente). Backend build: sucesso. Frontend build: sucesso.

### 22. Bugs encontrados

Nenhum de produção. Ver item 18 — achado foi de ambiente de teste
(concorrência entre processos de teste), não um bug.

### 23. Limitações reais

- A conexão que detém o lock fica ocupada por toda a duração do scan
  (não passa por `client.release()` até o `finally`) — consciente e
  aceitável (o pool tem múltiplas conexões; um scan não deveria durar
  o suficiente para esgotar o pool sozinho).
- Se o `unlock` falhar (Postgres cai bem nesse instante, depois de já
  ter aceitado o lock) e a conexão for devolvida ao pool sem liberar o
  lock, ele fica preso até o processo encerrar (o pool reusa conexões,
  nunca fecha entre usos) — cenário extremamente raro, já documentado no
  código, sem mecanismo de recuperação automática (fora do escopo desta
  versão, como o correio.md pediu explicitamente para não inventar).

### 24. Débitos técnicos

Nenhum novo.

### 25. Decisões interpretativas

- Guard local PRESERVADO (não racionalizado/removido) — opção
  preferencial explícita do correio.md, e evita um round-trip ao
  Postgres no caso comum (mesma-processo).
- Chave do lock: bigint constante único (`pg_try_advisory_lock(bigint)`),
  não o par de ints — mais simples, uma única constante para documentar
  e testar, sem necessidade real de duas chaves (só um consumidor lógico
  nesta versão).
- Falha ao liberar o lock: logada (`console.error`, mesmo padrão já
  usado pelo `.catch()` externo do scheduler) em vez de silenciosa —
  nunca um catch vazio, mesmo princípio já herdado da v3.2.

### 26/27. `git diff --stat` / `git status`

```
 backend/src/agents/operations/supervisor-guard.ts       | 114 ++++---
 backend/src/agents/operations/supervisor-guard.test.ts  | 140 +++++---
 correio.md                                               | (reescrito pelo Diretor/CEO)
```

```
 M backend/src/agents/operations/supervisor-guard.test.ts
 M backend/src/agents/operations/supervisor-guard.ts
 M correio.md
```

Arquivos funcionais: `supervisor-guard.ts` (1). Testes:
`supervisor-guard.test.ts` (1). Documentação/instrução operacional:
`correio.md` (reescrito pelo Diretor/CEO, não contabilizado como mudança
funcional da v3.3, conforme pedido).

### 28. Estado dos containers/deploy

**Working tree contém a v3.3. Os containers atuais (`agencia-backend`/
`agencia-frontend`) NÃO foram rebuildados nesta rodada — ainda rodam o
código de antes da v3.3** (a versão v3.2, já deployada). Nenhum
rebuild/deploy foi feito, conforme pedido explícito do correio.md desta
rodada.

### 29. Confirmação final

```
nenhum segundo Supervisor foi criado
nenhum segundo scheduler foi criado
nenhum mecanismo de leader election foi criado
nenhum lock Redis/Redlock foi criado
nenhum Proposal/Action Plan automático foi criado
nenhum commit foi realizado
```

Confirmado por inspeção direta: 0 arquivos novos; `scheduler.ts` e
`routes/agents/operations.ts` intocados; único arquivo de produção
alterado é `supervisor-guard.ts`, e sua única mudança real é substituir
`let running` puro por `let running` + `pg_try_advisory_lock`/
`pg_advisory_unlock` numa conexão dedicada — a mesma função, o mesmo
contrato, a mesma assinatura, os mesmos dois chamadores (scheduler e
rota manual), agora com exclusão mútua que também funciona entre
processos.

---

Aguardando aprovação do Diretor/CEO. Nenhum commit foi feito nesta rodada.
