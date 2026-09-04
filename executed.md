# Executado — v4.0: Operational Incident Collaboration & Activity Timeline

## 23.1 Descoberta

Revisados antes de qualquer implementação: `audit_logs`,
`agent_operational_incident_reviews` (v3.6), fila `Needs Attention`
(v3.7), `agent_operational_incident_assignments` (v3.8), workload/ownership
(v3.9), Escalations (v2.6), FollowUps (v2.7), `supervision-insights-service.ts`,
`incident-review-service.ts`, `incident-assignment-service.ts`,
serviços de escalation/follow-up, rotas de `/agents/operations`,
`SupervisionIncidentDetailDialog`, hooks React Query, RBAC e a convenção
de auditoria já usada no projeto. Respostas explícitas pedidas pela
seção 1:

1. **Quais eventos necessários já estão persistidos hoje?** Todos.
2. **Fonte canônica de cada tipo de evento** — ver seção 23.3 abaixo.
3. **`audit_logs` já contém informação suficiente?** Sim, para
   detecção/review/assignment — cada transição de review (v3.6,
   `agents.operations.incident_review.changed`) e de assignment (v3.8,
   `.assigned`/`.reassigned`/`.unassigned`) já é auditada INDIVIDUALMENTE,
   com ator real e `previousStatus`/`newStatus` (ou
   `previousAssigneeUserId`/`assigneeUserId`) no próprio `metadata` —
   histórico completo, nunca só o estado atual.
4. **Reviews e assignments já possuem timestamps/atores suficientes?**
   Sim — `actorUserId` é parâmetro obrigatório (não nullable) em
   `upsertIncidentReview`/`assignIncident`/`unassignIncident`; sempre o
   usuário humano real que agiu.
5. **Escalations/FollowUps têm relação inequívoca com o incidente?**
   Sim — `agentOperationalEscalations.metadata.incidentId` (a MESMA
   string `${incidentType}:${entityType}:${entityId}` já usada por
   `getSupervisionIncidentDetail` desde a v3.5) e
   `agentOperationalFollowUps.escalationId` (FK real) — nenhuma
   correlação heurística.
6. **Existe informação necessária que NÃO possa ser derivada?** Não.
7. **Existe necessidade real de migration?** Não.
8. **Risco de segunda fonte de verdade?** Nenhum — a timeline nunca
   persiste nada, é recomputada a cada leitura.
9. **A timeline pode ser obtida sem N+1?** Sim — número de queries fixo
   por incidente (nunca por evento), provado por teste instrumentado.
10. **Existe necessidade real de tabela de comentários/notas humanas?**
    **Não** (seção 23.2/2.2 detalha a justificativa).

**Nenhuma migration criada.**

## Notas humanas (correio.md seção 2.2) — decisão de NÃO implementar

Avaliados os 4 critérios exigidos antes de justificar uma tabela nova:

