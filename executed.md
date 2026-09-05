# Agentes v4.2 — Operational SLA Analytics & Performance Visibility

**Status: IMPLEMENTADO.** `correio.md` não tinha sido executado antes desta
sessão (`executed.md` estava vazio) — v4.2 é uma versão nova, implementada
do zero abaixo. Nenhum commit foi realizado; working tree pronto para
revisão do Diretor/COO.

Data: 2026-09-05.

---

## 1. Resultado da descoberta (correio.md seção 1)

Revisão de código feita ANTES de qualquer implementação, cobrindo todos os
itens obrigatórios: `audit_logs`, `agent_operational_incident_reviews`,
`agent_operational_incident_assignments`, SLA da v4.1 (`computeIncidentSla`,
`sla-settings.ts`), timeline v4.0 (`getSupervisionIncidentDetail`), fila
Needs Attention (v3.7), workload/ownership v3.9, `supervision-insights-service.ts`,
`incident-review-service.ts`, `incident-assignment-service.ts`, endpoints
atuais de `routes/agents/operations.ts`, tipos frontend (`types/agents.ts`),
componentes de `/agents/operations`, RBAC (`agents.operations.read`/`.manage`)
e utilitários existentes de paginação/data (`helpers.ts`, `schemas.ts`).

Respostas às 10 perguntas obrigatórias:

1. **Os dados necessários já existem?** Sim. Nenhum estado novo. Tudo é
   derivável de `audit_logs` (identidade do incidente — `agents.operations.incident.detected`)
   e `agent_operational_incident_reviews` (`status`/`reviewed_at` = fato do
   fechamento), exatamente a mesma premissa que `computeIncidentSla`/
   `enrichIncidentRows` já usam desde a v4.1.
2. **Algum indicador exige estado novo persistido?** Não. Breach rate,
   médias/medianas, série temporal e breakdowns são agregações em tempo de
   leitura.
3. **É necessária migration?** **Não.** Nenhuma migration foi criada.
4. **Timestamps canônicos:**
   - **detecção** → `audit_logs.created_at` do `incident.detected` (identidade
     única do incidente desde a v3.5);
   - **acknowledgement** → primeira transição real `unreviewed → acknowledged`
     no audit trail de review (v3.6), resolvida em LOTE por uma nova função
     (`getFirstAcknowledgedAtByAuditLogIds`) — nunca inferida do status
     corrente;
   - **assignment** (para o breakdown por responsável) → o audit trail de
     assign/reassign/unassign (v3.8), reconstruído para achar quem estava
     atribuído NO MOMENTO do fechamento — nunca o assignment corrente
     (`agent_operational_incident_assignments`, que pode ter mudado depois
     de o incidente já estar fechado);
   - **fechamento** → `agent_operational_incident_reviews.reviewed_at` quando
     `status` é `resolved`/`dismissed` (mesma premissa de
     `enrichIncidentRows`/`getSupervisionIncidentDetail`, v4.1: o campo é
     sempre reescrito na ÚLTIMA transição);
   - **deadline** → `computeIncidentSla` (v4.1), a MESMA fórmula
     (`detectedAt + slaMinutesBySeverity[severity]`), nunca uma segunda
     política reimplementada.
5. **É possível calcular os indicadores diretamente dos dados existentes?**
   Sim, sem reconstrução heurística.
6. **O volume esperado permite agregação em tempo de leitura?** Sim — sistema
   operacional interno de uma agência (mesma escala já assumida pela janela
   de 500 linhas de `listSupervisionIncidents`, v3.6/v3.7). Documentado como
   limitação conhecida caso o volume real um dia justifique agregação 100%
   em SQL.
7. **Existe risco de N+1?** Eliminado por design — nenhuma query depende da
   quantidade de incidentes retornados (ver seção 10 abaixo). Testado
   explicitamente (2 testes de N+1, um por nível: serviço e função pura).
8. **Algum indicador requer reconstrução histórica via `audit_logs`?** Sim —
   exatamente duas: o acknowledgement exato (item 4 acima) e o assignee no
   momento do fechamento (seção 9 abaixo). Ambas já são leituras de
   `audit_logs` já existentes (v3.6/v3.8), nunca um novo tipo de evento.
