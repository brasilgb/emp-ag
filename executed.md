# Agentes v2.2 — Executive Review & Strategic Feedback Loop

Relatório de entrega da v2.2, conforme `correio.md` seção 29 ("Relatório
final"), 22 itens obrigatórios. **NENHUM COMMIT foi feito** — todas as
alterações permanecem no working tree, aguardando autorização final do
Diretor/CEO.

---

## 1. Resumo da implementação

O Diretor Virtual passou a avaliar o RESULTADO ESTRATÉGICO de Initiatives
já executadas (não só o resultado técnico, já coberto pela v2.1),
registrar essa avaliação de forma persistente e auditável, e produzir
recomendações estruturadas (`none | continue | adjust | new_initiative |
escalate`) que só viram ação real através dos pipelines oficiais já
existentes — nunca um mecanismo novo de planejamento/execução. A cadeia
completa (CEO Goal → Director Analysis → Initiative → Action Plan →
Policy Evaluator → Executor → Execution Evidence → **Executive Review** →
**Recommendation**) está implementada e testada de ponta a ponta.

## 2. Arquitetura adotada

Separação estrita em 4 módulos novos, todos sob
`agents/director/reviews/`, seguindo o mesmo padrão de camadas já usado
por Goals (v2.0) e Initiative Execution (v2.1):

- `context.ts` — monta o DTO de evidência determinística (nunca SQL/tabela
  exposta ao LLM).
- `prompt.ts` — prompt restritivo (mesmo princípio de `planner/prompt.ts`).
- `executive-reviewer.ts` — chama o provider LLM, valida a saída com Zod,
  devolve só análise/recomendação (nunca toca o banco).
- `review-service.ts` — orquestra claim/persistência/efeitos colaterais
  (nunca chama o LLM diretamente nem monta prompt).
- `escalation.ts` — adaptador que reutiliza a Director Decision Queue
  (v1.9) para a recomendação `escalate`.
- `initiatives-service.ts` (v2.0, estendido) — adaptador
  `createInitiativeFromExecutiveReview` que reutiliza o pipeline oficial
  de criação de Initiative para a recomendação `new_initiative`.

Nenhum novo Executor, Planner ou Approval Workflow foi criado (seção 27).

## 3. Schema/migrations

Nova tabela `agent_executive_reviews` (migration `0016_agent_executive_reviews.sql`,
gerada via `drizzle-kit generate` + aplicada via `drizzle-kit migrate` —
diferente dos rounds anteriores, que exigiram reconciliação manual da
tabela de tracking; aqui o fluxo oficial do drizzle-kit funcionou de
ponta a ponta sem desvio, confirmado via `drizzle.__drizzle_migrations`
consistente com `drizzle/meta/_journal.json`).

Campos: `id, goal_id, initiative_id, action_plan_id (NOT NULL, UNIQUE),
created_by, review_type, status, outcome, summary, expected_result,
actual_result, evidence (jsonb), assessment, confidence, recommendation_type,
recommendation (jsonb), resulting_initiative_id, resulting_decision_id,
created_at, updated_at`.

Decisão de modelagem documentada no schema (`agent-executive-reviews.ts`):
`action_plan_id` é **NOT NULL + UNIQUE** — 1:1 deliberado com o Action
Plan/execução (correio.md seção 16: "pode existir inicialmente uma review
canônica por Action Plan/execução"). Essa unicidade É o próprio mecanismo
de idempotência/claim (seção 3/11 abaixo) — nunca uma coluna de lock
separada. Evolução futura sem redesenho: se uma segunda `review_type`
for introduzida, o índice único passa a ser composto
`(action_plan_id, review_type)` — a coluna já existe hoje só sem fazer
parte do índice único enquanto há um único tipo real.

## 4. Fluxo completo da Executive Review

```
POST /director/initiatives/:id/review
  → valida permission + Initiative existe
  → generateExecutiveReview(initiative, userId)
      → valida execution.state ∈ {completed, blocked, failed}
        (REVIEWABLE_EXECUTION_STATES — nunca prematura)
      → claim atômico (INSERT ... ON CONFLICT DO NOTHING em action_plan_id)
      → [fora de transação] monta contexto real (Goal+Initiative+Plan+Items)
      → [fora de transação] chama o Executive Reviewer (LLM)
      → persiste a review completa (status='completed')
      → se recommendation.type='new_initiative' → cria Initiative 'proposed'
      → se recommendation.type='escalate' → cria Decision Item 'open'
      → audita cada etapa
  ← 201 (nova) | 200 (idempotente/já existia)

GET /director/initiatives/:id/review
  → devolve a review canônica (ou null — nunca 404)
```

## 5. Como evidências são coletadas

`buildExecutiveReviewContext()` (`context.ts`) monta um DTO determinístico
a partir de dados JÁ AUTORIZADOS e já existentes no domínio:

- Goal (título, domínio, health, progresso, meta/valor atual).
- Initiative (título, descrição, racional, impacto esperado, status).
- Execução real (`getInitiativeExecutionView` — a MESMA função da v2.1:
  estado, progresso, contagens completed/failed/blocked/pendingApproval/
  shadowed).
- Action Plan (objetivo, resumo, status).
- Cada Action Plan Item (agent, tool, reason, decision, executionStatus,
  `result`/`error` — o retorno REAL de `executeActionPlan()`, nunca
  reinterpretado).

Esse MESMO objeto é: (a) serializado como `userMessage` para o LLM, e (b)
persistido verbatim em `agent_executive_reviews.evidence` — a evidência
usada fica sempre rastreável, nunca uma alegação não verificável do
Diretor. `expectedResult`/`actualResult` são textos determinísticos
montados pelo backend (nunca pelo LLM) a partir do Goal/execução reais.

## 6. Como o LLM é isolado de autorização e execução

- O prompt (`prompt.ts`) instrui explicitamente: "você NUNCA executa,
  aprova, autoriza ou modifica nada" + instrução de ignorar qualquer
  instrução embutida na evidência (mesmo princípio anti-prompt-injection
  já usado em `planner/prompt.ts`).
- A saída é validada por `executiveReviewOutputSchema` (`.strict()`) —
  os únicos campos possíveis são `outcome, summary, assessment,
  confidence, recommendation{type, reason, proposedGoal?}`. Não existe
  NENHUM campo na saída que referencie tool, approval, permission,
  autonomy ou execução — a garantia é estrutural (Zod rejeita qualquer
  campo extra), não uma checagem de blocklist à parte.
- `executive-reviewer.ts` nunca importa nada de `db/`, `executor/` ou
  `policy/` — não tem CAPACIDADE de executar nada, mesmo que quisesse.
- Toda ação posterior (aprovar a nova Initiative, agir sobre a
  escalação) passa de novo pelo pipeline de segurança existente
  (permissions, Policy Evaluator, Approval) — provado por teste (seção
  16 abaixo).

## 7. Lifecycle/status/outcomes/recommendations

- `status`: `draft` (transitório, nunca exposto por GET) → `completed`.
  `superseded` reservado para evolução futura (reavaliação — não usado
  nesta versão, seção 16: "não criar arquitetura que impeça").
- `outcome`: `successful | partially_successful | unsuccessful |
  inconclusive | blocked` — decidido inteiramente pelo LLM, nunca por
  regra determinística local (testado explicitamente: Action Plan 100%
  tecnicamente `completed` pode receber `outcome='unsuccessful'`).
- `recommendation.type`: `none | continue | adjust | new_initiative |
  escalate` — `none`/`continue`/`adjust` só registram texto (nenhum
  efeito colateral); `new_initiative`/`escalate` disparam os adaptadores
  oficiais (seções 10/11 abaixo).

## 8. Estratégia de concorrência/idempotência

A UNICIDADE de `action_plan_id` na própria tabela É o mecanismo de claim:

```
INSERT agent_executive_reviews (..., status='draft') ON CONFLICT (action_plan_id) DO NOTHING
  → 1 linha inserida  → EU sou o vencedor: monto contexto + chamo o LLM (fora de transação)
  → 0 linhas inseridas → leio a linha existente:
        status='completed' → devolvo direto (idempotente, SEM chamar o LLM)
        status='draft'     → aguardo (polling curto, sem lock) até 'completed'
                              ou até a linha sumir (vencedor reverteu → erro claro, retry seguro)
```

Mesmo racional já provado em `decisions/sync-service.ts:upsertSignal`
(v1.9) e em `startInitiativeExecution` (v2.1) — nunca find-then-insert
desprotegido, nunca `SELECT ... FOR UPDATE` bloqueante segurando conexão
durante I/O externo.

**Falha do provider (seção 24):** o bloco `catch` de
`generateExecutiveReview` DELETA a linha `draft` — nunca deixa uma review
presa para sempre. A próxima chamada (mesmo caller ou outro) reclama o
slot único normalmente. Provado por teste (`falha do provider: review não
fica presa em draft — retry seguro cria a review normalmente`).

## 9. Prova de ausência de transaction/lock durante LLM

Mesma metodologia da v2.1 (seção 24 do correio.md pediu explicitamente
para repeti-la): teste com provider mockado com delay artificial de
800ms, consulta `pg_stat_activity` no meio do delay:

```sql
select count(*)::int as count from pg_stat_activity
where state = 'idle in transaction' and datname = current_database()
```

Resultado: **0** — nenhuma conexão do pool está com transação aberta
enquanto o "LLM" está "pensando". No mesmo instante, a linha `draft` já
existe no banco (claim já commitado antes do I/O externo começar).
Teste: `ausência de lock durante o LLM: nenhuma transação fica "idle in
transaction" durante a chamada ao provider` — passou (879ms).

## 10. Integração com Goals/Initiatives/Action Plans

Nenhuma tabela nova de "execução" foi criada — a review lê Goal,
Initiative, Action Plan e Action Plan Items reais via `db.select()`
direto (mesmas tabelas da v2.0/v1.2), reutilizando
`getInitiativeExecutionView` (v2.1) para a visão de execução. A rota
`POST/GET .../review` foi adicionada ao MESMO arquivo de rotas de
Initiatives (`director-initiatives.ts`), reaproveitando os helpers
(`badRequest/notFound/currentUserId`) e o padrão de erro (`AgentError`)
já existentes — nenhum arquivo de rotas novo.

## 11. Integração de `new_initiative`

`createInitiativeFromExecutiveReview()` (`initiatives-service.ts`)
reutiliza o MESMO `agentDirectorInitiatives` e o MESMO
`recommendationKey` (índice único parcial já existente desde a v2.0,
usado por `reviewDirectorGoals()`) — chave
`executive-review:<reviewId>`. A Initiative nasce **sempre** `proposed`,
`origin='director_recommendation'`, **sem** `actionPlanId` — precisa
passar pelo ciclo de vida oficial completo (aprovação humana →
`startInitiativeExecution` → Action Plan oficial) antes de qualquer
execução. Provado por teste: `recomendação new_initiative: cria só uma
proposta pelo pipeline oficial — nunca Action Plan, nunca tool, nunca
pula aprovação`.

Nota de correção aplicada durante a implementação: o primeiro `insert`
com `onConflictDoNothing` sobre o índice PARCIAL falhou com "there is no
unique or exclusion constraint matching the ON CONFLICT specification"
(mesmo bug de sintaxe já documentado na saneamento v2.0 — `where` é
necessário, não `targetWhere`, exclusivo de `onConflictDoUpdate`) —
corrigido adicionando `where: isNotNull(recommendationKey)`, confirmado
pelo teste passando em seguida.

## 12. Integração de `escalate`

`escalateExecutiveReview()` (`escalation.ts`) reutiliza a MESMA
`agentDirectorDecisions` da Director Decision Queue (v1.9) — nenhuma
tabela de "escalations" paralela. `severity=critical, impact=high,
urgency=immediate` (decisão deliberada e documentada no código: uma
escalação de Executive Review não tem um sinal operacional bruto do qual
derivar esses eixos, então usa o teto de cada um — nunca sub-prioriza).
`requiresHumanAttention=true` — já é o mecanismo existente que destaca o
item no brief do Diretor. Idempotência via `deduplicationKey` +
`ON CONFLICT DO NOTHING` (mesmo padrão de `upsertSignal`). Decision Item
nasce `status='open'` — nenhuma decisão é auto-aprovada pelo LLM,
provado por teste.

## 13. Auditoria e segurança

Eventos auditados (`audit()`, mesma tabela `audit_logs` de sempre):
`agents.director.review.requested`, `.completed`,
`.initiative_proposed` (quando new_initiative), `.recommendation_escalated`
(quando escalate) — cada um com actor/entity/IDs/timestamps/metadata,
nunca conteúdo sensível.

Segurança: `POST .../review` exige `agents.director.initiatives.manage`
(permission JÁ EXISTENTE, reaproveitada — nenhuma permission nova
criada); `GET .../review` exige `agents.read`. Validação Zod em toda
saída do LLM. Usuário sem permission → 403, nenhuma review criada,
nenhuma chamada mutável ocorre (provado por teste HTTP).

## 14. Arquivos criados

Backend:
```
backend/src/agents/director/reviews/types.ts
backend/src/agents/director/reviews/schemas.ts
backend/src/agents/director/reviews/context.ts
backend/src/agents/director/reviews/prompt.ts
backend/src/agents/director/reviews/executive-reviewer.ts
backend/src/agents/director/reviews/review-service.ts
backend/src/agents/director/reviews/escalation.ts
backend/src/agents/director/reviews/review-service.test.ts
backend/src/db/schema/agent-executive-reviews.ts
backend/drizzle/0016_agent_executive_reviews.sql
backend/drizzle/meta/0016_snapshot.json
```

Frontend:
```
frontend/app/api/agents/director/initiatives/[id]/review/route.ts
```

## 15. Arquivos alterados

```
backend/drizzle/meta/_journal.json                          (+entrada da migration 0016)
backend/src/agents/director/goals/initiatives-service.ts    (+createInitiativeFromExecutiveReview)
backend/src/agents/errors.ts                                (+código 'review_failed', 422)
backend/src/db/schema/index.ts                               (+export agent-executive-reviews)
backend/src/db/seed.ts                                       (descrição da permission atualizada — cosmético, seed só insere se não existir, não afeta permissions já seedadas)
backend/src/routes/agents/director-initiatives.ts             (+POST/GET .../review)
backend/src/routes/agents/director-initiatives.test.ts       (+describe "POST/GET .../review", 5 testes)
frontend/components/agents/director/goals/initiative-detail.tsx (+ExecutiveReviewCard)
frontend/components/agents/status-badge.tsx                   (+ReviewOutcomeBadge, RecommendationTypeBadge)
frontend/hooks/agents/use-director-goals.ts                   (+useInitiativeReview, useGenerateInitiativeReview)
frontend/lib/agents/derived.ts                                (+reviewOutcomeLabel, recommendationTypeLabel)
frontend/lib/agents/derived.test.ts                           (+8 testes)
frontend/lib/query/keys.ts                                    (+directorInitiativeReview)
frontend/services/agents.ts                                   (+getInitiativeReview, generateInitiativeReview)
frontend/types/agents.ts                                      (+ExecutiveReview e tipos relacionados)
```

## 16. Testes adicionados

- `review-service.test.ts` — **12 testes**: Initiative sem execução
  elegível (409), sem actionPlanId (409), review bem-sucedida
  persistida corretamente, sucesso técnico ≠ sucesso estratégico,
  Initiative bloqueada (outcome coerente, nunca sucesso), skipped/shadow
  não é falha automática, review não altera Goal/Initiative originais,
  `new_initiative` cria só proposta pelo pipeline oficial, `escalate`
  gera Decision Item real sem auto-aprovação, idempotência (2 chamadas
  concorrentes → 1 review), ausência de lock durante o LLM (prova real
  via `pg_stat_activity`), falha do provider não deixa review presa.
- `director-initiatives.test.ts` (describe novo) — **5 testes**: 403 sem
  permission (nenhuma review criada), `GET` sem review ainda → `null`
  (nunca 404), `POST` prematuro (execução não terminada) → 409, fluxo
  completo via HTTP (propose → auto-completed → `POST review` 201 →
  `GET` devolve a mesma → segunda `POST` idempotente 200), recomendação
  `escalate` via HTTP gerando Decision Item real e visível na queue.
- `derived.test.ts` (frontend) — **4 testes**: `reviewOutcomeLabel` e
  `recommendationTypeLabel` (todos os valores + fallback de valor
  desconhecido, 2 testes cada).

Total: **17 testes novos no backend + 4 no frontend = 21 testes novos**.

## 17. Números exatos da suíte backend (medidos pelo runner real)

**Baseline antes da v2.2** (correio.md seção 25, medida real da entrega
anterior): `455 testes / 455 pass / 0 fail`.

**Suíte completa após a v2.2** (`npx tsx --test --test-concurrency=1
'src/**/*.test.ts'`, via Docker no network do projeto):

```
ℹ tests 472
ℹ suites 79
ℹ pass 472
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**Reconciliação:** 455 → 472 = **+17 testes líquidos**, batendo
exatamente com a soma medida por arquivo: `review-service.test.ts`
(12, arquivo novo) + `director-initiatives.test.ts` (8 → 13, +5) =
12 + 5 = 17. Nenhuma regressão — todos os 455 testes anteriores
continuam passando.

## 18. Números exatos da suíte frontend (medidos pelo runner real)

`npx tsx --test 'lib/**/*.test.ts'`:

```
ℹ tests 76
ℹ suites 25
ℹ pass 76
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Baseline anterior era 72/72 → 76/76 = **+4 testes líquidos**, batendo
exatamente com os 4 testes novos de `reviewOutcomeLabel`/
`recommendationTypeLabel` (2 describes × 2 testes cada). Nenhuma
regressão.

## 19. Typecheck/build

- Backend typecheck (`npx tsc --noEmit`, via Docker): **OK, sem erros.**
- Frontend typecheck (`npx tsc --noEmit`): **OK, sem erros.**
- Frontend build (`npm run build`): **OK**, build de produção completo
  sem erros — rota `/api/agents/director/initiatives/[id]/review`
  presente na saída do build.
- Lint: o projeto não possui script/config de lint configurado (backend
  nem frontend) — reconfirmado, mesmo estado já registrado nos rounds
  anteriores; nenhuma ferramenta de lint foi adicionada incidentalmente
  (correio.md seção 26).

## 20. `git diff --stat`

```
 backend/drizzle/meta/_journal.json                 |   7 +
 .../agents/director/goals/initiatives-service.ts   |  69 +-
 backend/src/agents/errors.ts                       |   9 +-
 backend/src/db/schema/index.ts                     |   3 +-
 backend/src/db/seed.ts                             |   2 +-
 .../src/routes/agents/director-initiatives.test.ts | 175 +++-
 backend/src/routes/agents/director-initiatives.ts  |  51 ++
 correio.md                                         | 889 +++++++++++++++++----
 .../agents/director/goals/initiative-detail.tsx    | 143 +++-
 frontend/components/agents/status-badge.tsx        |  42 +
 frontend/hooks/agents/use-director-goals.ts        |  28 +
 frontend/lib/agents/derived.test.ts                |  33 +
 frontend/lib/agents/derived.ts                     |  27 +
 frontend/lib/query/keys.ts                         |   1 +
 frontend/services/agents.ts                        |  11 +
 frontend/types/agents.ts                           |  54 ++
 16 files changed, 1364 insertions(+), 180 deletions(-)
```

(`executed.md` não aparece no diff acima porque a comparação é contra o
último commit real — este relatório substitui o conteúdo anterior do
arquivo, mesmo padrão dos rounds anteriores; `git status` abaixo mostra
`M executed.md`.)

Novos arquivos (sem histórico prévio, portanto fora do `diff --stat`):
```
backend/src/agents/director/reviews/                (7 arquivos)
backend/src/db/schema/agent-executive-reviews.ts
backend/drizzle/0016_agent_executive_reviews.sql
backend/drizzle/meta/0016_snapshot.json
frontend/app/api/agents/director/initiatives/[id]/review/route.ts
```

## 21. `git status`

```
 M backend/drizzle/meta/_journal.json
 M backend/src/agents/director/goals/initiatives-service.ts
 M backend/src/agents/errors.ts
 M backend/src/db/schema/index.ts
 M backend/src/db/seed.ts
 M backend/src/routes/agents/director-initiatives.test.ts
 M backend/src/routes/agents/director-initiatives.ts
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
?? backend/drizzle/0016_agent_executive_reviews.sql
?? backend/drizzle/meta/0016_snapshot.json
?? backend/src/agents/director/reviews/
?? backend/src/db/schema/agent-executive-reviews.ts
?? frontend/app/api/agents/director/initiatives/[id]/review/
```

## 22. Pendências ou limitações reais encontradas

1. **Falha de processo (crash) entre o claim e o revert.** Se o processo
   Node morrer no meio do `try` de `generateExecutiveReview` (não uma
   exceção JS normal, mas um crash real do processo), a linha `draft`
   fica presa — o `catch` que a deleta nunca roda. Mesma limitação já
   documentada na v2.1 para `startInitiativeExecution` (Initiative presa
   em `active` sem plano); não é uma regressão desta versão, é uma
   limitação estrutural do padrão "compensação via catch" sem um
   mecanismo de saga/timeout externo — fora do escopo pedido pelo
   correio.md desta versão.
2. **`reviewType`/índice único.** Só existe um `reviewType` real
   (`initiative_outcome`) nesta versão — o índice único cobre só
   `action_plan_id`. Se uma segunda `reviewType` for introduzida no
   futuro, o índice único precisa virar composto
   `(action_plan_id, review_type)` (documentado no schema).
3. **Geração automática (correio.md seção 13) não foi implementada como
   trigger automático** — o correio.md permitiu explicitamente evitar
   isso ("não é necessário criar um novo daemon ou scheduler se não
   houver necessidade") e pediu preferir "endpoint explícito" — foi essa
   a opção escolhida (`POST .../review`, chamado explicitamente pelo
   usuário ou por uma futura integração). Nenhum ponto de sincronização
   automática (ex.: gerar review sozinho quando a execução chega a
   `completed`) foi adicionado — decisão deliberada de manter o escopo
   mínimo pedido.
4. **Frontend**: o card de Executive Review some quando a execução não
   está em estado terminal (nunca mostra "gerar review" prematuramente),
   mas não há um botão de "gerar" desabilitado com tooltip explicando o
   motivo — simplesmente não aparece. Comportamento aceitável, mas uma
   iteração futura poderia tornar isso mais explícito.

---

## Conclusão

Todos os 16 critérios da seção 28 do correio.md foram atendidos: Executive
Review persistida; evidência separada da interpretação do LLM; resultado
técnico separado do resultado estratégico (provado por teste); recomendações
estruturadas e validadas por Zod; LLM sem poder de autorização (estrutural,
não convencional); `new_initiative` reutiliza o pipeline oficial;
`escalate` reutiliza a Decision Queue existente; concorrência protegida
(claim atômico via unicidade); nenhuma transaction aberta durante o LLM
(provado via `pg_stat_activity`); Goal original nunca modificado pela
review (provado por teste); auditoria implementada; frontend apresenta
review e recomendação sem sugerir decisão automática; backend completo
passa (472/472); frontend completo passa (76/76); typecheck limpo dos dois
lados; build de produção passa.

Nenhuma funcionalidade fora do escopo da v2.2 foi adicionada, nenhum
mecanismo de planejamento/execução/aprovação foi duplicado.

**NENHUM COMMIT foi realizado.** Todas as alterações permanecem no
working tree, aguardando autorização final do Diretor/CEO.
