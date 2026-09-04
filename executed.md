## Agentes v3.3.1 — Fechamento do lifecycle do advisory lock

### 1. Causa exata do problema

Em `runGuardedOperationalSupervision` (v3.3), se `pg_advisory_unlock`
falhasse, o `catch` só logava o erro e caía num `finally` que chamava
`client.release()` SEM argumento — devolvendo ao pool uma conexão que
podia ainda estar segurando o lock de sessão de verdade no Postgres.
Como o pool REUSA conexões (nunca fecha entre usos), essa conexão
"contaminada" voltaria a circular, potencialmente segurando o lock para
sempre — um bloqueio falso e indefinido do Operational Supervisor
inteiro, mesmo com o sistema aparentemente saudável.

### 2. Mecanismo usado para descartar a conexão

`client.release(unlockError)` — a assinatura oficial do driver `pg`
(`release(err?: Error | boolean)`): passar um valor truthy instrui o
`Pool` a DESTRUIR a conexão em vez de devolvê-la ao pool. O Postgres
então libera todos os locks de sessão pertencentes àquela conexão como
consequência direta do encerramento — a mesma propriedade que já estava
documentada como "rede de segurança teórica" na v3.3 passa a ser, aqui,
o mecanismo de recuperação ativo. Nenhum watchdog, lock alternativo,
Redis, tabela de locks ou mecanismo paralelo foi criado.

### 3. Comportamento quando unlock funciona

Inalterado: `client.release()` normal, sem argumento — a conexão volta
ao pool como saudável e reutilizável.

### 4. Comportamento quando unlock falha

`console.error` explícito (nunca um catch silencioso) registrando que a
conexão será descartada, seguido de `client.release(unlockError)`. O
`running` local já foi liberado antes desse bloco (sempre, independente
do resultado do unlock) — o guard local nunca fica preso mesmo que o
Postgres-level cleanup dependa do descarte da conexão.

### 5. Precedência de erro runner × unlock

Preservada pela semântica nativa de `try/finally` do JavaScript: o
`catch` do unlock nunca relança `unlockError` (só registra + descarta a
conexão) — então o `finally` inteiro completa sem lançar, e a exceção
ORIGINAL do `runner` (se houver) continua sendo a que se propaga.
Provado por teste dedicado (item 6 abaixo).

### 6. Resultado dos testes novos

`supervisor-guard.test.ts`: 2 testes novos (10→12), usando um gancho
SOMENTE de teste (`setForcedUnlockFailureForTests`, mesmo padrão já
usado em outros módulos desta sessão) para forçar `pg_advisory_unlock` a
falhar deterministicamente, sem depender de infraestrutura real
quebrando:

- **"2 (v3.3.1)"**: unlock forçado a falhar → runner executou
  normalmente (resultado correto devolvido) → uma sessão PostgreSQL
  totalmente NOVA consegue adquirir o mesmo lock logo em seguida
  (prova real de que a conexão problemática foi descartada, não só a
  flag local liberada).
- **"3 (v3.3.1)"**: runner lança erro A **e** unlock falha com erro B →
  confirmado que A (nunca B) é o erro que propaga para o chamador, e
  mesmo assim uma sessão nova consegue adquirir o lock depois (conexão
  descartada independente de qual dos dois falhou).

Os 3 testes preexistentes que cobriam os itens 1/4/5 da lista mínima
(unlock normal, falha de infraestrutura ao adquirir, concorrência
cross-process com `pg_backend_pid()` distintos) foram preservados sem
alteração de comportamento — só renumerados/comentados para refletir o
mapeamento explícito com a lista do correio.md desta rodada.

### 7. Prova de que uma sessão nova adquire o lock após o descarte

Função auxiliar `lockIsFreeRightNow()` (já existente, reaproveitada):
abre uma `PoolClient` nova via `database.connect()`, tenta
`pg_try_advisory_lock` na mesma chave de produção
(`OPERATIONAL_SUPERVISION_LOCK_KEY`), e libera se conseguir. Usada nos 2
testes novos como a prova funcional decisiva — se a conexão problemática
tivesse voltado "saudável" ao pool, essa tentativa encontraria
`acquired: false`; como ela foi descartada, encontra `true`
imediatamente.