9. **Diferença entre métricas de incidentes abertos e fechados?**
   `incidents.detected`/`incidents.open`/`bySeverity[*].detected` são
   escopados por `detectedAt` (coorte de ENTRADA); `incidents.closed`/`sla.*`/
   `resolution.*`/`bySeverity[*].closed|withinSla|outsideSla|breachRate` são
   escopados por `closedAt` (coorte de SAÍDA) — um incidente detectado ANTES
   do período mas fechado DENTRO dele entra nas métricas de fechamento, não
   nas de entrada, e vice-versa. `openSla` é uma FOTOGRAFIA atual,
   deliberadamente independente do período pedido (ver seção 5 abaixo).
10. **Quais métricas seriam semanticamente incorretas sem um intervalo
    temporal explícito?** Todas as agregadas (breach rate, médias/medianas,
    tendência) — sem um período, misturariam incidentes de qualquer época,
    tornando a tendência impossível de interpretar. Por isso o endpoint
    sempre resolve e ECOA um período explícito em `data.period`.

---

## 2. Decisão sobre migration

**Nenhuma migration criada.** Toda a v4.2 é uma camada de leitura sobre
tabelas já existentes desde a v1.x/v3.6/v3.8 (`audit_logs`,
`agent_operational_incident_reviews`) e sobre a config já criada pela v4.1
(`settings` → `agents_operational_sla_minutes_by_severity`). Nenhum valor
derivado (breach rate, médias, medianas, séries temporais, rankings,
contadores derivados, snapshots) foi persistido em lugar nenhum — todos são
recalculados a cada requisição.

---

## 3. Fontes canônicas utilizadas

| Dado | Fonte canônica |
|---|---|
| Identidade do incidente | `audit_logs` (`action = 'agents.operations.incident.detected'`) |
| `detectedAt` | `audit_logs.created_at` do `incident.detected` |
| `severity` | `audit_logs.metadata->>'severity'` |
| `reviewStatus` corrente | `agent_operational_incident_reviews.status` (ausência = `unreviewed`, v3.6) |
| `closedAt` | `agent_operational_incident_reviews.reviewed_at` quando `status` é `resolved`/`dismissed` |
| `acknowledgedAt` (primeira transição) | `audit_logs` (`action = 'agents.operations.incident_review.changed'`, `metadata.previousStatus='unreviewed'`, `metadata.newStatus='acknowledged'`) |
| Assignee no fechamento | `audit_logs` (`action IN (assigned, reassigned, unassigned)`, reconstruído cronologicamente) |
| Minutos de SLA por severidade | `settings` (`agents_operational_sla_minutes_by_severity`, v4.1) |
| Política de deadline/breach | `computeIncidentSla` (v4.1, `supervision-insights-service.ts`) — reaproveitada, nunca reimplementada |

---

## 4. Definição formal de cada métrica

- **`incidents.detected`**: nº de `incident.detected` com `detectedAt ∈ [from,to]` (+ `severity` se filtrado).
- **`incidents.closed`**: nº de incidentes com `status ∈ {resolved,dismissed}` E `reviewed_at ∈ [from,to]`, independente de quando foram detectados.
- **`incidents.open`**: dos incidentes DETECTADOS no período, quantos ainda não estão em `resolved`/`dismissed` — coorte de entrada, não fotografia global.
- **`sla.completedWithinSla` / `completedOutsideSla`**: para cada incidente fechado no período, `closedAt <= deadlineAt` → within; `closedAt > deadlineAt` → outside. `deadlineAt` vem de `computeIncidentSla` (nunca uma segunda fórmula). **Nunca** derivado de `sla.status` (que colapsa tudo em `completed`).
- **`sla.breachRate`**: `outsideSla / (withinSla + outsideSla)`; `null` se denominador zero.
- **`acknowledgement.{count,averageSeconds,medianSeconds}`**: sobre a coorte de ENTRADA (incidentes detectados no período) que têm uma transição real `unreviewed→acknowledged`; `acknowledgementSeconds = acknowledgedAt - detectedAt`. Incidentes sem acknowledgement não entram na média/mediana (só no denominador implícito de "detected").
- **`resolution.{count,averageSeconds,medianSeconds}`**: sobre a coorte de SAÍDA (incidentes fechados no período); `resolutionSeconds = closedAt - detectedAt`. `resolved` e `dismissed` tratados de forma idêntica (mesma decisão já vigente em `computeIncidentSla` desde a v4.1 — nenhuma distinção semântica encontrada nos contratos existentes).
- **`bySeverity[severity]`**: os mesmos campos acima, recortados por severidade — nenhuma query adicional (reaproveita os arrays já carregados).
- **`openSla.{withinSla,warning,breached}`**: fotografia CORRENTE (não escopada por período) de todo incidente ainda não terminal, classificado via `computeIncidentSla(...).status` (nunca uma segunda política).
- **`trend[]`**: um ponto por dia UTC no intervalo `[from,to]` (zero-filled), com `detected`/`closed`/`withinSla`/`outsideSla` — calculado em memória a partir dos mesmos dados já carregados, sem query extra. Teto de 366 pontos.
- **`byAssignee[]`**: só incidentes fechados no período cujo responsável NO MOMENTO DO FECHAMENTO é inequívoco (ver seção 9 abaixo).

