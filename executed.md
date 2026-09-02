# Saneamento final — Agentes v2.1

Relatório de execução do saneamento final da v2.1, conforme `correio.md`
(seção "Saneamento final — Agentes v2.1" → "Relatório final", 12 itens
obrigatórios). **NENHUM COMMIT foi feito** — todas as alterações permanecem
no working tree, aguardando autorização final do Diretor/CEO.

Escopo: 3 pontos apontados no `correio.md`, todos corrigidos e provados por
teste real (nunca por inspeção de código apenas):

1. `startInitiativeExecution()` não pode segurar transação/lock durante a
   chamada ao Planner/LLM.
2. `POST .../complete` (conclusão manual) não pode declarar uma Initiative
   "completed" com itens pendentes/aguardando aprovação/bloqueados/falhos.
3. Investigar o significado real de `execution_status='skipped'` e corrigir
   a classificação, se `skipped` não significar "bloqueio por impedimento".

---

## 1. Causa raiz dos três pontos

**Ponto 1 — lock durante o LLM.** A primeira versão de
`startInitiativeExecution` (da entrega v2.1 original) fazia todo o fluxo —
claim da Initiative, chamada ao Planner/LLM, Policy Evaluator, Executor e
vínculo do `actionPlanId` — dentro de **uma única transação Postgres**
(`db.transaction(...)` com `SELECT ... FOR UPDATE` mantido aberto do início
ao fim). Como a chamada ao LLM pode levar segundos (timeout padrão
`AGENT_LLM_TIMEOUT_MS=5000ms`), isso mantinha uma conexão do pool em
`idle in transaction`/executando por todo esse tempo, segurando o lock de
linha da Initiative — o exato anti-padrão que o `correio.md` apontou.

**Ponto 2 — conclusão manual sem checar evidência.** A função original
`completeInitiative` (em `initiatives-service.ts`) só validava a transição
de lifecycle (`active → completed` permitida pela máquina de estados) e
não olhava para o estado real dos Action Plan Items. Isso permitia
declarar uma Initiative "completed" mesmo com itens `pending`,
`waiting_approval`, `blocked` ou `failed` — divergindo da regra de
conclusão automática (`deriveInitiativeExecutionState`), que exige que
**todos** os itens tenham terminado com sucesso.

**Ponto 3 — `skipped` classificado como bloqueio.** O código original
tinha `BLOCKED_STATUSES = new Set(['blocked', 'skipped'])`, tratando
qualquer item `skipped` como impedimento real, o que fazia
`deriveInitiativeExecutionState` marcar a Initiative inteira como
`blocked` sempre que havia pelo menos um item `skipped`. Investigação no
código-fonte (não suposição pelo nome) mostrou que isso é **falso**:
`execution_status='skipped'` é escrito em exatamente um lugar
(`create-action-plan.ts:206`, no mapeamento `shadow → skipped`) e nunca
pelo Executor (`action-plan-executor.ts` só escreve `failed` para falha de
dependência). A decisão do Policy Evaluator (`action-policy-evaluator.ts`)
só produz `shadow` por duas causas reais, nenhuma delas um impedimento:
(a) `confidence < AGENT_LLM_MIN_CONFIDENCE` (padrão 0.8) — baixa confiança
da própria proposta do LLM; (b) Shadow Mode global ativo + tool que muta
dados (`tool.mutatesData`) — decisão deliberada de não executar em modo de
observação. Em ambos os casos a ação nunca chega a rodar, mas também não
falhou nem foi impedida por permissão/policy — é um "não executado por
escolha", não um bloqueio.

## 2. Solução aplicada

**Ponto 1.** `startInitiativeExecution` foi redesenhado para um padrão de
"claim curto + trabalho fora de transação":

- **Transação curta 1 (claim):** `SELECT ... FOR UPDATE` + `UPDATE status
  'approved' → 'active'`, dura milissegundos, sem I/O externo.
