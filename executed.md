# Executado — v3.7: Operational Incident Review Queue & Attention Management

## 1. Análise de persistência e decisão sobre migration

Revisados antes de qualquer schema (seção "Descoberta obrigatória"):
`audit_logs`, `agent_operational_incident_reviews` (v3.6),
`supervision-insights-service.ts` (v3.5), `supervisor-service.ts`,
Supervision Run History (v3.4), Incident Review v3.5/v3.6, Escalations
v2.6, FollowUps v2.7, e o frontend atual de `/agents/operations`.

**Nenhuma migration foi criada.** A hipótese arquitetural do próprio
correio.md se confirmou: `audit_logs` (identidade canônica dos
incidentes, `agents.operations.incident.detected`) + `agent_operational_incident_reviews`
(v3.6, estado de review) + dados já derivados pela v3.5
(`enrichIncidentRows`: run de origem, outcome, escalation) bastam para a
fila inteira. Tudo o que a v3.7 precisa — recorrência, aging, prioridade
— é **derivável em tempo de leitura**:

- **Recorrência**: mesma chave `incidentType:entityType:entityId` já
  usada por `listRecurringIncidents` (v3.5); só passou a ser calculada
  em LOTE por linha (`recurrenceCount`/`isRecurring`), não só numa lista
  separada.
- **Aging**: calculado a partir de `detectedAt` (e `review.reviewedAt`
  para "tempo desde o reconhecimento") — nenhum contador, cronômetro ou
  timestamp artificial persistido, exatamente como pedido.
- **Prioridade**: uma função de comparação pura sobre campos já
  existentes (severidade/recorrência/reviewStatus/aging/id) — nenhum
  score persistido, nenhuma tabela de fila.

Nenhuma tabela nova, nenhuma segunda identidade de incidente, nenhum
cache de prioridade/aging/recorrência.

## 2. Regra exata da fila "Needs Attention"

Por default, `listAttentionQueue` devolve todo incidente
(`agents.operations.incident.detected`) cujo `reviewStatus` **não** seja
`resolved` nem `dismissed` — ou seja: `unreviewed` e `acknowledged`
aparecem sempre (seção "Escopo funcional": incidentes recorrentes,
antigos, de maior severidade e ainda não/parcialmente revisados já
caem naturalmente aqui, sem filtro extra — eles simplesmente ficam mais
acima na ordenação, ver seção 3).

`resolved`/`dismissed` ficam fora do default, mas continuam acessíveis
via **o mesmo parâmetro** `reviewStatus` informado explicitamente
(`?reviewStatus=resolved`/`?reviewStatus=dismissed`) — nunca um segundo
mecanismo de filtro/histórico paralelo; o histórico completo continua
sendo a seção "Insights de Supervisão" (v3.5) já existente.

## 3. Regra exata de ordenação/prioridade

Determinística, lexicográfica, 100% baseada em campos já expostos na
resposta (nunca um score opaco) — `compareAttentionPriority` em
`supervision-insights-service.ts`:

1. **Severidade** — `critical` > `warning` > `info`;
2. **Recorrência** — recorrente (`recurrenceCount > 1`) antes de não
   recorrente;
3. **Review pendente** — `unreviewed` > `acknowledged` > `resolved` >
   `dismissed` (usado só quando um filtro explícito traz os dois
   últimos para a fila);
4. **Aging** — mais antigo primeiro (`ageMs` decrescente);
5. **`auditLogId` ascendente** — desempate final estável e reproduzível
   (ids de `audit_logs` são monotonicamente crescentes com o tempo de
   detecção).

Nenhum uso de LLM, IA, embeddings ou classificação probabilística —
puro TypeScript síncrono sobre dados já em memória.

Cada item devolve `attentionReasons` (`unreviewed`/`acknowledged_pending`/
`recurring`/`high_severity`/`aging`) — a UI mostra exatamente por que
aquele incidente está na fila e (indiretamente, pela combinação
severidade/recorrência/review/idade já visíveis na linha) por que está
acima do próximo.

## 4. Definição de aging e limites dos buckets

Calculado em tempo de leitura a partir de `detectedAt` (nunca
persistido). Buckets fixos, limite esquerdo inclusivo / direito
exclusivo (convenção documentada em código, já que o correio.md não
especificava os limites — testada explicitamente nos 3 limites):

| Bucket | Regra |
|---|---|
| `<1h` | idade < 1h |
| `1h-4h` | 1h ≤ idade < 4h (idade === exatamente 1h cai aqui) |
| `4h-24h` | 4h ≤ idade < 24h (idade === exatamente 4h cai aqui) |
| `>24h` | idade ≥ 24h (idade === exatamente 24h cai aqui) |