---

## 5. Distinção entre SLA histórico e SLA corrente

- **SLA histórico** (`sla.completedWithinSla`/`completedOutsideSla`/`breachRate`,
  `resolution.*`, `bySeverity[*]`): sempre sobre incidentes JÁ FECHADOS,
  escopado pelo período `[from,to]` pedido.
- **SLA corrente** (`openSla`): fotografia de TODOS os incidentes ainda
  abertos no sistema, **deliberadamente independente do período** —
  respondendo literalmente à seção 13: "esses números representam o estado
  no momento da consulta", nunca uma janela histórica. Mesmo racional já
  aceito por `getOperationalOwnershipWorkload` (v3.9), que também não
  recebe `dateFrom`/`dateTo`. Documentado em código e na UI (bloco "Current
  Open SLA" com nota explícita de que é uma fotografia separada do breach
  rate histórico acima dele).

---

## 6. Estratégia de intervalo temporal

`from`/`to` opcionais no endpoint — quando omitidos, default de 7 dias
(mesmo padrão já usado por `GET /operations/summary` desde a v1.6). A
resposta sempre ECOA o período EXATO resolvido em `data.period`, nunca
deixando o cliente sem saber qual janela foi usada. `from > to` → 400
(mesmo `.refine()` já usado por `operationsSummaryQuerySchema`). Frontend
oferece presets (24h/7d/30d/personalizado) — todo o cálculo de datas
acontece no cliente, mas sempre resolvido para ISO explícito antes de
chamar o backend (nunca um período implícito trafega pela rede).

---

## 7. Estratégia para média/mediana

Duas funções puras, sem I/O, exportadas e testadas isoladamente
(`sla-analytics-service.ts`):

```ts
computeMean(values): number | null   // [] → null; arredonda ao segundo inteiro mais próximo
computeMedian(values): number | null // [] → null; par → média dos dois centrais; ímpar → central exato
computeBreachRate(within, outside): number | null // denominador 0 → null
```

Todos os 4 casos obrigatórios do correio.md (`[]→null`, `[10]→10`,
`[10,20]→15`, `[10,20,30]→20`) cobertos + casos extras (outlier, ordem de
entrada não-ordenada, arredondamento).

---

## 8. Estratégia de severidade

`OPERATIONAL_SEVERITIES` (`info`/`warning`/`critical`, health-types.ts)
reaproveitado — nenhum vocabulário novo (`high`/`medium`/`low` nunca
introduzidos). `bySeverity` inclui detected/closed/within/outside/breach
**e também** ack/resolution avg/median (seção 9 do correio.md: "se for
simples, incluir também" — era simples, mesmos arrays já em memória,
filtrados por severidade).

---

## 9. Decisão sobre analytics por responsável

Pergunta obrigatória respondida: **"O assignment atual da v3.8 representa
quem efetivamente tratou o incidente historicamente?"** — **Não
necessariamente**: `agent_operational_incident_assignments` guarda só o
estado CORRENTE (upsert sobrescreve), e o próprio docblock de
`incident-assignment-service.ts` documenta que um incidente
resolved/dismissed pode ser reatribuído depois, só para "contexto
histórico".

Por isso, a v4.2 **não usa o assignment corrente** para o breakdown por
responsável. Em vez disso, reconstrói — a partir do audit trail já existente
de assign/reassign/unassign (v3.8) — quem era o responsável **no exato
momento do fechamento** (`resolveAssigneeAtClose`, uma única query em lote
para todo o período, nunca uma por incidente). Incidentes fechados sem
NENHUM assignment inequívoco no momento do fechamento (nunca atribuídos, ou
cujo último evento antes do fechamento foi um `unassigned`) são
**excluídos** do breakdown — nunca uma atribuição retroativa/falsa (seção
10: "implementar apenas métricas cuja autoria seja inequívoca").

Testado explicitamente: reatribuição POSTERIOR ao fechamento não contamina
o histórico (teste 18 da integração).

