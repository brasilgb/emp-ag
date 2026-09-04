# Agentes v3.3 — Fechamento do lifecycle do advisory lock

A v3.3 está arquiteturalmente aprovada, restando **um único bloqueio antes do commit**.

## Objetivo desta rodada

Corrigir exclusivamente o lifecycle excepcional da conexão PostgreSQL usada pelo `runGuardedOperationalSupervision`.

Hoje, se `pg_advisory_unlock(...)` falhar, existe o risco de a `PoolClient` retornar normalmente ao pool ainda mantendo o advisory lock de sessão.

Isso não deve permanecer como limitação aceita, porque pode gerar um bloqueio falso e potencialmente indefinido do Operational Supervisor.

## Correção obrigatória

No `finally` de `runGuardedOperationalSupervision`:

1. tentar liberar normalmente o advisory lock usando a mesma conexão dedicada;
2. se `pg_advisory_unlock` funcionar:

   * liberar a `PoolClient` normalmente para o pool;
3. se o unlock lançar exceção ou não puder ser considerado concluído com segurança:

   * registrar explicitamente a falha;
   * **não devolver essa conexão como saudável ao pool**;
   * destruir/descartar a conexão usando o mecanismo oficialmente suportado pela biblioteca `pg`/PoolClient utilizada pelo projeto.

A destruição da sessão PostgreSQL deve servir apenas como fallback de segurança do lifecycle da conexão. Não criar watchdog, lock alternativo, Redis, Redlock, leader election, tabela de locks ou qualquer outro mecanismo paralelo.

## Regra de precedência de erros

Preservar o comportamento correto:

* se o `runner` terminou com sucesso e o unlock falhar:

  * registrar/tratar a falha de infraestrutura de forma explícita;
* se o `runner` já lançou uma exceção estrutural e o unlock também falhar:

  * a exceção original do `runner` deve continuar sendo a exceção principal propagada;
  * a falha de unlock deve ser registrada, sem mascarar a causa original.

Não transformar falha de unlock em `SupervisionAlreadyRunningError`.

`SupervisionAlreadyRunningError` continua significando exclusivamente:

```text
pg_try_advisory_lock(...) retornou false
```

## Atenção à semântica do PostgreSQL

O lock usado é de sessão.

Portanto:

```text
advisory lock adquirido
        ↓
runner
        ↓
pg_advisory_unlock
        ├── sucesso → client.release() normal
        └── falha   → destruir/descartar sessão/conexão
                       ↓
                 PostgreSQL remove os locks
                 pertencentes à sessão encerrada
```

Não trocar para transaction advisory lock nesta rodada.

Não alterar a chave:

`OPERATIONAL_SUPERVISION_LOCK_KEY = 7412583900n`

Não criar nova migration.

## Testes obrigatórios

Adicionar/ajustar testes em `supervisor-guard.test.ts` cobrindo pelo menos:

### 1. Unlock normal

* lock é adquirido;
* runner executa;
* unlock acontece;
* conexão volta normalmente ao pool;
* outra sessão consegue adquirir a mesma chave.

### 2. Falha no unlock

Forçar especificamente falha em `pg_advisory_unlock`.

Confirmar que:

* a conexão problemática não é devolvida ao pool como conexão reutilizável saudável;
* ela é destruída/descartada;
* o lock não permanece causando bloqueio operacional;
* uma nova sessão PostgreSQL consegue posteriormente adquirir o mesmo advisory lock.

### 3. Runner falha + unlock falha

Forçar:

```text
runner → lança erro estrutural A
unlock → falha com erro B
```

Confirmar:

* erro A continua sendo propagado;
* erro B é registrado;
* erro B não substitui erro A;
* conexão problemática é descartada.

### 4. Falha de infraestrutura ao adquirir

Preservar o teste já existente:

* erro ao tentar `pg_try_advisory_lock` continua sendo erro estrutural;
* nunca vira `SupervisionAlreadyRunningError`.

### 5. Concorrência distribuída

Preservar a prova com duas sessões PostgreSQL realmente distintas:

```text
A adquire
B falha
A libera
B adquire
```

Continuar validando `pg_backend_pid()` distintos.

## Escopo proibido

Nesta rodada, não alterar:

* `scheduler.ts`;
* `routes/agents/operations.ts`;
* `supervisor-service.ts`;
* Control Center;
* escalation;
* follow-ups;
* Planner;
* Policy Evaluator;
* Executor;
* Approval Workflow;
* Proposal;
* Action Plan;
* permissions;
* frontend;
* migrations;
* Docker/deploy.

Não criar segundo Supervisor.

Não criar segundo scheduler.

Não criar mecanismo de eleição de líder.

Não usar Redis para lock.

Não reescrever a arquitetura da v3.3.

## Guard local

Preservar o `running` local somente como fast-path.

A fonte real de exclusão distribuída continua sendo o PostgreSQL advisory lock.

Não transformar a flag local em mecanismo independente.

## Validação final

Depois da correção, executar:

* testes específicos de `supervisor-guard`;
* suíte backend completa com a configuração oficial do projeto;
* frontend tests, mesmo sem alterações;
* backend typecheck;
* frontend typecheck;
* frontend lint;
* backend build;
* frontend build.

Reconciliar exatamente a quantidade final de testes.

Também executar `git diff --stat` e `git status`.

## Relatório de retorno

Responder com:

1. causa exata do problema;
2. mecanismo usado para descartar a conexão;
3. comportamento quando unlock funciona;
4. comportamento quando unlock falha;
5. precedência de erro runner × unlock;
6. resultado dos testes novos;
7. prova de que uma sessão nova consegue adquirir o lock após descarte da sessão problemática;
8. números completos das suítes;
9. typecheck/lint/build;
10. arquivos alterados;
11. migrations;
12. permissions;
13. alterações de frontend;
14. bugs encontrados;
15. limitações reais restantes;
16. débitos técnicos;
17. `git diff --stat`;
18. `git status`;
19. estado dos containers;
20. confirmação de que **nenhum commit foi realizado**.

## Gate

**Não fazer commit.**

Após essa correção e a suíte completa verde, a entrega volta para revisão final do Diretor/CEO.

O objetivo é encerrar definitivamente a v3.3, não abrir uma v3.4 dentro desta rodada.