- **Fora de qualquer transação:** chamada ao Planner (`planEvaluateAndPersistActionPlan`)
  e ao Executor (`executeActionPlan`) — usa exatamente o pipeline oficial,
  sem duplicar lógica.
- **Transação curta 2 (link):** `UPDATE actionPlanId = <novo plano>`,
  também rápida.
- Se a claim falhar (outra requisição já ganhou a corrida) ou se a
  Initiative já estiver `active` sem `actionPlanId` ainda (corrida em
  andamento), a chamada faz **polling** (`waitForClaimWinner`, intervalo
  100ms, timeout 30s) lendo o estado real do banco até o vencedor
  terminar, em vez de segurar lock esperando.
- Se o Planner/Executor falhar depois da claim, a Initiative é revertida
  para `approved` (compensação), nunca fica presa em `active` sem plano.

**Ponto 2.** Nova função `completeInitiativeManually(initiative,
actorUserId)` substitui `completeInitiative`:
- Valida a transição de lifecycle (`assertInitiativeTransition`) — mantém
  a mesma máquina de estados.
- Recalcula a evidência real chamando `getInitiativeExecutionView`
  (a MESMA função usada pela conclusão automática) e só permite
  `completed` quando `view.state === 'completed'` — ou seja, exatamente a
  mesma regra usada pelo caminho automático. Não foi introduzida nenhuma
  semântica alternativa (conforme pedido pelo `correio.md`, que orientou
  evitar isso nesta versão).
- Caso a execução ainda não tenha terminado, retorna erro `409 Conflict`
  (`AgentError('conflict', ...)`) com o estado atual e a contagem
  `completedItems/totalItems` na mensagem.

**Ponto 3.** `InitiativeProgress` ganhou um bucket próprio `shadowedItems`,
separado de `blockedItems`. A classificação por item passou a ser:
`completed → completedItems`, `failed/rejected → failedItems`,
`blocked → blockedItems` (só bloqueio real), `skipped → shadowedItems`
(nunca conta como bloqueio), `waiting_approval → pendingApprovalItems`,
demais estados em progresso → `runningItems`. A regra de conclusão em
`deriveInitiativeExecutionState` passou a considerar um plano concluído
quando `completedItems + shadowedItems === totalItems` (itens
`shadowed` não impedem conclusão nem a classificam como bloqueio — eles
simplesmente não geraram execução, por decisão de confiança/Shadow Mode).

## 3. Como a concorrência funciona agora

```
approved ──(claim: SELECT FOR UPDATE + UPDATE, transação curta)──► active (sem actionPlanId ainda)
                                                                        │
                                                    fora de transação:  │  Planner → Policy Evaluator
                                                    (pode levar         │  → Action Plan persistido →
                                                     segundos, é o      │  Executor roda os itens
                                                     próprio LLM)       │  auto-executáveis
                                                                        ▼
                                                          active (com actionPlanId) ── (transação curta: link)
```

- Duas requisições concorrentes de `startInitiativeExecution` para a
  mesma Initiative: só uma consegue a claim (a `UPDATE ... WHERE status =
  'approved'` dentro do `FOR UPDATE` garante isso); a perdedora não fica
  bloqueada esperando o lock — ela lê o estado (`active` sem plano ainda)
  e entra em polling, retornando assim que o plano existir. Resultado:
  exatamente **um** Action Plan é criado, nenhuma segunda requisição
  duplica trabalho nem trava esperando lock de linha.
- Se a vencedora falha após a claim (erro no Planner, LLM indisponível
  etc.), a Initiative volta para `approved` — uma nova chamada pode
  tentar de novo, e uma perdedora que estava em polling detecta
  `status === 'approved'` de volta e lança erro claro
  ("tentativa concorrente falhou — tente novamente") em vez de esperar
  para sempre.

## 4. Prova de que não existe transação/lock durante o LLM