`displayName` é sempre `null` no contrato — a resolução de nome é
deliberadamente deixada para o frontend via o MESMO `useUsersDirectory` já
usado para `assignment`/`reviewedBy` em todo o resto do módulo (nunca uma
segunda estratégia de resolução de nomes/join batched).

**Nenhum ranking**: `byAssignee` é ordenado por `userId` ascendente — nunca
por contagem/desempenho (correio.md seção 11 proíbe explicitamente
score/leaderboard/ranking de pessoas).

---

## 10. Estratégia anti-N+1

Exatas **6 queries**, sempre, independente do volume de incidentes no
período:

1. `fetchDetectedRows` — 1 query (LEFT JOIN com review).
2. `fetchClosedRows` — 1 query (INNER JOIN com review).
3. `getOperationalSlaMinutesBySeverity` — 1 query (config).
4. `getOpenSlaSnapshot` — 1 query (fotografia global de abertos).
5. `getFirstAcknowledgedAtByAuditLogIds` — 1 query agregada (`MIN(created_at) GROUP BY`) em lote para TODOS os incidentes detectados no período.
6. `resolveAssigneeAtClose` — 1 query em lote (só quando há incidentes fechados) para TODOS os eventos de assignment relevantes.

Todo o resto (médias, medianas, breakdown por severidade, tendência,
breakdown por responsável) é reconstruído **em memória** a partir desses 6
resultados — nenhuma query adicional por incidente, por severidade ou por
usuário.

**Testado explicitamente** (instrumentação de `db.select`, mesmo padrão já
usado pela v4.1 em `incident-sla.integration.test.ts`): número de queries
com 1 incidente === número de queries com 9 incidentes.

---

## 11. Endpoint

```
GET /agents/operations/sla-analytics?from=...&to=...&severity=...
```

- Permission: `agents.operations.read` (nenhuma nova permission criada —
  seção 21 do correio.md).
