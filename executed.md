# Saneamento final — Agentes v2.0

Relatório de saneamento apenas (correio.md: "NÃO redesenhar a versão e
NÃO adicionar novas funcionalidades" / "NÃO fazer commit. Aguardar
autorização final do Diretor/CEO"). Nenhuma arquitetura nova — só
correção de inconsistências no relatório anterior e nos 3 pontos reais
encontrados no código. Todos os números abaixo vêm diretamente do
runner desta execução, não estimados.

---

## 1. Causa de cada inconsistência

### 1.1 Números de teste incompatíveis

**Causa real**: o relatório da v2.0 somou errado. O total certo
(363 baseline + 40 novos = 403) até batia — mas o texto do resumo
afirmou "60 novos" (inventado, não confere com a própria enumeração do
relatório, que somava 47) e a enumeração detalhada também estava errada
(contava mal os testes de `director-goals.test.ts`/
`director-initiatives.test.ts`). Nenhum dos dois números batia com o
que o runner realmente produzia. Idêntico no frontend: "15 novos"
não tinha lastro — o número real medido é 7.

**Correção**: contei cada arquivo de teste isoladamente com o runner
antes de somar (nunca de cabeça), documentado na seção 3.

### 1.2 Migrations 0013/0014 ausentes do tracking

**Causa raiz**: não há nenhum mecanismo de auto-migrate no
`Dockerfile`/`docker-entrypoint`/`server.ts` deste projeto — `CMD
["node", "dist/server.js"]` apenas sobe o servidor, nada aplica
migration automaticamente. O único caminho oficial é `npm run
db:migrate` (`drizzle-kit migrate`), que sempre escreve na tabela de
tracking como parte da mesma transação. Como as tabelas de 0013/0014
existiam fisicamente mas a tabela de tracking não sabia disso, a
migration precisa ter sido aplicada por um caminho que ignora o
tracking. `drizzle-kit` desta versão inclui um comando `push` (visto em
`npx drizzle-kit --help`) que aplica diffs de schema diretamente, sem
tocar `__drizzle_migrations` — é a explicação mais plausível dado o que
existe no projeto (não presumo qual sessão anterior fez isso, mas é o
único mecanismo do próprio `drizzle-kit` capaz de produzir esse
sintoma). Não encontrei nenhum log/evidência que prove definitivamente
qual comando foi usado — a causa raiz fica documentada como "mais
provável, não certa", nunca inventada como certeza.

### 1.3 Descrição ambígua do bug do ON CONFLICT

**Causa real**: o relatório anterior descreveu o sintoma observado nos
testes (`0 !== 1`) sem nunca ter rodado o SQL real para ver o que de
fato acontecia no Postgres. A frase "não conflitava e também não
duplicava" era uma tentativa de descrever um comportamento que eu não
tinha, de fato, verificado — só inferido do resultado do teste. SQL e
comportamento reais, comprovados nesta sessão, estão na seção 5.

### 1.4 Semântica de `crm.clients_won` nunca verificada contra o domínio real

**Causa real**: o evaluator original (`clients.createdAt >=
goal.startDate`) foi escrito assumindo que todo `client` novo
representa uma venda fechada, sem checar o fluxo real de criação de
`clients` no módulo CRM. Investigação nesta sessão (seção 6) confirma
que **isso é falso**: `POST /crm/clients` cria clientes diretamente,
sem nenhum processo de venda.

### 1.5 Reincidência de recomendação nunca definida

**Causa real**: a v2.0 implementou dedup via `ON CONFLICT ... DO
NOTHING` sem pensar no caso de uma condição que se resolve e volta a
acontecer — a chave (`goal-health:<goalId>:<health>`) é permanente, e
`DO NOTHING` simplesmente nunca deixaria uma segunda recomendação
nascer, mesmo que a primeira já tivesse sido tratada/encerrada há muito
tempo. Comportamento nunca decidido conscientemente. Decisão e
implementação na seção 7.

---

## 2. Alterações realizadas

| Arquivo | Mudança |
|---|---|
| `backend/src/agents/director/goals/metrics/catalog.ts` | `crmClientsWon` agora conta só clientes com `leads.convertedClientId` apontando para eles (não todo `clients.createdAt >= startDate`) |
| `backend/src/agents/director/goals/review-service.ts` | `onConflictDoNothing` → `onConflictDoUpdate` com `targetWhere`/`setWhere` condicional — cria OU reabre a mesma linha, nunca duplica; novo campo `recommendationsReopened` no resumo |
| `backend/src/agents/director/goals/review-service.test.ts` | +3 testes de reincidência (reabertura de terminal, não-reescrita de aberta, concorrência na reabertura) |

Nenhum schema, endpoint, permission ou componente de frontend mudou.
Nenhuma funcionalidade nova — só correção de bug + correção de
semântica + decisão de comportamento pendente.

---

## 3. Resultado real dos testes

Contado isoladamente por arquivo com o runner (`node --test`), nunca
estimado.

### Backend

| Escopo | Testes |
|---|---|
| `agents/director/goals/health.test.ts` | 10 |
| `agents/director/goals/evaluation-engine.test.ts` | 10 |
| `agents/director/goals/review-service.test.ts` | 9 (era 6; +3 desta sessão) |
| `agents/director/goals/integration.test.ts` | 1 |
| `routes/agents/director-goals.test.ts` | 12 |
| `routes/agents/director-initiatives.test.ts` | 8 |
| (soma) — 6 arquivos, medida direta do runner | **43** |

```
Backend existente antes da v2.0 (baseline v1.9): 363
Backend adicionados pela v2.0 (medido direto):    43
Total real (suíte completa, --test-concurrency=1): 406
```

```
ℹ tests 406
ℹ suites 66
ℹ pass 406
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

363 + 43 = 406 — bate exatamente com o total medido pelo runner.

### Frontend

Escopo do módulo Agentes (`lib/agents/derived.test.ts`, onde vive toda
a lógica pura do frontend deste módulo):

```
Frontend (Agentes) existente antes da v2.0: 22
Frontend (Agentes) adicionados pela v2.0 (medido via grep no diff):  7
Total real do arquivo (medido pelo runner):  29
```

22 + 7 = 29 — bate. (O erro anterior foi escrever "15 novos" sem
contar; o valor real, contado com `awk`/grep no diff, é 7.)

Suíte completa do frontend (todos os módulos, não só Agentes) —
número adicional para contexto, nunca reportado antes:

```
ℹ tests 70
ℹ suites 22
ℹ pass 70
ℹ fail 0
```

### Validação final

```
backend typecheck:   limpo, 0 erros
backend tests:       406/406, 0 fail
frontend typecheck:  limpo, 0 erros
frontend tests:      29/29 (módulo Agentes) — 70/70 (suíte completa do frontend)
frontend build:      limpo, 0 erros
```

---

## 4. Validação das migrations

### Cenário A — banco limpo

Criado um Postgres 17 descartável (`saneamento-pg-test`, mesma imagem
`postgres:17.11-alpine` do projeto), banco vazio, e executado
**exclusivamente** `npm run db:migrate` (nada mais — sem seed, sem
push):

```
[✓] migrations applied successfully!
```

Resultado: 16 migrations aplicadas (0000–0015), 55 tabelas criadas, 5
delas `agent_director_*`. Cadeia completa confirmada de ponta a ponta
sem nenhuma intervenção manual.

### Cenário B — banco legado atual (reconciliado nesta sessão anterior)

Comparação direta, linha a linha, entre o banco limpo (cenário A) e o
banco de dev legado (`agencia`, já reconciliado manualmente na sessão
da v2.0):

* **Lista de tabelas**: `diff` entre os dois `\dt` — **idêntica** (exit 0).
* **Colunas das 4 tabelas novas** (`agent_director_goals`,
  `agent_director_goal_metrics`, `agent_director_goal_evaluations`,
  `agent_director_initiatives`): `diff` entre `\d <tabela>` dos dois
  bancos — **idêntica** nas 4 (exit 0).
* **Tabela de tracking** (`drizzle.__drizzle_migrations`): os 16 hashes
  SHA-256, na mesma ordem (`id` 1–16), com os mesmos `created_at` —
  **idênticos, byte a byte**, entre o banco migrado do zero e o banco
  legado reconciliado.

Isso prova que a reconciliação manual feita na sessão anterior (inserir
os hashes de 0013/0014 calculados a partir dos próprios arquivos
`.sql`) produziu **exatamente** o mesmo estado que `drizzle-kit
migrate` teria produzido num banco limpo — não é uma gambiarra que
"parece funcionar", é literalmente indistinguível do caminho oficial.

Banco de teste descartado ao final (`docker stop`, sem volume
persistente).

### Procedimento seguro de reconciliação (documentado para outro ambiente com o mesmo drift)

Só usar quando confirmado que a tabela física já existe mas a migration
correspondente não está em `drizzle.__drizzle_migrations` (nunca como
prática operacional padrão — é uma correção pontual de um estado já
quebrado):

1. Identificar quais migrations do `drizzle/meta/_journal.json` não
   têm linha correspondente em `drizzle.__drizzle_migrations`
   (comparar `count(*)` da tabela de tracking com o número de entradas
   do journal).
2. Para cada migration ausente, calcular o hash SHA-256 do arquivo
   `.sql` exato (mesmo algoritmo usado por `drizzle-kit`):
   `sha256(fs.readFileSync('drizzle/00XX_nome.sql', 'utf8'))`.
3. Inserir uma linha em `drizzle.__drizzle_migrations` com esse hash e
   o `when` (timestamp) da entrada correspondente no
   `meta/_journal.json` — nunca um timestamp inventado, sempre o do
   journal, para preservar a ordem histórica real.
4. **Nunca** rodar a migration novamente por cima da tabela já
   existente — a reconciliação é só a linha de tracking, a tabela
   física não é tocada.
5. Validar: rodar `drizzle-kit migrate` depois da reconciliação — deve
   aplicar **só** as migrations realmente pendentes (as posteriores à
   ausente), sem tentar recriar nada.
6. Cross-checar contra um banco migrado do zero (cenário A acima) —
   comparar lista de tabelas, colunas das tabelas envolvidas, e a
   própria tabela de tracking (hash/ordem/timestamp) linha a linha.
   Divergência em qualquer um desses três pontos = reconciliação
   incorreta, investigar antes de prosseguir.

Nenhuma migration destrutiva foi executada nesta sessão — só leitura,
uma migration nova de teste em banco descartável, e comparação.

---

## 5. SQL/comportamento do ON CONFLICT

Ambíguo no relatório anterior porque nunca tinha sido de fato
verificado. Agora, com o SQL exato e a execução real contra o Postgres
do banco de dev (dentro de uma transação `BEGIN`/`ROLLBACK`, nunca
persistido):

**Constraint responsável**: `agent_director_initiatives_recommendation_idx`
— índice único **parcial**: `UNIQUE (goal_id, recommendation_key) WHERE
recommendation_key IS NOT NULL`.

### SQL gerado ANTES da correção (`.toSQL()` do Drizzle, capturado nesta sessão)

```sql
insert into "agent_director_initiatives" (...)
values (...)
on conflict ("goal_id","recommendation_key") do nothing
```

**Comportamento real, comprovado por execução direta**: essa forma
**não tem nenhum arbiter válido**, porque o único índice único sobre
essas duas colunas é parcial e o `ON CONFLICT` não repete o predicado.
O Postgres recusa a inferência e a query **falha com erro real**:

```
ERROR:  there is no unique or exclusion constraint matching the ON CONFLICT specification
```

Isso — não "não conflitava e não duplicava" — é o comportamento
exato. O erro era capturado pelo `try/catch` de `reviewDirectorGoals()`
(desenhado para isolar falha por Goal, seção 5 do correio.md v2.0
original) e empurrado para `summary.errors`, nunca chegando a criar
nem a duplicar nada — só falhava silenciosamente a cada tentativa.

### SQL gerado DEPOIS da correção

```sql
insert into "agent_director_initiatives" (...)
values (...)
on conflict ("goal_id","recommendation_key")
  where "agent_director_initiatives"."recommendation_key" is not null
  do nothing
```

**Comportamento real, comprovado por execução direta**, 3 tentativas
sequenciais com a mesma chave:

```
Tentativa 1: INSERT 0 1   -- linha criada
Tentativa 2: INSERT 0 0   -- conflito detectado corretamente, sem erro
Tentativa 3: INSERT 0 0   -- idem
Linhas finais para a chave: 1
```

### Resultado do teste concorrente (mantido, agora sobre a versão corrigida com reopen)

`review-service.test.ts` — "concorrência: duas chamadas simultâneas
para o mesmo Goal critical não duplicam a recomendação" e
"concorrência: duas reincidências simultâneas sobre uma recomendação
terminal reabrem a MESMA linha, nunca duplicam" — ambos **passando**,
verificado nesta sessão (ver seção 3).

---

## 6. Decisão sobre `crm.clients_won`

**Investigação**: `POST /crm/clients` (`routes/crm/clients.ts`) cria um
`client` diretamente, sem nenhuma exigência de vir de um lead — é uma
rota livre, só protegida por `clients.create`. Em paralelo,
`POST /leads/:id/convert` (`routes/crm/leads.ts`) **sempre** cria um
`client` novo na mesma transação em que marca o lead como `won`
(`leads.convertedClientId = client.id`). Ou seja: o `clients.createdAt`
de um cliente vindo de conversão é exatamente o instante da venda
fechada — mas o `clients.createdAt` de um cliente cadastrado
diretamente **não representa venda nenhuma**.

**Prova concreta** (transação de teste, revertida ao final): 1 cliente
criado diretamente + 1 cliente criado via lead convertido, mesma janela
de tempo:

```
Contagem ANTIGA (clients.createdAt >= startDate, sem distinguir origem): 2
Contagem NOVA (só clientes com lead.convertedClientId apontando para eles): 1
```

**Decisão**: `crm.clients_won` **significava algo diferente de "won"**
no sentido comercial — corrigido o **evaluator** (não o nome da
métrica, que já era o certo depois da correção): agora conta só
`clients` que têm um `lead.convertedClientId` apontando para eles,
filtrado por `clients.createdAt >= goal.startDate`. Nenhuma
tabela/coluna nova — só um filtro adicional usando a FK
`leads.convertedClientId` que já existia. Descrição do catálogo
atualizada para deixar isso explícito para quem for configurar um Goal.

---

## 7. Regra de reincidência

**Decisão**: reutiliza a Initiative anterior (não cria uma nova a cada
reincidência) — mesmo princípio já usado no reopen de Decision Item na
v1.9 (`decisions/sync-service.ts`).

**Comportamento exato**, implementado via `INSERT ... ON CONFLICT ...
DO UPDATE ... WHERE <condição>` (create-or-reopen atômico, sem
find-then-insert desprotegido):

| Estado da Initiative existente com a mesma chave | O que acontece |
|---|---|
| Não existe nenhuma | Cria nova, `status='proposed'` |
| Existe e está **aberta** (`proposed`/`approved`/`active`/`blocked`) | Não faz nada — já está sendo acompanhada |
| Existe e está **terminal** (`completed`/`cancelled`) | **Reabre a mesma linha**: `status→proposed`, limpa `cancelledAt`/`cancellationReason`/`completedAt`/`actionPlanId`/`startedAt`, atualiza texto |

`at_risk → on_track → at_risk`: se a Initiative da primeira vez foi
concluída/cancelada antes da recuperação, a reincidência **reabre a
mesma linha**. Se ninguém tratou (ainda `proposed`/`approved`/`active`)
quando o Goal recuperou, a Initiative continua aberta sozinha — a
"recuperação" não a fecha automaticamente, e a reincidência não
duplica nem reescreve nada (ela já está sendo acompanhada).

**Sem escalation automática** — exatamente como pedido: nenhuma
prioridade sobe sozinha, nenhuma contagem de reincidências, só uma
linha por `(goal, health)` para sempre, controlada inteiramente pelo
estado real da própria Initiative.

**Testes cobrindo a regra** (3 novos, ver seção 3):

1. Reincidência sobre recomendação **terminal** (`cancelled`) → reabre
   a mesma linha (`id` idêntico), limpa campos de cancelamento,
   `recommendationsReopened=1`.
2. Reincidência sobre recomendação **ainda aberta** (`approved`) → não
   mexe em nada, status aprovado pelo usuário nunca é sobrescrito.
3. Concorrência: duas chamadas simultâneas reabrindo a mesma
   recomendação terminal → nunca duplicam, sempre a mesma linha.

---

## 8. git diff --stat

```
 backend/drizzle/meta/_journal.json                 |    7 +
 backend/src/agents/director/decisions/thresholds.ts|   13 +
 backend/src/agents/director/operational-signals.ts |   16 +-
 backend/src/agents/tools/director.ts               |   28 +
 backend/src/db/schema/index.ts                     |    6 +-
 backend/src/db/seed.ts                              |   31 +-
 backend/src/routes/agents/index.ts                  |    4 +
 correio.md                                          | 1041 ++------------------
 executed.md                                         |  651 ++++++------
 frontend/components/agents/director/director-dashboard.tsx |   15 +-
 frontend/components/agents/status-badge.tsx         |   57 ++
 frontend/lib/agents/derived.test.ts                 |   60 ++
 frontend/lib/agents/derived.ts                      |   74 ++
 frontend/lib/query/keys.ts                          |    6 +
 frontend/services/agents.ts                         |  146 +++
 frontend/types/agents.ts                            |  139 +++
 16 files changed, 1043 insertions(+), 1251 deletions(-)
```

(`git diff --stat` só mostra arquivos rastreados alterados — os
arquivos novos da v2.0, incluindo os 3 corrigidos nesta sessão de
saneamento, são untracked e aparecem no `git status` abaixo.)

---

## 9. git status

```
?? backend/drizzle/0015_agent_director_goals.sql
?? backend/drizzle/meta/0015_snapshot.json
?? backend/src/agents/director/collectors/goals.ts
?? backend/src/agents/director/goals/
?? backend/src/db/schema/agent-director-goal-evaluations.ts
?? backend/src/db/schema/agent-director-goal-metrics.ts
?? backend/src/db/schema/agent-director-goals.ts
?? backend/src/db/schema/agent-director-initiatives.ts
?? backend/src/routes/agents/director-goals.test.ts
?? backend/src/routes/agents/director-goals.ts
?? backend/src/routes/agents/director-initiatives.test.ts
?? backend/src/routes/agents/director-initiatives.ts
?? frontend/app/api/agents/director/goals/
?? frontend/app/api/agents/director/initiatives/
?? frontend/app/(dashboard)/agents/director/goals/
?? frontend/app/(dashboard)/agents/director/initiatives/
?? frontend/components/agents/director/goals/
?? frontend/hooks/agents/use-director-goals.ts
 M backend/drizzle/meta/_journal.json
 M backend/src/agents/director/decisions/thresholds.ts
 M backend/src/agents/director/operational-signals.ts
 M backend/src/agents/tools/director.ts
 M backend/src/db/schema/index.ts
 M backend/src/db/seed.ts
 M backend/src/routes/agents/index.ts
 M correio.md
 M executed.md
 M frontend/components/agents/director/director-dashboard.tsx
 M frontend/components/agents/status-badge.tsx
 M frontend/lib/agents/derived.test.ts
 M frontend/lib/agents/derived.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
```

(`backend/src/agents/director/goals/metrics/catalog.ts` e
`backend/src/agents/director/goals/review-service.ts` — os 2 arquivos
efetivamente corrigidos nesta sessão de saneamento — estão dentro do
diretório untracked `backend/src/agents/director/goals/`, já listado
acima; `backend/src/agents/director/goals/review-service.test.ts`
idem.)

---

Nenhum commit foi feito. Aguardando autorização final do Diretor/CEO.