Teste novo `initiatives-execution-service.test.ts` → `'saneamento seção
1: NENHUMA transação fica aberta ("idle in transaction") durante a
chamada ao Planner/LLM'`:

- Usa um `LLMProvider` mock com delay artificial de 800ms
  (`delayedProvider`).
- Dispara `startInitiativeExecution(...)` sem `await` imediato.
- Aguarda 300ms (dentro da janela do delay do LLM) e consulta
  **diretamente o Postgres real**:
  ```sql
  select count(*)::int as count
  from pg_stat_activity
  where state = 'idle in transaction' and datname = current_database()
  ```
  Resultado: **0** — nenhuma conexão do pool está com transação aberta
  enquanto o "LLM" está "pensando".
- No mesmo instante, lê a Initiative direto do banco e confirma
  `status === 'active'` (a claim já commitou, mesmo com o Planner ainda
  rodando) — prova de que a transação de claim já foi liberada antes do
  trabalho externo começar.
- Passou no run completo (log): `✔ saneamento seção 1: NENHUMA transação
  fica aberta ("idle in transaction") durante a chamada ao Planner/LLM
  (937.357656ms)`.
- O teste de concorrência pré-existente (`Promise.all` de duas chamadas
  simultâneas → exatamente um Action Plan criado) continua passando com
  o novo design.

## 5. Regra definitiva de conclusão

**Automática e manual usam exatamente a mesma regra**, calculada por
`getInitiativeExecutionView`/`deriveInitiativeExecutionState`:

> Uma Initiative só pode ser `completed` quando **todos** os Action Plan
> Items do seu Action Plan estiverem em `completed` **ou** `skipped`
> (shadow) — ou seja, `completedItems + shadowedItems === totalItems`,
> e nenhum item em `pending`, `waiting_approval`, `approved`, `executing`,
> `blocked` ou `failed`/`rejected`.

- **Automática**: ocorre via `syncInitiativeExecutionState`, chamada após
  o Executor rodar (dentro de `startInitiativeExecution`) e disponível
  para outros pontos de sincronização (ex.: leitura de `GET
  .../execution`, aprovação de item pendente).
- **Manual** (`POST .../complete` → `completeInitiativeManually`):
  recalcula a evidência (`getInitiativeExecutionView`) no momento da
  chamada — não confia em um `status` potencialmente desatualizado — e só
  aplica a transição se `view.state === 'completed'`; caso contrário
  retorna `409` com o estado e contagem atuais. Isso foi provado tanto
  chamando `complete` antes de qualquer leitura prévia de `.../execution`
  (a rota calcula a evidência sozinha) quanto no fluxo real via approval
  (rejeitado 409 enquanto pendente, aceito 200 depois de aprovar o item).
- Não foi introduzida nenhuma semântica alternativa de "conclusão parcial
  manual" — o `correio.md` pediu explicitamente para evitar isso nesta
  versão, a menos que fosse justificada, o que não foi o caso.

## 6. Semântica real de `skipped`

`execution_status = 'skipped'` **nunca** significa impedimento/bloqueio.
É escrito em exatamente um lugar do código
(`backend/src/agents/orchestration/create-action-plan.ts:206`, no
mapeamento `decision → initialStatus`, ramo `shadow → 'skipped'`) e o
Executor (`action-plan-executor.ts`) jamais o produz — falha de
dependência lá vira `failed`, nunca `skipped`.

A decisão `shadow` do Policy Evaluator (`action-policy-evaluator.ts`) tem
exatamente **duas** causas possíveis, ambas verificadas em código e
exercitadas por teste real (não mockado no nível de decisão — o Policy
Evaluator real decide):

1. **Baixa confiança**: `confidence < env.AGENT_LLM_MIN_CONFIDENCE`
   (padrão `0.8`). Testado forçando o mock do LLM a propor
   `sales.get_pipeline_summary` com `confidence: 0.1`.