Quando `reviewStatus === 'acknowledged'`, cada item também expõe
`sinceReviewMs`/`sinceReviewBucket` — mesmos buckets, mas contados a
partir de `review.reviewedAt` ("tempo desde o último
review/acknowledgement", pedido explicitamente pelo correio.md).
Nenhum SLA/obrigação contratual introduzida — só exibição.

Relógio injetável: `listAttentionQueue({ now })` — default `new Date()`
em produção, fixo nos testes (evita sleeps reais).

## 5. Endpoints alterados/criados

Endpoint **dedicado** (decisão avaliada e documentada em código): o
default de exclusão de `resolved`/`dismissed` e a ordenação por
prioridade são responsabilidades diferentes de "histórico paginado por
data" (o endpoint de incidentes da v3.5), mas reaproveitam 100% da
mesma infraestrutura de enriquecimento (`enrichIncidentRows`) e de
filtro pós-enriquecimento.

```
GET /agents/operations/supervision-insights/needs-attention
```

Filtros: `page`/`limit`, `dateFrom`/`dateTo`, `severity`, `incidentType`,
`outcome`, `reviewStatus` (ausente = default da fila), `recurringOnly`,
`agingBucket`, `entityType`/`entityId`. Todos combináveis.

Namespace coerente com o já existente
(`/agents/operations/supervision-insights/...`).

**Aditivo** ao endpoint já existente de histórico (v3.5), para reforçar
reuso de filtro (seção "Filtros": "evitar duplicar dois mecanismos"):
`GET /operations/supervision-insights/incidents` ganhou `outcome` e
`recurringOnly` como filtros opcionais — mesmos nomes/semântica usados
pela fila, mesma implementação de filtro pós-enriquecimento.

Nenhum endpoint existente teve contrato quebrado (`hasEscalation`,
`runStatus`, `reviewStatus` etc. continuam exatamente como antes).

## 6. Autorização

Nenhuma permission nova. Leitura da fila reaproveita `agents.operations.read`
(mesma de toda a seção `supervision-insights`, testado explicitamente:
403 sem ela). Ações de acknowledge/resolve/dismiss continuam
exclusivamente pela API de review da v3.6
(`PATCH .../incidents/:auditLogId/review`, `agents.operations.manage`)
— a fila em si não introduz nenhuma ação mutável nova.

## 7. Integração com v3.5/v3.6

- `listAttentionQueue` chama a MESMA `enrichIncidentRows` privada de
  `listSupervisionIncidents` (v3.5) — outcome, run de origem, escalation
  e review (v3.6) resolvidos de forma idêntica nos dois lugares.
- `recurrenceCount`/`isRecurring` passaram a ser calculados dentro de
  `enrichIncidentRows` e ficaram disponíveis também em
  `SupervisionIncidentSummary` (histórico da v3.5, aditivo).
- O clique numa linha da fila abre o MESMO diálogo de detalhe/review já
  usado pela seção "Insights de Supervisão"
  (`SupervisionIncidentDetailDialog`, exportado e reutilizado) — nenhuma
  segunda implementação de review no frontend, exatamente como exigido.
- Alterar um review pela API da v3.6 invalida a mesma chave de query da
  fila no React Query (`useUpdateIncidentReview`), então a projeção da
  fila reflete a mudança imediatamente, sem recarregar a página.

## 8. Estratégia usada para evitar N+1

`listAttentionQueue` busca até 500 audits `incident.detected` (mesma
janela pragmática já documentada em `listSupervisionIncidents` v3.5/v3.6
— aqui sempre aplicada, pois a fila é sempre pós-enriquecimento) e então
chama `enrichIncidentRows` **uma vez para a página inteira**, que por
sua vez já resolve run/outcome/escalation/review/recorrência em no
máximo 5 queries batched (`IN (...)`) — nunca uma consulta por
incidente. Confirmado por teste dedicado que instrumenta `db.select` e
compara o número de queries entre um lote de 2 incidentes e um de 9: **o
número de queries é idêntico nos dois casos** (prova de que o custo é
O(1) em relação ao volume de linhas, não O(n)).

## 9. Arquivos criados

- `backend/src/agents/operations/attention-queue-service.test.ts`
- `frontend/app/api/agents/operations/supervision-insights/needs-attention/route.ts`
- `frontend/components/agents/operations/attention-queue-section.tsx`

## 10. Arquivos alterados

- `backend/src/agents/operations/schemas.ts` — `attentionQueueQuerySchema`;
  `outcome`/`recurringOnly` adicionados a `listSupervisionIncidentsQuerySchema`.
- `backend/src/agents/operations/supervision-insights-service.ts` —
  `listAttentionQueue`, `AttentionQueueItem`, aging/prioridade/reasons,
  recorrência por linha em `enrichIncidentRows`, `entityType`/`entityId`
  como filtro da fila.
- `backend/src/routes/agents/operations.ts` — rota
  `GET .../needs-attention`; `recurringOnly`/`outcome` na rota de
  incidentes existente.
- `backend/src/routes/agents/operations.test.ts` — describe
  `GET /operations/supervision-insights/needs-attention` (autorização,
  filtros inválidos, filtros combinados).
- `frontend/app/(dashboard)/agents/operations/page.tsx` — seção
  "Needs Attention" antes do histórico completo.
- `frontend/components/agents/operations/supervision-insights-section.tsx` —
  `SupervisionIncidentDetailDialog` exportado para reuso.
- `frontend/components/agents/status-badge.tsx` — `AgingBucketBadge`.
- `frontend/hooks/agents/use-operations.ts` — `useAttentionQueue`;
  invalidação da fila em `useUpdateIncidentReview`.
- `frontend/lib/agents/derived.ts` — `agingBucketLabel`,
  `attentionReasonLabel`.
- `frontend/lib/query/keys.ts` — `attentionQueue`.
- `frontend/services/agents.ts` — `listAttentionQueue`,
  `ListAttentionQueueParams`.
- `frontend/types/agents.ts` — `AttentionQueueItem`, `AgingBucket`,
  `AttentionReason`, `recurrenceCount`/`isRecurring` em
  `SupervisionIncidentSummary`.

## 11. Testes adicionados

**`backend/src/agents/operations/attention-queue-service.test.ts`
(12 testes, todos passando)**, contra o Postgres real (audits
`incident.detected` inseridos diretamente com `createdAt` controlado —
mesma identidade canônica exigida pelo correio.md — para permitir
aging/ordenação/desempate 100% determinísticos, sem sleeps reais):
incidente `unreviewed` aparece por default; `acknowledged` continua
aparecendo, `resolved`/`dismissed` ficam fora por default mas acessíveis
via filtro explícito; severidade influencia a ordenação; recorrência
influencia a ordenação; os 5 casos de aging (`<1h`, exatamente 1h,
exatamente 4h, exatamente 24h, `>24h`); desempate determinístico por
`auditLogId`; filtros combinados; filtro por recorrência; filtro por
outcome; paginação preserva ordenação (concatenar páginas reproduz a
busca completa); ausência de N+1 (contagem de queries instrumentada,
igual para 2 e para 9 incidentes); review via v3.6 atualiza a projeção
da fila sem alterar outcome operacional nem a decisão do Supervisor.

**`backend/src/routes/agents/operations.test.ts` (4 testes novos)**:
403 sem `agents.operations.read`; 200 com só leitura (fila vazia com
filtro de data absurdo); 400 para `severity`/`agingBucket` inválidos;
200 com todos os filtros combinados na URL.

Total de testes novos: **16** — cobrindo os 23 itens obrigatórios da
seção "Testes obrigatórios" (os itens de autorização/histórico/detalhe
reaproveitam a cobertura já existente das rotas v3.5/v3.6, verificada
como não regredida).

## 12. Resultado completo da validação

Baseline pós-v3.6 descoberto no repositório (não assumido): **756/756**
no backend, **119/119** no frontend (mesmos números do relatório da
v3.6, confirmados antes de iniciar esta rodada).

| Item | Resultado |
|---|---|
| Migration | **nenhuma criada** (analisada e justificada, seção 1) |
| Backend typecheck (`tsc --noEmit`) | limpo |
| Testes específicos da v3.7 (`attention-queue-service.test.ts` + describe novo em `operations.test.ts`) | **16/16** |
| Suíte completa do backend (`--test-concurrency=1`) | **772/772** (756 + 16 novos) |
| Frontend typecheck (`tsc --noEmit`) | limpo |
| Frontend lint (`eslint`) | limpo |
| Frontend testes (`node --test`) | **119/119** (baseline exata, nenhuma regressão) |
| Frontend build (`next build`, node 24) | sucesso (exit 0) |
| `supervisor-guard.ts` | **intocado** (`git diff` vazio) |

## 13. Confirmação explícita

- `supervisor-guard.ts` **não foi alterado** (`git diff --stat` vazio
  para o arquivo).
- **Nenhum aumento de autonomia**: a v3.7 é leitura pura (projeção sobre
  `enrichIncidentRows`) mais ordenação/aging em memória — nenhuma
  mutação nova, nenhuma decisão automática, `applyResponse`/`Response Policy`/
  Planner/Executor/scheduler intocados.
- **Nenhum novo Circuit Breaker** criado ou alterado.
- **Nenhuma segunda identidade de incidente**: a identidade canônica
  continua sendo exclusivamente `audit_logs` com action
  `agents.operations.incident.detected` — `listAttentionQueue` consulta
  essa mesma tabela/ação, sem nenhuma tabela de fila persistida.
- **Nenhuma ação automática nova**: acknowledge/resolve/dismiss
  continuam exclusivamente na API de review da v3.6
  (`agents.operations.manage`); a fila em si expõe zero endpoints de
  escrita.
- Escalation, FollowUp, Recovery, advisory lock e o Operational
  Supervisor em si não foram tocados — validado pela suíte completa
  (772/772) rodando todos os testes desses módulos sem alteração.

Nenhum commit foi feito. Relatório pronto para aprovação.