1. *Não existe estrutura persistente adequada hoje?* **Falso** —
   `agent_operational_incident_reviews.note` já é um campo de texto livre
   anexável a uma transição de review (v3.6), cobrindo parcialmente o
   caso de uso mais óbvio ("deixar contexto sobre o que está sendo
   feito").
2. Como o critério 1 já falha, os demais (2/3/4) não chegam a ser
   avaliados — o correio.md exige os 4 simultaneamente ("somente
   implementar... se a descoberta provar que" — lista, não "ou").

**Notas humanas NÃO foram implementadas nesta versão.** O tipo
`human_note` foi deliberadamente OMITIDO do vocabulário
`OperationalIncidentTimelineEventType` (correio.md seção 3: "`human_note`
só deve existir se notas forem realmente implementadas").

## 23.2 Timeline — eventos implementados

Todos os 8 tipos pedidos na seção 6, exceto `human_note` (não
implementado, ver acima):

`incident_detected`, `review_acknowledged`, `review_status_changed`,
`assigned`, `reassigned`, `unassigned`, `escalation_created`,
`follow_up_created`.

## 23.3 Fontes

```text
incident_detected      → audit_logs (agents.operations.incident.detected) — a própria linha do incidente
review_acknowledged     → audit_logs (agents.operations.incident_review.changed), quando previousStatus='unreviewed' ∧ newStatus='acknowledged'
review_status_changed   → audit_logs (agents.operations.incident_review.changed), qualquer outra transição
assigned                → audit_logs (agents.operations.incident.assigned)
reassigned              → audit_logs (agents.operations.incident.reassigned)
unassigned              → audit_logs (agents.operations.incident.unassigned)
escalation_created      → agent_operational_escalations (linha em si, createdAt) — vinculada por metadata.incidentId
follow_up_created       → agent_operational_follow_ups (linha em si, createdAt) — vinculada por escalationId → a escalation já encontrada
```

Todos os 3 eventos de review/assignment vêm do HISTÓRICO real de
`audit_logs` (uma linha por transição, já existente desde v3.6/v3.8) —
nunca reconstruídos a partir do valor corrente. `escalation_created`/
`follow_up_created` usam a linha da própria tabela (não seu audit
paralelo `agents.escalation.created`/`agents.followup.created`) porque
a linha já carrega tudo que a timeline precisa (createdAt, severidade,
alvo) sem depender do formato de metadata de um audit separado — mesmo
dado, fonte mais direta.

## 23.4 Estratégia anti-N+1

Para UM incidente (nunca uma lista — a timeline só existe no detalhe de
um item específico, mesmo padrão já aceito para `review`/`escalation`
desde a v3.5): **5 queries fixas**, nenhuma por evento:

1. audits relacionados por `entityType`/`entityId` (já existia, v3.5);
2. escalation vinculada por `incidentId` (já existia, v3.5);
3. review completo (já existia, v3.6);
4. **novo** — histórico de audits de review (`incidentAuditLogId` exato);
5. **novo** — histórico de audits de assignment (`incidentAuditLogId` exato);

mais **1 query condicional** (follow-ups, só quando existe escalation —
nunca executada à toa).

Testado com instrumentação real de `db.select`: um incidente com 1
evento e um com 7+ eventos (review + reassign + resolve + dismiss +
unassign) custam **exatamente o mesmo número de queries**.

## 23.5 Autorização

Nenhuma permission nova. A timeline vem embutida no MESMO endpoint de
detalhe (`GET .../supervision-insights/incidents/:auditLogId`), que já
usa `agents.operations.read` desde a v3.5 — nunca exige
`agents.operations.manage`. Testado explicitamente que uma chamada GET
não grava audit log, não altera review, não altera assignment.

## Decisão de endpoint (correio.md seção 7)

**Embutida no endpoint de detalhe já existente** (`SupervisionIncidentDetail.timeline`),
em vez de um endpoint dedicado `GET .../timeline`. Justificativa:

- `SupervisionIncidentDetailDialog` (frontend) sempre carrega review +
  assignment + timeline JUNTOS, na mesma abertura de diálogo — um
  endpoint dedicado geraria um segundo round-trip para uma view que já
  faz um primeiro fetch completo.
- `getSupervisionIncidentDetail` já busca a escalation e o review
  necessários para a timeline — reaproveitar essas mesmas variáveis
  (`escalationRow`, `row`) evita duplicar a query de escalation ou a
  validação de identidade do incidente.
- É usada exclusivamente no detalhe de UM item, nunca numa lista — o
  mesmo racional já aceito para `review`/`escalation` desde a v3.5 (não
  é uma lista paginada, então o custo extra de 2-3 queries por chamada é
  aceitável e nunca escala com volume).
- Correio.md seção 7 explicitamente permite essa alternativa ("ou
  integrar ao endpoint de detalhe já existente se isso for
  arquiteturalmente mais coerente").

## Ordenação (correio.md seção 5)

`occurredAt ASC`. Desempate determinístico, em código
(`sortOperationalIncidentTimelineEvents`, exportada e testada
isoladamente sem banco):

1. timestamp (`occurredAt`);
2. rank fixo do tipo de evento (detecção → assignment → review →
   escalation → follow-up — ordem causal esperada quando dois eventos de
   fontes diferentes empatam exatamente no mesmo instante);
3. o número da própria linha de origem (sufixo numérico do `id`, ex.
   `"review:123"` → `123`) — cada fonte já tem uma PK serial
   monotonicamente crescente.

Nunca depende da ordem incidental devolvida pelo Postgres.

## 23.6 Arquivos

### Criados
- `backend/src/agents/operations/incident-timeline.test.ts`

### Alterados
- `backend/src/agents/operations/supervision-insights-service.ts` — tipos `OperationalIncidentTimelineEvent(Type)`/`OperationalIncidentTimeline`, `sortOperationalIncidentTimelineEvents`, `SupervisionIncidentDetail.timeline`, lógica de montagem em `getSupervisionIncidentDetail`.
- `backend/src/routes/agents/operations.test.ts` — describe novo de autorização/read-only para o campo `timeline`.
- `frontend/types/agents.ts` — `OperationalIncidentTimelineEvent(Type)`, `SupervisionIncidentDetail.timeline`.
- `frontend/lib/agents/derived.ts` — `operationalIncidentTimelineEventLabel`.
- `frontend/components/agents/operations/supervision-insights-section.tsx` — `IncidentTimelineSection` (substitui a antiga lista plana "Referências de auditoria" no diálogo — a timeline já subsume essa informação com mais contexto).

Nenhuma rota nova no backend (`routes/agents/operations.ts` não mudou);
nenhum hook/service novo no frontend (o campo `timeline` chega
automaticamente no mesmo `getSupervisionIncidentDetail`/`useSupervisionIncidentDetail`
já existentes).

## 23.7 Testes

**`backend/src/agents/operations/incident-timeline.test.ts` (6 testes,
todos passando)**: incidente recém-detectado sem review/assignment/
escalation/follow-up mostra só o evento de detecção (itens 1/15/16/17);
ciclo completo acknowledge→assign→reassign→resolve→unassign aparece na
ordem cronológica exata com `from`/`to` corretos (itens 2/3/4/5/6);
escalation e follow-up relacionados aparecem quando o vínculo existe
(itens 7/8); eventos de outro incidente nunca vazam (item 9); ordenação
determinística mesmo com timestamps empatados, testada como função pura
sem banco, ordem de entrada não afeta o resultado (item 10); ausência de
N+1 via instrumentação real (item 18).

**`backend/src/routes/agents/operations.test.ts` (3 testes novos)**:
403 sem `agents.operations.read` (item 11); 200 com leitura, timeline
presente com o evento de detecção (item 12); GET não grava audit log
nem altera review/assignment (itens 13/14).

Nenhum teste frontend novo — `IncidentTimelineSection` é renderização
condicional sobre dados já validados no backend, sem lógica
client-side própria (correio.md seção 20: "adicionar testes frontend
somente se existir lógica nova relevante e testável").

Baseline pós-v3.9 descoberto no repositório (não assumido): **809 − 9 =
800/800** no backend antes desta rodada, **119/119** no frontend.

| Item | Resultado |
|---|---|
| Migration | **nenhuma criada** |
| Backend typecheck (`tsc --noEmit`) | limpo |
| Testes específicos da v4.0 (incident-timeline service + describe novo em operations.test.ts) | **9/9** |
| Suíte completa do backend (`--test-concurrency=1`) | **809/809** (800 + 9 novos — exatamente o esperado) |
| Frontend typecheck (`tsc --noEmit`) | limpo |
| Frontend lint (`eslint`) | limpo |
| Frontend testes (`node --test`) | **119/119** (baseline exata, nenhuma regressão) |
| Frontend build (`next build`, node 24) | sucesso (exit 0) |

Nenhuma divergência entre o total esperado e o observado.

## 23.8 Autonomia

**A v4.0 não aumentou autonomia operacional.** É estritamente leitura —
`getSupervisionIncidentDetail` (com o novo campo `timeline`) não escreve
em tabela nenhuma, não chama `audit()`, não invoca nenhum serviço de
mutação. Nenhum SLA, deadline, aging policy, breach detection, overdue,
score, prioridade nova, load balancing, capacidade, round-robin,
auto-(re)assignment, recomendação de responsável, equipe, LLM ou
resumo/classificação automática foi implementado — nenhum desses
conceitos existe no código desta versão. Ownership atual continua
vindo exclusivamente da v3.8 (`agent_operational_incident_assignments`
— a timeline nunca deriva o estado corrente pelo "último evento",
apenas exibe o histórico); workload continua vindo exclusivamente da
v3.9; review atual continua vindo exclusivamente da v3.6. A timeline
responde só "o que aconteceu, em que ordem, e quem fez" — nunca "está
atrasado?"/"quem deveria assumir?"/"quem está sobrecarregado?".

## 23.9 supervisor-guard.ts

**Permaneceu intacto.** `git diff --stat -- backend/src/agents/operations/supervisor-guard.ts`
vazio. Response Policy, Planner, Policy Evaluator, Executor, Circuit
Breaker, recovery, scheduler, detecção, decisão automática, escalation
automática e follow-up automático não foram tocados — validado pela
suíte completa (809/809) rodando todos os testes desses módulos sem
alteração.

## 23.10 Commit/deploy

Nenhum commit foi feito. Nenhum deploy. Relatório pronto para
aprovação.