2. **Shadow Mode + tool que muta dados**: `AGENT_LLM_SHADOW_MODE=true` E
   a tool tem `mutatesData: true`. Testado com `process.env.AGENT_LLM_SHADOW_MODE
   = 'true'` e a tool `projects.create_internal_task` (agente `projects`,
   requer permission `tasks.create`, que o CEO possui). Confirmado que o
   validador do Planner (`validator.ts`) roda `inputSchema.safeParse`
   sobre os argumentos de **toda** ação proposta, independente da decisão
   final — por isso os argumentos precisam ser estruturalmente válidos
   mesmo para uma ação que nunca vai executar (não há checagem de FK no
   banco nesse estágio, já que `run()` nunca é chamado para itens
   shadow).

Em nenhum dos dois casos há bloqueio por permissão, policy, ou
impedimento de negócio — é uma decisão deliberada de "não executar agora"
(baixa confiança do próprio LLM, ou modo de observação global). Por isso
`skipped` foi movido para seu próprio bucket (`shadowedItems`), contado
como concluído para fins de progresso (não impede fechamento da
Initiative) e nunca mais alimenta `Initiative.status = 'blocked'`. Um
teste específico (`'bloqueio real (blocked de verdade) continua vencendo
mesmo com itens shadowed presentes'`) prova que um bloqueio real
(`execution_status='blocked'`) ainda é corretamente classificado como
`blocked` mesmo na presença de itens shadow — a correção não mascarou
bloqueios verdadeiros.

## 7. Arquivos alterados

**Backend:**
- `backend/src/agents/director/goals/initiatives-execution-service.ts` —
  reescrito: `startInitiativeExecution` (claim curto + fora de transação
  + polling), nova `completeInitiativeManually`.
- `backend/src/agents/director/goals/initiatives-progress.ts` —
  reescrito: bucket `shadowedItems`, regra de conclusão inclui
  `shadowedItems`.
- `backend/src/agents/director/goals/initiatives-service.ts` —
  `completeInitiative` removida (substituída, comentário aponta para o
  novo local).
- `backend/src/routes/agents/director-initiatives.ts` — rota `complete`
  passa a chamar `completeInitiativeManually`.
- `backend/src/agents/director/goals/review-service.ts` — ajuste menor
  ligado à integração com a nova função (sem mudança de comportamento de
  recomendação).
- 5 arquivos de teste ganharam o guard `redis.del('agents:ratelimit:plan:${ceoUserId}')`
  no `before()` (correção de flakiness, item separado abaixo):
  `director.test.ts`, `director/decisions/integration.test.ts`,
  `director/goals/integration.test.ts`,
  `routes/agents/director-initiatives.test.ts`,
  `routes/agents/director-decisions.test.ts`.

**Frontend:**
- `frontend/types/agents.ts` — `InitiativeExecutionView.shadowedItems: number`.
- `frontend/components/agents/director/goals/initiative-detail.tsx` —
  exibe contagem de itens "não executada(s) (shadow)" quando > 0.
- Demais arquivos frontend na `git diff --stat` (`status-badge.tsx`,
  `use-director-goals.ts`, `derived.ts`/`derived.test.ts`,
  `query/keys.ts`, `services/agents.ts`) são resíduos de rounds
  anteriores (v2.0/v2.1 delivery), não tocados neste saneamento — nenhum
  commit anterior existe para separá-los, então aparecem juntos no diff
  acumulado do working tree.

## 8. Testes adicionados/modificados

- `initiatives-progress.test.ts`: 16 → **19 testes** (+3): casos novos
  cobrindo que `skipped` nunca conta como `blocked`, que um plano 100%
  shadow é tratado como concluído, e que bloqueio real continua vencendo
  na presença de itens shadow.