- 100% read-only — nenhum audit log é gravado (testado explicitamente).
- Único endpoint agregado (seção 14: "evitar múltiplos endpoints que
  executem as mesmas leituras separadamente").

---

## 12. Contratos

Backend (`backend/src/agents/operations/sla-analytics-service.ts`) e
frontend (`frontend/types/agents.ts`) espelham 1:1:

```ts
interface OperationalSlaAnalytics {
  period: { from: string; to: string };
  incidents: { detected: number; closed: number; open: number };
  sla: { completedWithinSla: number; completedOutsideSla: number; breachRate: number | null };
  acknowledgement: { count: number; averageSeconds: number | null; medianSeconds: number | null };
  resolution: { count: number; averageSeconds: number | null; medianSeconds: number | null };
  bySeverity: Record<OperationalSeverity, OperationalSlaSeverityBreakdown>;
  openSla: { withinSla: number; warning: number; breached: number };
  trend: OperationalSlaTrendPoint[];
  byAssignee: OperationalSlaAssigneeAnalytics[];
}
```

Única divergência deliberada do exemplo conceitual do correio.md:
`OperationalSlaAssigneeAnalytics.userId` é `number` (não `string`) — mesma
convenção já usada por TODO o resto do módulo (`assigneeUserId`/`reviewedBy`
sempre `number`).

---

## 13. Arquivos criados

**Backend**
- `backend/src/agents/operations/sla-analytics-service.ts` (588 linhas) — funções puras + serviço agregado.
- `backend/src/agents/operations/sla-analytics.test.ts` (83 linhas) — 15 testes de agregação pura.
- `backend/src/agents/operations/sla-analytics.integration.test.ts` (434 linhas) — 16 testes de integração (Postgres real).

**Frontend**
- `frontend/app/api/agents/operations/sla-analytics/route.ts` — proxy BFF fino.
- `frontend/components/agents/operations/sla-analytics-section.tsx` (343 linhas) — UI (cards + tabelas).

## 14. Arquivos alterados

- `backend/src/agents/operations/incident-review-service.ts` — nova função em lote `getFirstAcknowledgedAtByAuditLogIds`.
- `backend/src/agents/operations/schemas.ts` — `slaAnalyticsQuerySchema`.
- `backend/src/routes/agents/operations.ts` — rota `GET /operations/sla-analytics`.
- `backend/src/routes/agents/operations.test.ts` — 10 testes de borda HTTP.
- `frontend/types/agents.ts` — contratos `OperationalSlaAnalytics` e correlatos.
- `frontend/services/agents.ts` — `getOperationalSlaAnalytics`.
- `frontend/hooks/agents/use-operations.ts` — `useOperationalSlaAnalytics`.
- `frontend/lib/query/keys.ts` — chave `slaAnalytics`.
- `frontend/lib/agents/derived.ts` — `formatOperationalDuration`, `formatOperationalPercentage`.
- `frontend/lib/agents/derived.test.ts` — 14 testes novos dos formatadores.
- `frontend/app/(dashboard)/agents/operations/page.tsx` — seção "Analytics de SLA" adicionada.
- `README.md` / `frontend/README.md` — **não relacionados à v4.2**: correção das portas do Docker Compose (3300/8300/5679), feita antes desta implementação, na mesma sessão, a pedido do usuário para liberar a porta 3000.

---

## 15. Testes novos (41 no total)

| Arquivo | Testes |
|---|---|
| `sla-analytics.test.ts` (pura) | 15 |
| `sla-analytics.integration.test.ts` (serviço, Postgres real) | 16 |
| `operations.test.ts` (borda HTTP) | 10 |
| `derived.test.ts` (frontend, formatadores) | 14* |

\* `formatOperationalDuration` (9) + `formatOperationalPercentage` (5) = 14.

Cobertura dos itens obrigatórios da seção 19 (backend): média sem
valores/com valores/mediana par/ímpar, breach rate sem denominador/válido,
dentro/fora do SLA, resolved/dismissed, ack correto/sem ack, intervalo
temporal, severidades, open SLA states, consistência com SLA v4.1, ausência
de N+1, isolamento entre incidentes, 403/200/validação de from/to/from>to,
GET sem audit, retorno vazio válido — **todos cobertos**.

Isolamento das fixtures de integração: como a maioria dos testes usa
igualdade EXATA (não `>=`), cada teste (exceto o de "open SLA", que precisa
do relógio real) ancora seus timestamps ~25 anos no passado, em slots
únicos de 7 dias — nunca colide com incidentes reais gerados por outros
arquivos de teste do mesmo processo (backend roda com
`--test-concurrency=1`, mas SEM esse isolamento uma janela relativa a "agora"
seria vulnerável a incidentes reais produzidos por `operations.test.ts`,
supervisor tests etc.).

---

## 16. Baseline anterior descoberto

834 testes passando (0 falhas) antes desta implementação — verificado ao
início desta sessão, após rodar o seed de permissões que a máquina nova
ainda não tinha.

## 17. Total final de testes

**875 testes, 875 passando, 0 falhas** (834 baseline + 41 novos). Suíte
completa rodada duas vezes: uma vez isolada (só os arquivos novos) e uma
vez completa (todos os 147 suites do backend).

## 18. Resultado de typecheck/lint/build

| Etapa | Resultado |
|---|---|
| Backend `tsc --noEmit` | ✅ limpo |
| Backend `tsc -p tsconfig.build.json` (build) | ✅ limpo |
| Frontend `tsc --noEmit` | ✅ limpo |
| Frontend `eslint` | ✅ limpo (0 erros, 0 avisos) |
| Frontend `npm test` | ✅ 139/139 |
| Frontend `next build` | ✅ concluído com sucesso, rota `/api/agents/operations/sla-analytics` presente no manifesto |

## 19. Confirmação de GET read-only

Confirmado por teste dedicado (`operations.test.ts`): contagem de
`audit_logs` antes/depois de `GET /operations/sla-analytics` é idêntica.
Nenhuma escrita em nenhuma tabela.

## 20. Confirmação de que nenhum estado derivado foi persistido

Confirmado — nenhuma migration, nenhuma tabela nova, nenhuma escrita.
Breach rate, médias, medianas, séries temporais, breakdown por
severidade/responsável: todos recalculados a cada requisição, em memória,
a partir de `audit_logs`/`agent_operational_incident_reviews`/`settings`.

## 21. Confirmação de que nenhuma autonomia foi adicionada

Confirmado — v4.2 não cria autoassignment, não altera prioridade de fila,
não reatribui incidentes, não fecha incidentes, não escala
automaticamente, não cria follow-up automaticamente, não dispara ações por
breach, não cria scheduler de SLA, não altera autonomia, não usa LLM. É
estritamente um endpoint `GET` de leitura agregada.

## 22. Confirmação de que `supervisor-guard.ts` permaneceu intacto

Confirmado via `git diff --stat -- backend/src/agents/operations/supervisor-guard.ts`
— nenhuma alteração, arquivo não aparece no diff.

## 23. Confirmação de que nenhum commit foi realizado

Confirmado — `git status` mostra apenas arquivos modificados/novos no
working tree; nenhum `git commit` foi executado nesta sessão. Working tree
pronto para revisão do Diretor/COO.