### 8. Números completos das suítes

```
Backend:  tests 728 / pass 728 / fail 0 / suites 123
Frontend: tests 119 / pass 119 / fail 0 / suites 47
```

Reconciliação: 726 (baseline v3.3) + 2 (testes novos) = 728 — bate
exatamente. Frontend: 119 + 0 = 119 (nenhuma mudança de frontend, testado
mesmo assim conforme pedido).

### 9. Typecheck/lint/build

Backend typecheck: 0 erros. Frontend typecheck: 0 erros. Frontend lint:
0 erros. Backend: sem script de lint configurado (confirmado
novamente). Backend build: sucesso. Frontend build: sucesso.

### 10. Arquivos alterados

Só 2, ambos já esperados pelo escopo desta rodada:
`backend/src/agents/operations/supervisor-guard.ts` (a correção) e
`backend/src/agents/operations/supervisor-guard.test.ts` (+2 testes).
Nenhum arquivo criado. `scheduler.ts`, `routes/agents/operations.ts`,
`supervisor-service.ts`, Control Center, frontend, migrations,
Docker/deploy — todos intocados, conforme "Escopo proibido" do
correio.md.

### 11. Migrations

Zero — confirmado `git status backend/drizzle` sem alterações.

### 12. Permissions

Nenhuma alteração — `agents.operations.read`/`agents.operations.manage`
inalteradas (o arquivo tocado nem as referencia).

### 13. Alterações de frontend

Nenhuma.

### 14. Bugs encontrados

O próprio bug que esta rodada corrigiu (item 1) — já era uma limitação
CONHECIDA e documentada explicitamente no relatório da v3.3 (seção 23,
"Limitações reais"), não uma descoberta nova nesta rodada. Nenhum outro
bug encontrado.

### 15. Limitações reais restantes

- A conexão que detém o lock continua ocupada por toda a duração do
  scan (inalterado desde a v3.3) — aceitável, o pool tem múltiplas
  conexões.
- Se `pg_advisory_unlock` falhar E o `client.release(unlockError)`
  subsequente TAMBÉM falhar de alguma forma não prevista (cenário
  extremamente raro, não coberto por teste — o driver `pg` não expõe uma
  forma documentada de `release()` falhar), o comportamento não foi
  formalmente especificado; dado que `release()` no driver `pg` é
  síncrono e não lança em uso normal, este é um risco teórico, não uma
  lacuna prática identificada.

### 16. Débitos técnicos

Nenhum novo.

### 17. `git diff --stat`

```
 backend/src/agents/operations/supervisor-guard.ts       |  92 +++--
 backend/src/agents/operations/supervisor-guard.test.ts  |  42 ++--
 correio.md                                                | (reescrito pelo Diretor/CEO)
```

### 18. `git status`

```
 M backend/src/agents/operations/supervisor-guard.test.ts
 M backend/src/agents/operations/supervisor-guard.ts
 M correio.md
```

### 19. Estado dos containers

**Não alterado nesta rodada** — `Docker/deploy` estava explicitamente no
escopo proibido. Os containers atuais (`agencia-backend`/
`agencia-frontend`) continuam rodando a v3.3 original (sem este
fechamento do lifecycle do unlock) — o working tree contém a correção,
os containers ainda não.

### 20. Confirmação final

```
nenhum commit foi realizado
```

Confirmado por inspeção: nenhum segundo Supervisor/scheduler/mecanismo
de leader election/lock Redis foi criado; a chave do lock
(`OPERATIONAL_SUPERVISION_LOCK_KEY = 7412583900n`) não foi alterada;
nenhuma nova migration; a única mudança real é como o `finally` de
`runGuardedOperationalSupervision` decide devolver ou descartar UMA
`PoolClient` já existente — mesma função, mesma assinatura, mesmos dois
chamadores (scheduler e rota manual, nenhum dos dois tocado).

---

Aguardando aprovação do Diretor/CEO. Nenhum commit foi feito nesta rodada.
