# Agentes v2.3 — Strategic Learning & Organizational Memory

Relatório de entrega da v2.3, conforme `correio.md` seção 29 ("Relatório
final"), 28 itens obrigatórios. **NENHUM COMMIT foi feito nesta sessão**
— todas as alterações desta entrega permanecem no working tree,
aguardando autorização final do Diretor/CEO.

**Nota sobre o baseline:** entre a entrega da v2.2 e o início desta v2.3,
os commits `706699a` ("Commit", saneamento v2.1) e `7545772` ("Push",
v2.2 completa) foram realizados — pelo autor do repositório, fora desta
sessão de execução, refletindo a aprovação/consolidação daquelas
entregas. `HEAD` já contém, portanto, toda a v2.1/v2.2. O `git diff
--stat`/`git status` deste relatório (itens 26/27) refletem exclusivamente
o delta real da v2.3 sobre esse HEAD.

---

## 1. Resumo da implementação

O Diretor Virtual passou a ter uma camada de memória organizacional
estratégica: aprendizados extraídos de Executive Reviews (v2.2)
concluídas, persistidos com proveniência rastreável, usados
EXCLUSIVAMENTE como contexto consultivo — nunca como autorização. Uma
nova Executive Review agora recebe (opcionalmente) memórias históricas
relevantes do mesmo domínio, apresentadas ao LLM numa seção
"HISTORICAL ORGANIZATIONAL MEMORY" claramente separada da "CURRENT
EVIDENCE", com instrução explícita de precedência da evidência atual.

## 2. Arquitetura adotada

Novo módulo `agents/director/memory/`, mesmo padrão de camadas de
`reviews/` (v2.2): `types.ts`, `schemas.ts`, `context.ts`, `prompt.ts`,
`memory-extractor.ts` (chama o LLM, isolado de banco/execução/policy),
`memory-service.ts` (orquestra claim/persistência/arquivamento),
`retrieval-service.ts` (recuperação determinística). Nenhum novo
Executor/Planner/Approval Workflow/Policy Evaluator foi criado (seção
27). A integração com "Director Analysis" reaproveita o ÚNICO componente
LLM de análise estratégica já existente — o Executive Reviewer da v2.2
(`reviews/executive-reviewer.ts` + `reviews/prompt.ts`, ambos estendidos,
nunca duplicados).

## 3. Schema/migrations

Nova tabela `agent_strategic_memories` (migration
`0017_agent_strategic_memories.sql`), gerada e aplicada via fluxo oficial
`drizzle-kit generate` + `drizzle-kit migrate` (seção 26) — sem edição
manual do tracking, consistência entre migration SQL, `drizzle/meta/_journal.json`,
snapshot e `drizzle.__drizzle_migrations` confirmada pelo próprio
`drizzle-kit migrate` (que teria falhado em caso de divergência).

Campos: `id, memory_type, domain, title, summary, lesson, outcome,
confidence, importance, tags (jsonb), source_goal_id, source_initiative_id,
source_review_id, source_decision_id, evidence (jsonb), status,
created_by, created_at, updated_at`.

Decisões de modelagem documentadas no schema
(`agent-strategic-memories.ts`):
- `source_review_id` NULLABLE + índice único PARCIAL (`WHERE NOT NULL`)
  — nesta versão toda memória nasce de uma review (1:1, seção 13), mas a
  coluna fica nullable para permitir, sem migração futura, outros
  `memory_type` não derivados de review.
- `status` ganhou um 4º valor, `draft`, além dos 3 sugeridos pelo
  correio.md (`active/superseded/archived`) — mesmo racional já usado em
  `agent_executive_reviews.status` (v2.2): é o estado transitório entre
  o claim atômico e a resposta do LLM, necessário para nunca segurar
  transaction durante a chamada externa.
- `tags` foi adicionado além dos "campos mínimos" da seção 2 — a seção 7
  pede explicitamente que a saída do LLM inclua `tags`; persistir é
  melhor que descartar.

## 4. Modelo da Strategic Memory

Uma linha de `agent_strategic_memories` representa UM aprendizado:
`evidence` (fato, backend) + `title/summary/lesson/tags` (interpretação,
LLM) + `confidence/importance` (auto-avaliação do LLM) + proveniência
(`source_*`, backend) + `status` (lifecycle). Nunca uma verdade absoluta
— sempre acompanhada de confiança e proveniência, nunca apresentada como
regra (seção 8/19).

## 5. Tipos de memória implementados

Vocabulário completo definido (`memory/types.ts`): `initiative_outcome |
strategic_lesson | decision_outcome | recurring_pattern`. **Nesta
versão, só `initiative_outcome` é efetivamente produzido**
(`createStrategicMemoryFromReview` sempre grava esse tipo) — os outros 3
ficam no vocabulário/schema, prontos para uma fonte de geração futura
(ex.: memória extraída diretamente de uma Decision resolvida, sem passar
por Executive Review), sem exigir migração de schema quando isso
acontecer. Consistente com a seção 2: "não criar dezenas de tipos nesta
versão".

## 6. Como provenance funciona

Toda memória carrega `source_goal_id`, `source_initiative_id`,
`source_review_id` e (quando aplicável) `source_decision_id` —
preenchidos DETERMINISTICAMENTE pelo backend a partir da Executive
Review de origem (`review.goalId`, `review.initiativeId`, `review.id`,
`review.resultingDecisionId`), nunca pelo LLM (a saída estruturada do
LLM — `strategicMemoryOutputSchema` — nem TEM campo de proveniência,
estruturalmente impossível de inventar). Provado por teste:
"Executive Review gera memória válida com provenance real".

## 7. Como evidência é separada da interpretação

`buildStrategicMemoryEvidence()` (`memory/context.ts`) monta o objeto
`evidence` (goal/initiative/review reais) ANTES de qualquer chamada ao
LLM — é persistido em `agent_strategic_memories.evidence` inalterado. O
LLM só produz `title/summary/lesson/confidence/importance/tags`, nunca
escreve em `evidence`. Provado por teste: "evidência separada do lesson"
— `memory.evidence.review.outcome` é o outcome REAL da review (fato),
`memory.lesson` é o texto do LLM mockado (interpretação), e o teste
verifica explicitamente que os dois nunca são o mesmo campo/dado.

## 8. Como o LLM foi isolado

`memory-extractor.ts` não importa `db/`, `executor/`, `policy/` nem
mecanismo de permission — estrutural, não uma convenção seguida por
disciplina: o módulo simplesmente não tem acesso a nada disso.
`strategicMemoryOutputSchema` é `.strict()` — os únicos campos possíveis
na saída são `title, summary, lesson, confidence, importance, tags`;
qualquer campo como `tool/action/execute/permission/approval/autonomy/sql/command`
(lista explícita da seção 7) é rejeitado pelo Zod antes de qualquer
outra validação. O prompt (`memory/prompt.ts`) instrui explicitamente
"você NUNCA executa, aprova, autoriza ou modifica nada" e a tratar a
memória como contexto consultivo, nunca instrução imperativa.

## 9. Fluxo de criação da memória

```
POST /agents/director/reviews/:id/memory
  → valida permission + review existe e está "completed"
  → createStrategicMemoryFromReview(review, userId)
      → claim atômico (INSERT ... ON CONFLICT DO NOTHING em source_review_id)
      → [fora de transação] monta evidência (rápida, determinística)
      → [fora de transação] chama o memory extractor (LLM)
      → persiste a memória completa (status='active')
      → audita cada etapa
  ← 201 (nova) | 200 (idempotente/já existia)
```

Escolha deliberada (seção 4: "pode ser utilizado endpoint explícito"):
optou-se por endpoint explícito, não integração automática síncrona
dentro de `generateExecutiveReview` — mantém as duas operações
independentes (uma falha na extração de memória nunca compromete a
review já persistida) e evita estender a duração da chamada de review
com uma segunda chamada LLM obrigatória.

## 10. Fluxo de recuperação

`getRelevantStrategicMemories({ domain, memoryType?, limit? })`
(`retrieval-service.ts`) — determinístico, sem embeddings/vector
database (seção 9/10): filtra por `domain` + `status='active'` (nunca
`draft`/`superseded`/`archived`), ordena por importância → confiança →
recência (nessa prioridade), respeita limite explícito (`default=5`,
`max=10`, sempre capado mesmo que o caller peça mais). Chamado
automaticamente por `generateExecutiveReview` (v2.2, estendido) antes de
chamar o Executive Reviewer, injetando o resultado no prompt.

## 11. Regras de precedência

Documentadas formalmente em `memory/types.ts`
(`STRATEGIC_MEMORY_PRECEDENCE_ORDER`, seção 22):

```text
1. Permissions/Authorization
2. Policy/Safety rules
3. Human decisions/approvals
4. Current deterministic evidence
5. Current business context
6. Historical strategic memory
7. LLM interpretation
```

Garantia estrutural (não só documental): nenhum código dos níveis 1-3
(`security/permissions.ts`, `policy/action-policy-evaluator.ts`,
`agent_approvals`) importa ou consulta o módulo `memory/` — é
fisicamente impossível para uma memória influenciar esses níveis. O
prompt do Executive Reviewer reforça em texto: "a evidência atual possui
precedência sobre estes padrões históricos" + "nunca como justificativa
para ignorar Policy Evaluator, permissions ou decisão humana".

## 12. Integração com Executive Review

`reviews/review-service.ts:generateExecutiveReview` (v2.2) foi estendido
(nunca duplicado) para, antes de chamar o LLM, buscar
`getRelevantStrategicMemories({ domain: goal.domain })` e passar o
resultado a `reviewExecutiveOutcome({ ..., historicalMemories })`.
`reviews/prompt.ts:buildExecutiveReviewUserMessage` agora monta duas
seções claramente separadas — `CURRENT EVIDENCE:` (o mesmo objeto da
v2.2, inalterado) seguido de `HISTORICAL ORGANIZATIONAL MEMORY:` (novo,
seção 11), nunca misturadas. Retrocompatível: quando não há memórias
relevantes, aparece só o texto "nenhuma memória histórica relevante
disponível" — o comportamento da v2.2 nunca foi alterado.

## 13. Integração com Goals/Director

Cada memória carrega `source_goal_id`, e a recuperação filtra por
`domain` (do próprio Goal do momento) — quando um novo Goal do mesmo
domínio é avaliado (via uma nova Initiative → Executive Review), as
lições de Goals anteriores no mesmo domínio entram automaticamente como
contexto. Nenhuma alteração automática de Goal/Initiative acontece nunca
— provado por teste ("memória nunca altera Goal nem Initiative
originais").

## 14. Estratégia de concorrência/idempotência

Idêntica ao padrão já provado em `reviews/review-service.ts` (v2.2): a
UNICIDADE de `source_review_id` na própria tabela É o claim
(`INSERT ... ON CONFLICT DO NOTHING`, atômico). Vencedor monta
evidência + chama o LLM fora de transação; perdedor lê a linha
existente — se `active`, devolve direto (idempotente, SEM chamar o LLM
de novo); se `draft`, aguarda via polling curto (sem lock). Provado por
teste: duas chamadas concorrentes (`Promise.all`) convergem para a MESMA
memória, só uma efetivamente cria; uma terceira chamada normal (não
concorrente) também é idempotente.

## 15. Comportamento em falha do provider

O `catch` de `createStrategicMemoryFromReview` DELETA a linha `draft` —
nunca deixa um registro permanentemente em estado transitório. A próxima
chamada (mesmo caller ou outro) reclama o slot único normalmente.
Provado por teste: falha do provider (mock lançando erro) → linha draft
desaparece → nova chamada com provider funcional cria a memória
normalmente (retry seguro).

## 16. Prova de ausência de transaction/lock durante LLM

Mesma metodologia da v2.1/v2.2: provider mockado com delay artificial de
800ms, consulta `pg_stat_activity` no meio do delay:

```sql
select count(*)::int as count from pg_stat_activity
where state = 'idle in transaction' and datname = current_database()
```

Resultado: **0**. No mesmo instante, a linha `draft` já existe no banco
(claim já commitado antes do I/O externo). Teste: "ausência de lock
durante o LLM — nenhuma transação fica 'idle in transaction' durante a
chamada ao provider" — passou (886ms).

## 17. Auditoria

Implementados exatamente os 4 eventos pedidos pela seção 16, ajustados
aos fluxos reais:

- `agents.director.memory.requested` — ao iniciar o claim (vencedor da
  corrida).
- `agents.director.memory.created` — quando a memória é persistida como
  `active` pela primeira vez.
- `agents.director.memory.reused` — em DOIS fluxos reais: (a) uma
  chamada de criação que encontra uma memória já existente (idempotente,
  nenhum LLM chamado de novo); (b) uma nova Executive Review que
  recupera e injeta memórias históricas em seu prompt (com
  `metadata.memoryIdsUsed`, seção 20) — decisão de design documentada em
  código (`review-service.ts`), já que a seção 16 não distingue os dois
  usos de "reused" e ambos são genuinamente "a memória foi usada de
  novo".
- `agents.director.memory.archived` — ao arquivar (`archiveStrategicMemory`).

Todos registram `actor/memoryId (ou reviewId)/sourceReviewId/sourceGoalId/
sourceInitiativeId/timestamp/metadata` conforme pedido, nunca secrets.

## 18. Segurança/permissions

Nenhuma permission nova criada (seção 17). Reaproveitadas: `agents.read`
para leitura (`GET /director/memories`, `GET /director/memories/:id`),
`agents.director.initiatives.manage` para a ação administrativa
(`POST /director/reviews/:id/memory`) — mesma permission já usada por
`POST .../review` na v2.2, descrita como "ação administrativa sobre o
mesmo domínio do Diretor". Autorização sempre no backend (`requirePermission()`
nas rotas); frontend nunca é barreira de segurança (`PermissionGate`
só esconde a UI, não substitui o 403 real do backend).

## 19. Frontend implementado

- Nova página `/agents/director/memories` (`MemoriesList`) — filtros por
  domínio/tipo, cada card mostra título/tipo/domínio/lição/confiança/
  importância/data, com links para Goal e Initiative de origem. Nunca
  usa a palavra "regra" — o texto de topo da página diz explicitamente
  "orientação consultiva para o Diretor, nunca uma regra obrigatória".
- Seção "Aprendizado estratégico" dentro do `ExecutiveReviewCard` (tela
  de Initiative) — botão "Gerar aprendizado" (atrás de
  `PermissionGate`), mostra título/lição/importância/confiança quando já
  existe, link para a lista completa.
- Badges: `MemoryStatusBadge`, `MemoryImportanceBadge` — nunca dependem
  só de cor (texto sempre visível).
- Item "Aprendizados" adicionado à sub-navegação do módulo Agentes.

## 20. Arquivos criados

Backend:
```
backend/src/agents/director/memory/types.ts
backend/src/agents/director/memory/schemas.ts
backend/src/agents/director/memory/context.ts
backend/src/agents/director/memory/prompt.ts
backend/src/agents/director/memory/memory-extractor.ts
backend/src/agents/director/memory/memory-service.ts
backend/src/agents/director/memory/retrieval-service.ts
backend/src/agents/director/memory/schemas-route.ts
backend/src/agents/director/memory/memory-service.test.ts
backend/src/agents/director/memory/retrieval-service.test.ts
backend/src/db/schema/agent-strategic-memories.ts
backend/src/routes/agents/director-memories.ts
backend/src/routes/agents/director-memories.test.ts
backend/drizzle/0017_agent_strategic_memories.sql
backend/drizzle/meta/0017_snapshot.json
```

Frontend:
```
frontend/app/(dashboard)/agents/director/memories/page.tsx
frontend/app/api/agents/director/memories/route.ts
frontend/app/api/agents/director/memories/[id]/route.ts
frontend/app/api/agents/director/reviews/[id]/memory/route.ts
frontend/components/agents/director/memory/memories-list.tsx
frontend/hooks/agents/use-director-memories.ts
```

## 21. Arquivos alterados

```
backend/drizzle/meta/_journal.json                         (+entrada da migration 0017)
backend/src/agents/director/reviews/executive-reviewer.ts  (+historicalMemories opcional)
backend/src/agents/director/reviews/prompt.ts               (+seção HISTORICAL ORGANIZATIONAL MEMORY)
backend/src/agents/director/reviews/review-service.ts       (+recuperação/injeção de memórias, +auditoria de reuso)
backend/src/agents/director/reviews/review-service.test.ts  (+2 testes de integração v2.3, +helper de parsing do novo formato de userMessage)
backend/src/agents/errors.ts                                (+código 'memory_failed', 422)
backend/src/db/schema/index.ts                              (+export agent-strategic-memories)
backend/src/routes/agents/index.ts                          (+registro de directorMemoriesRoutes)
frontend/components/agents/agents-sub-nav.tsx               (+item "Aprendizados")
frontend/components/agents/director/goals/initiative-detail.tsx (+seção StrategicMemorySection)
frontend/components/agents/status-badge.tsx                 (+MemoryStatusBadge, MemoryImportanceBadge)
frontend/lib/agents/derived.ts                               (+memoryTypeLabel, memoryStatusLabel, memoryImportanceLabel)
frontend/lib/agents/derived.test.ts                          (+6 testes)
frontend/lib/query/keys.ts                                   (+directorMemories, directorMemory)
frontend/services/agents.ts                                  (+listStrategicMemories, getStrategicMemory, generateMemoryFromReview)
frontend/types/agents.ts                                     (+StrategicMemory e tipos relacionados)
```

## 22. Testes adicionados

Cobrindo os 20 itens da seção 23 do correio.md:

- `memory-service.test.ts` (novo) — **9 testes**: review não `completed`
  rejeitada (409); (1/2/3) review gera memória válida com provenance
  real e evidência separada do lesson; (8/9) nunca altera Goal/Initiative;
  (10/11/12) nunca cria Action Plan, nunca executa tool, nunca cria
  approval; (4/5) concorrência + idempotência; (7) ausência de lock
  durante o LLM (`pg_stat_activity`); (6) falha do provider com retry
  seguro; listagem nunca inclui `draft` por padrão (bug real encontrado
  e corrigido durante a implementação — ver seção 28); `archiveStrategicMemory`
  (arquivar + rejeitar arquivar de novo).
- `retrieval-service.test.ts` (novo) — **4 testes**: (13) recuperação
  por domínio; (14) limite respeitado (default/customizado/capado no
  máximo); (15) arquivada/draft nunca entram no contexto; ordenação por
  importância > confiança > recência.
- `director-memories.test.ts` (novo) — **4 testes**: (17) sem permission
  → 403, nenhuma memória criada; (18) só `agents.read` → lista permitida,
  criação continua 403; fluxo completo via HTTP (criar → detalhe →
  lista filtrada → idempotência); review inexistente → 404.
- `review-service.test.ts` (v2.2, estendido) — **+2 testes**: (16)
  `CURRENT EVIDENCE`/`HISTORICAL ORGANIZATIONAL MEMORY` aparecem
  separadas no prompt real, com texto de precedência presente; (19) IDs
  das memórias usadas ficam auditáveis (`agents.director.memory.reused`
  com `memoryIdsUsed`); memória arquivada nunca entra no prompt de uma
  nova review.
- `derived.test.ts` (frontend) — **6 testes**: (20) `memoryTypeLabel`,
  `memoryStatusLabel`, `memoryImportanceLabel` (todos os valores +
  fallback).

Total: **19 testes novos no backend + 6 no frontend = 25 testes novos**.

## 23. Números exatos da suíte backend (medidos pelo runner real)

**Baseline após v2.2** (correio.md seção 24, medida real da entrega
anterior): `472 testes / 472 pass / 0 fail`.

**Suíte completa após a v2.3** (`npx tsx --test --test-concurrency=1
'src/**/*.test.ts'`, via Docker no network do projeto):

```
ℹ tests 491
ℹ suites 83
ℹ pass 491
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**Reconciliação:** 472 → 491 = **+19 testes líquidos**, batendo
exatamente com a soma medida por arquivo: `memory-service.test.ts` (9,
novo) + `retrieval-service.test.ts` (4, novo) + `director-memories.test.ts`
(4, novo) + `review-service.test.ts` (12 → 14, +2) = 9 + 4 + 4 + 2 = 19.
Nenhuma regressão — todos os 472 testes anteriores continuam passando.

## 24. Números exatos da suíte frontend (medidos pelo runner real)

`npx tsx --test 'lib/**/*.test.ts'`:

```
ℹ tests 82
ℹ suites 28
ℹ pass 82
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Baseline anterior era 76/76 → 82/82 = **+6 testes líquidos**, batendo
exatamente com os 6 testes novos de `memoryTypeLabel`/`memoryStatusLabel`/
`memoryImportanceLabel` (3 describes × 2 testes cada). Nenhuma regressão.

## 25. Typecheck/build

- Backend typecheck (`npx tsc --noEmit`, via Docker): **OK, sem erros.**
- Frontend typecheck (`npx tsc --noEmit`): **OK, sem erros.**
- Frontend build (`npm run build`): **OK**, build de produção completo
  sem erros — rotas `/agents/director/memories`,
  `/api/agents/director/memories`, `/api/agents/director/memories/[id]`
  e `/api/agents/director/reviews/[id]/memory` presentes na saída do
  build.
- Lint: o projeto continua sem script/config de lint configurado —
  reconfirmado; nenhuma ferramenta de lint foi adicionada.

## 26. `git diff --stat`

(Delta real da v2.3 — HEAD já inclui v2.1/v2.2, commitados fora desta
sessão entre rounds; ver nota no topo do relatório.)

```
 backend/drizzle/meta/_journal.json                 |   7 ++
 .../agents/director/reviews/executive-reviewer.ts  |   9 +-
 backend/src/agents/director/reviews/prompt.ts      |  23 ++++-
 .../agents/director/reviews/review-service.test.ts | 112 ++++++++++++++++++++-
 .../src/agents/director/reviews/review-service.ts  |  26 +++++
 backend/src/agents/errors.ts                       |   7 +-
 backend/src/db/schema/index.ts                     |   3 +-
 backend/src/routes/agents/index.ts                 |   2 +
 frontend/components/agents/agents-sub-nav.tsx      |   1 +
 .../agents/director/goals/initiative-detail.tsx    |  76 +++++++++++++-
 frontend/components/agents/status-badge.tsx        |  34 +++++++
 frontend/lib/agents/derived.test.ts                |  45 +++++++++
 frontend/lib/agents/derived.ts                     |  36 +++++++
 frontend/lib/query/keys.ts                         |   2 +
 frontend/services/agents.ts                        |  26 +++++
 frontend/types/agents.ts                           |  32 ++++++
 16 files changed, 432 insertions(+), 9 deletions(-)
```

(`executed.md`/`correio.md` fora do diff acima por comparação com HEAD —
este relatório substitui o `executed.md` já commitado.)

Novos arquivos (sem histórico prévio, fora do `diff --stat`):
```
backend/src/agents/director/memory/                 (10 arquivos)
backend/src/db/schema/agent-strategic-memories.ts
backend/src/routes/agents/director-memories.ts
backend/src/routes/agents/director-memories.test.ts
backend/drizzle/0017_agent_strategic_memories.sql
backend/drizzle/meta/0017_snapshot.json
frontend/app/(dashboard)/agents/director/memories/
frontend/app/api/agents/director/memories/
frontend/app/api/agents/director/reviews/
frontend/components/agents/director/memory/
frontend/hooks/agents/use-director-memories.ts
```

## 27. `git status`

```
 M backend/drizzle/meta/_journal.json
 M backend/src/agents/director/reviews/executive-reviewer.ts
 M backend/src/agents/director/reviews/prompt.ts
 M backend/src/agents/director/reviews/review-service.test.ts
 M backend/src/agents/director/reviews/review-service.ts
 M backend/src/agents/errors.ts
 M backend/src/db/schema/index.ts
 M backend/src/routes/agents/index.ts
 M correio.md
 M executed.md
 M frontend/components/agents/agents-sub-nav.tsx
 M frontend/components/agents/director/goals/initiative-detail.tsx
 M frontend/components/agents/status-badge.tsx
 M frontend/lib/agents/derived.test.ts
 M frontend/lib/agents/derived.ts
 M frontend/lib/query/keys.ts
 M frontend/services/agents.ts
 M frontend/types/agents.ts
?? backend/drizzle/0017_agent_strategic_memories.sql
?? backend/drizzle/meta/0017_snapshot.json
?? backend/src/agents/director/memory/
?? backend/src/db/schema/agent-strategic-memories.ts
?? backend/src/routes/agents/director-memories.test.ts
?? backend/src/routes/agents/director-memories.ts
?? frontend/app/(dashboard)/agents/director/memories/
?? frontend/app/api/agents/director/memories/
?? frontend/app/api/agents/director/reviews/
?? frontend/components/agents/director/memory/
?? frontend/hooks/agents/use-director-memories.ts
```

## 28. Limitações ou pendências reais encontradas

1. **Bug real encontrado e corrigido durante a implementação:**
   `listStrategicMemories` não excluía linhas `draft` por padrão (o
   filtro `status` só era aplicado quando explicitamente passado pelo
   caller) — a documentação da função já afirmava esse comportamento,
   mas o código não o implementava. Corrigido (`ne(status, 'draft')`
   quando `status` não é informado) e coberto por um teste novo dedicado
   (`listStrategicMemories nunca inclui draft por padrão`). A suíte
   completa (491/491) já reflete o código corrigido — o run anterior
   (com o bug) foi descartado e a suíte foi re-executada do zero após o
   fix, nunca apenas re-rodada parcialmente.
2. **Falha de processo (crash) entre claim e revert** — mesma limitação
   estrutural já documentada na v2.1 (`startInitiativeExecution`) e v2.2
   (`generateExecutiveReview`): um crash real do processo Node entre o
   claim e o `catch` de reversão deixaria uma linha `draft` presa. Fora
   do escopo pedido pelo correio.md (que pede "falha de provider", não
   "crash de processo" — tratado corretamente).
3. **Arquivamento (`archiveStrategicMemory`) não tem endpoint HTTP
   próprio nesta versão** — decisão deliberada (correio.md seção 18:
   "não criar CRUD administrativo gigantesco", escopo pedido é
   "criar; consultar; recuperar memórias relevantes"). A função de
   serviço existe, é auditada (`agents.director.memory.archived`) e
   testada diretamente — pronta para ganhar rota quando houver
   necessidade real comprovada.
4. **Recuperação por importância/confiança é feita em memória (JS), não
   em SQL** — decisão documentada em `retrieval-service.ts`: o volume
   esperado de memórias `active` por domínio (uma por Executive Review)
   é pequeno o bastante para não justificar um `ORDER BY` com `CASE`
   só para mapear enum→rank. Se o volume crescer ordens de magnitude,
   vale revisitar.
5. **`memory_type` só produz `initiative_outcome` nesta versão** — os
   outros 3 tipos do vocabulário (`strategic_lesson`, `decision_outcome`,
   `recurring_pattern`) existem no schema/tipos mas não têm nenhum fluxo
   de geração real ainda (correio.md seção 2: "não criar dezenas de
   tipos nesta versão" — cumprido deliberadamente).
6. **`sourceReviewId` nullable no schema, mas sempre preenchido na
   prática** — só um `memory_type` (`initiative_outcome`) é gerado nesta
   versão, e ele sempre nasce de uma review real. A nulidade é só para
   suportar evolução futura (item 5), não um estado alcançável hoje via
   nenhum fluxo real do sistema.

---

## Conclusão

Todos os 22 critérios da seção 28 do correio.md foram atendidos: memória
estratégica persistida; provenance rastreável (testado); evidência e
interpretação separadas (testado); Executive Review alimenta memória;
criação idempotente (testado); concorrência protegida (testado); falha
de provider com retry seguro (testado); nenhum lock/transaction durante
I/O externo (provado via `pg_stat_activity`); recuperação com limite
(testado); memórias arquivadas não contaminam contexto (testado);
evidência atual com precedência explícita (documentado + testado); LLM
sem poder de autorização (estrutural); memória nunca modifica Goals/
Initiatives (testado); memória nunca executa nada (testado); uso
auditável (testado); frontend distingue aprendizado histórico de decisão
obrigatória; backend completo passa (491/491); frontend completo passa
(82/82); typechecks limpos; build de produção passa; nenhuma arquitetura
paralela foi criada (Executor/Planner/Approval/Policy únicos, reaproveitados
em toda a extensão).

**NENHUM COMMIT foi realizado nesta sessão.** Todas as alterações desta
entrega permanecem no working tree, aguardando autorização final do
Diretor/CEO.