- `initiatives-execution-service.test.ts`: 12 → **21 testes** (+9): prova
  de ausência de lock via `pg_stat_activity` (1), bloco
  `completeInitiativeManually` com 6 testes (rejeita para
  pending/waiting_approval/blocked/failed, aceita quando tudo completo,
  rejeita transição inválida `proposed→completed`), bloco "semântica real
  de skipped" com 2 testes (as duas causas reais).
- `routes/agents/director-initiatives.test.ts`: bloco "conclusão manual"
  reescrito em 2 testes end-to-end via HTTP real (rejeita 409 com
  approval pendente → aceita após aprovar; aceita mesmo sem leitura
  prévia de `.../execution`).
- Guard `redis.del` adicionado a 5 arquivos (correção de flakiness, não
  são testes novos).

## 9. Números exatos da suíte (medidos pelo runner real, não estimados)

**Backend — suíte completa** (`npx tsx --test --test-concurrency=1
'src/**/*.test.ts'`, via Docker no network do projeto):

```
ℹ tests 455
ℹ suites 77
ℹ pass 455
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**Reconciliação com a baseline anterior (441/441, medida na entrega v2.1,
antes deste saneamento):** 441 → 455 = **+14 testes líquidos**, batendo
exatamente com a soma medida por arquivo: `initiatives-progress.test.ts`
+3, `initiatives-execution-service.test.ts` +9, bloco "conclusão manual"
de `director-initiatives.test.ts` +2 (3+9+2=14).

**Frontend:**
- Testes: `npx tsx --test 'lib/**/*.test.ts'` → `tests 72 / suites 23 /
  pass 72 / fail 0` — **inalterado** frente à baseline anterior (72/72),
  consistente com este round não ter adicionado teste de frontend (só
  tipo + exibição condicional).

## 10. Typecheck / build

- Backend typecheck (`npx tsc --noEmit`, via Docker): **OK, sem erros.**
- Frontend typecheck (`npx tsc --noEmit`): **OK, sem erros.**
- Frontend build (`npm run build`): **OK**, build de produção completo
  sem erros (todas as rotas geradas).
- Lint: o projeto não possui script/config de lint configurado (backend
  nem frontend) — reconfirmado, mesmo estado já registrado nos rounds
  anteriores.

## 11. `git diff --stat`

```
 .../agents/director/decisions/integration.test.ts  |   4 +
 .../agents/director/goals/initiatives-service.ts   | 108 +---
 .../src/agents/director/goals/integration.test.ts  |   4 +
 .../src/agents/director/goals/review-service.ts    |   7 +-
 .../src/routes/agents/director-decisions.test.ts   |   4 +
 .../src/routes/agents/director-initiatives.test.ts | 260 ++++++---
 backend/src/routes/agents/director-initiatives.ts  |  55 +-
 backend/src/routes/agents/director.test.ts         |  11 +
 correio.md                                         | 307 ++++++----
 executed.md                                         | 638 ++++++++-------------
 .../agents/director/goals/initiative-detail.tsx    |  73 ++-
 frontend/components/agents/status-badge.tsx        |  20 +
 frontend/hooks/agents/use-director-goals.ts        |  14 +
 frontend/lib/agents/derived.test.ts                |  18 +
 frontend/lib/agents/derived.ts                     |  15 +
 frontend/lib/query/keys.ts                         |   1 +
 frontend/services/agents.ts                        |   8 +-
 frontend/types/agents.ts                           |  24 +
 18 files changed, 895 insertions(+), 676 deletions(-)
```

(`executed.md` mostra diff grande porque este relatório substitui o
anterior, conforme padrão já usado nos rounds anteriores.)

Novos arquivos (não versionados, sem histórico prévio para diff):
```
backend/src/agents/director/goals/initiatives-execution-service.test.ts
backend/src/agents/director/goals/initiatives-execution-service.ts
backend/src/agents/director/goals/initiatives-lifecycle.test.ts
backend/src/agents/director/goals/initiatives-lifecycle.ts
backend/src/agents/director/goals/initiatives-progress.test.ts
backend/src/agents/director/goals/initiatives-progress.ts
frontend/app/api/agents/director/initiatives/[id]/execution/  (proxy route)
```

## 12. `git status`

```
 M backend/src/agents/director/decisions/integration.test.ts
 M backend/src/agents/director/goals/initiatives-service.ts
 M backend/src/agents/director/goals/integration.test.ts
 M backend/src/agents/director/goals/review-service.ts
 M backend/src/routes/agents/director-decisions.test.ts
 M backend/src/routes/agents/director-initiatives.test.ts
 M backend/src/routes/agents/director-initiatives.ts
 M backend/src/routes/agents/director.test.ts
 M correio.md
 M executed.md
 M frontend/components/agents/director/goals/initiative-detail.tsx
 M frontend/components/agents/status-badge.tsx
 M frontend/hooks/agents/use-director-goals.ts
 M frontend/lib/agents/derived.test.ts
 M frontend/lib/agents/derived.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
?? backend/src/agents/director/goals/initiatives-execution-service.test.ts
?? backend/src/agents/director/goals/initiatives-execution-service.ts
?? backend/src/agents/director/goals/initiatives-lifecycle.test.ts
?? backend/src/agents/director/goals/initiatives-lifecycle.ts
?? backend/src/agents/director/goals/initiatives-progress.test.ts
?? backend/src/agents/director/goals/initiatives-progress.ts
?? frontend/app/api/agents/director/initiatives/[id]/execution/
```

---

## Nota lateral: flakiness real encontrada e corrigida (causa raiz, não retry)

Durante a validação final deste round, `director.test.ts` falhou com
**HTTP 429** em vez de `201` no teste de `propose`. Investigação (não
"rodar de novo até passar", conforme instrução explícita do `correio.md`):
`agentRateLimit('plan')` usa um contador real no Redis
(`agents:ratelimit:plan:${userId}`, janela de 60s, limite 15
requisições), **compartilhado por todos os arquivos de teste** que chamam
qualquer rota de "propose" como o mesmo usuário CEO real. Rodando a
suíte inteira rápido o suficiente, o total cumulativo de chamadas de
"propose" de vários arquivos (`director.test.ts`,
`director-decisions.test.ts`, `director-initiatives.test.ts`,
`decisions/integration.test.ts`, `goals/integration.test.ts`) passava de
15 antes da vez de `director.test.ts`, gerando 429 sem nenhuma relação
com o teste em si — não uma regressão deste saneamento.

Fix: já existia o mesmo problema resolvido em `action-plans.test.ts`
(`await redis.del(...)` no `before()`) — apliquei o mesmo guard,
simetricamente, aos 5 arquivos que chamam endpoints de "propose" como
CEO. Após o fix, suíte completa rodou limpa: **455/455, 0 falhas**
(confirmado em run completo do zero, não em retry parcial).

---

## Conclusão

Os 3 pontos do saneamento final da v2.1 foram corrigidos e provados por
teste real:
1. Lock/transação durante o LLM — eliminado, provado via
   `pg_stat_activity`.
2. Conclusão manual — agora exige a mesma evidência da conclusão
   automática, provado via 6 testes unitários + 2 testes end-to-end HTTP.
3. Semântica de `skipped` — investigada no código-fonte (não suposta),
   reclassificada em bucket próprio, provado via testes unitários e
   pipeline real das duas causas (baixa confiança, Shadow Mode).

Nenhuma funcionalidade nova foi adicionada, nenhum redesenho fora do
escopo dos 3 pontos foi feito. Suíte completa: backend 455/455 (0
falhas), frontend 72/72 (0 falhas). Typecheck e build limpos em ambos os
lados.

**NENHUM COMMIT foi realizado.** Todas as alterações permanecem no
working tree, aguardando autorização final do Diretor/CEO.
