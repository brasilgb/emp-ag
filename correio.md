# Agentes v4.0 — Operational Incident Collaboration & Activity Timeline

## 0. Objetivo

Implementar uma visão consolidada e cronológica da atividade de um incidente operacional, permitindo que supervisores entendam:

* quando o incidente foi detectado;
* quando foi reconhecido;
* como seu estado de review evoluiu;
* quem assumiu sua responsabilidade;
* quando houve assign, reassign ou unassign;
* quais escalations e follow-ups relacionados ocorreram;
* quem executou cada ação;
* quando cada ação aconteceu;
* quais eram os valores anterior e novo quando houver transição de estado.

A v4.0 é uma camada de **rastreabilidade e colaboração humana** sobre capacidades já existentes.

Ela NÃO deve aumentar autonomia operacional nem alterar mecanismos automáticos existentes.

---

# 1. Descoberta arquitetural obrigatória antes de qualquer implementação

Antes de criar schema, migration, serviço, rota ou componente novo, revisar obrigatoriamente:

* `audit_logs`;
* `agent_operational_incident_reviews` — v3.6;
* fila `Needs Attention` — v3.7;
* `agent_operational_incident_assignments` — v3.8;
* workload/ownership — v3.9;
* Escalations — v2.6;
* FollowUps — v2.7;
* `supervision-insights-service.ts`;
* `incident-review-service.ts`;
* `incident-assignment-service.ts`;
* serviços de escalation/follow-up;
* rotas atuais de `/agents/operations`;
* `SupervisionIncidentDetailDialog`;
* hooks React Query envolvidos;
* RBAC atual;
* estrutura e convenções de auditoria já usadas no projeto.

Responder explicitamente no relatório final:

1. Quais eventos necessários para a timeline já estão persistidos hoje?
2. Qual é a fonte canônica de cada tipo de evento?
3. `audit_logs` já contém informação suficiente para reconstruir alguma ou todas as transições?
4. Reviews e assignments já possuem timestamps/atores suficientes?
5. Escalations e FollowUps possuem relação inequívoca com o incidente original?
6. Existe alguma informação necessária à timeline que NÃO possa ser derivada das estruturas atuais?
7. Existe necessidade real de migration?
8. Há risco de criar uma segunda fonte de verdade caso novos registros sejam persistidos?
9. A timeline pode ser obtida sem N+1?
10. Existe necessidade real de uma tabela específica de comentários/notas humanas?

Não criar migration antes de responder essas perguntas por meio da análise do repositório real.

---

# 2. Regra de persistência

## 2.1 Eventos já existentes

É proibido criar uma nova tabela para duplicar eventos que já possuem fonte canônica.

Exemplos:

* detecção do incidente;
* acknowledge;
* mudança de review status;
* assign;
* reassign;
* unassign;
* escalation;
* follow-up.

A timeline deve consolidar esses eventos a partir das estruturas já existentes.

Não criar uma tabela genérica de timeline contendo cópias desses eventos.

A timeline é uma **projeção de leitura**, não uma nova fonte de verdade.

---

## 2.2 Notas/comentários humanos

Notas humanas são opcionais nesta versão.

Somente implementar comentários/notas se a descoberta provar que:

1. não existe estrutura persistente adequada atualmente;
2. `audit_logs` não deve semanticamente representar conteúdo colaborativo;
3. uma nota é realmente um conceito independente dos estados já existentes;
4. existe uso claro no detalhe do incidente.

Se uma tabela nova for necessária, documentar ANTES da migration:

* por que estruturas existentes não servem;
* por que a informação não pode ser derivada;
* por que `audit_logs` não é suficiente;
* qual será a relação com o incidente;
* política de edição/exclusão;
* autoria;
* timestamps;
* autorização;
* comportamento de auditoria.

Preferência arquitetural, caso notas sejam necessárias:

* append-only;
* nota não substitui nem altera review;
* nota não altera ownership;
* nota não altera escalation;
* nota não muda prioridade;
* nota não aciona automações;
* nota não pode ser interpretada por LLM nesta versão.

Se não houver justificativa forte, NÃO implementar notas na v4.0.

---

# 3. Contrato conceitual da timeline

Criar um contrato de leitura equivalente conceitualmente a:

```ts
type OperationalIncidentTimelineEventType =
  | 'incident_detected'
  | 'review_acknowledged'
  | 'review_status_changed'
  | 'assigned'
  | 'reassigned'
  | 'unassigned'
  | 'escalation_created'
  | 'follow_up_created'
  | 'human_note';

interface OperationalIncidentTimelineEvent {
  id: string;
  type: OperationalIncidentTimelineEventType;
  occurredAt: string;

  actorUserId: number | null;

  from?: string | number | null;
  to?: string | number | null;

  metadata?: Record<string, unknown>;
}

interface OperationalIncidentTimeline {
  incidentAuditLogId: number;
  events: OperationalIncidentTimelineEvent[];
}
```

O contrato real deve seguir as convenções existentes do projeto.

Não introduzir campos artificiais apenas para satisfazer este exemplo.

`human_note` só deve existir se notas forem realmente implementadas.

---

# 4. Identidade canônica do incidente

A timeline deve utilizar a mesma identidade canônica já usada nas versões v3.5–v3.9.

Não criar:

* novo incident ID;
* novo UUID paralelo;
* chave artificial de timeline;
* segunda tabela de incidentes;
* novo conceito de ocorrência.

Todas as fontes agregadas devem convergir para o mesmo incidente operacional já existente.

---

# 5. Ordenação

A timeline deve ser estritamente cronológica.

Default:

```text
occurredAt ASC
```

Em empate de timestamp, aplicar desempate determinístico.

Não depender da ordem incidental retornada pelo PostgreSQL.

O desempate pode utilizar identificador persistente ou outro critério estável já existente.

Documentar o critério escolhido.

---

# 6. Eventos obrigatórios

## 6.1 Incident detected

A primeira ocorrência deve derivar da fonte canônica de:

```text
agents.operations.incident.detected
```

Não persistir cópia.

---

## 6.2 Review acknowledged

Quando um incidente muda de não reconhecido para reconhecido, representar o evento correspondente.

Mostrar:

* ator;
* timestamp;
* estado anterior, se disponível;
* estado novo.

Não inferir ator inexistente.

Se a persistência atual não registrar ator de uma transição histórica, retornar `null` ou equivalente explícito em vez de inventar informação.

---

## 6.3 Review status changed

Representar mudanças reais do workflow de review.

Exemplos:

```text
unreviewed → acknowledged
acknowledged → resolved
acknowledged → dismissed
```

Usar exatamente o vocabulário existente.

Não criar status novos.

---

## 6.4 Assignment

Representar:

* assign;
* reassign;
* unassign.

Quando disponível, mostrar:

```text
fromUserId → toUserId
```

Exemplos:

```text
null → 42
42 → 87
87 → null
```

Não confundir ownership atual com histórico de ownership.

A tabela de assignment v3.8 representa o estado corrente; verificar onde o histórico da transição já está auditado.

Não tentar reconstruir histórico completo apenas do valor corrente.

---

## 6.5 Escalations

Exibir escalations relacionadas ao incidente quando a relação for inequívoca.

Não criar associação heurística.

Não relacionar registros apenas por proximidade temporal, texto parecido ou usuário.

Se não existir uma relação persistente confiável, documentar a limitação em vez de inventar ligação.

---

## 6.6 FollowUps

Mesma regra de escalations.

Só integrar quando houver vínculo determinístico com o incidente.

---

# 7. Backend

Preferencialmente implementar a leitura no mesmo domínio das supervision insights ou no serviço já responsável pelo detalhe do incidente, dependendo da arquitetura encontrada.

Exemplo de função:

```ts
getOperationalIncidentTimeline(incidentAuditLogId)
```

Não criar serviço paralelo se um serviço existente já for o lugar natural.

Endpoint preferencial:

```text
GET /agents/operations/supervision-insights/incidents/:incidentAuditLogId/timeline
```

ou integrar ao endpoint de detalhe já existente se isso for arquiteturalmente mais coerente.

A escolha deve ser justificada no relatório.

Não multiplicar endpoints sem necessidade.

---

# 8. Estratégia anti-N+1

A timeline deve ser resolvida com número constante ou limitado de queries.

Proibido:

```ts
for (event of events) {
  await db.query(...)
}
```

Proibido:

* query por assignment;
* query por usuário;
* query por escalation;
* query por follow-up;
* query por evento.

Preferir:

* joins;
* CTE;
* `UNION ALL`;
* queries batched;
* carregamento consolidado;
* agregação determinística em memória após poucas queries.

A quantidade de queries não pode crescer linearmente conforme a quantidade de eventos.

Adicionar teste ou instrumentação que demonstre ausência de N+1 se houver risco relevante.

---

# 9. Usuários e identidade visual

Os nomes dos atores/responsáveis devem ser resolvidos usando o diretório de usuários já existente.

Não criar request HTTP por usuário.

Preferir retornar IDs no backend e resolver nomes no frontend via estrutura já existente, se este for o padrão atual.

Não duplicar cache ou endpoint de usuários.

---

# 10. Frontend

Integrar a timeline ao:

```text
SupervisionIncidentDetailDialog
```

ou ao componente que atualmente representa o detalhe do incidente, caso tenha sido refatorado.

A timeline deve aparecer dentro da experiência atual de Incident Review.

Não criar uma segunda página de incidente apenas para a timeline.

---

## 10.1 Estrutura visual

Usar componentes e identidade visual já presentes.

Mostrar cada item com:

* tipo da atividade;
* data/hora;
* ator;
* descrição;
* mudança anterior → nova quando aplicável.

Exemplos conceituais:

```text
Incidente detectado
04/09/2026 14:31

João Silva reconheceu o incidente
04/09/2026 14:35

Responsável alterado
Maria Souza → Carlos Lima
04/09/2026 14:42

Status alterado
acknowledged → resolved
04/09/2026 15:03
```

Evitar excesso de cards independentes.

Preferir uma timeline vertical simples e legível.

---

# 11. Estado vazio e dados incompletos

Se só existir o evento de detecção, mostrar normalmente.

Não exibir erro apenas porque o incidente não possui review, assignment, escalation ou follow-up.

Dados opcionais devem ser tratados como opcionais.

Se ator histórico não puder ser determinado:

```text
Ator não disponível
```

ou equivalente visual coerente.

Nunca inventar usuário.

---

# 12. Autorização

A timeline é leitura operacional.

Usar:

```text
agents.operations.read
```

ou a permission de leitura já utilizada pelo detalhe do incidente.

Não exigir `agents.operations.manage` para visualizar histórico.

Caso notas humanas sejam implementadas:

* avaliar se `agents.operations.manage` já representa corretamente a escrita;
* não criar permission nova automaticamente;
* nova permission exige justificativa semântica explícita.

---

# 13. Auditoria

Chamadas GET da timeline devem ser estritamente read-only.

Uma leitura da timeline:

* não cria `audit_logs`;
* não altera review;
* não altera assignment;
* não atualiza `updated_at`;
* não dispara escalation;
* não cria follow-up;
* não produz side effects.

Se notas forem implementadas, criação de nota deve seguir a convenção de auditoria existente.

---

# 14. Relação com v3.6

A timeline não substitui o estado de review.

`agent_operational_incident_reviews` continua sendo a fonte de verdade para o estado corrente.

A timeline apenas mostra transições históricas disponíveis.

Não introduzir:

```text
timelineStatus
activityStatus
incidentTimelineState
```

---

# 15. Relação com v3.8

`agent_operational_incident_assignments` continua sendo a fonte de verdade para ownership corrente.

A timeline não deve derivar ownership atual pelo "último evento".

O estado corrente continua vindo da estrutura v3.8.

A timeline serve para histórico.

---

# 16. Relação com v3.9

Workload continua sendo calculado pela leitura consolidada da v3.9.

A timeline:

* não altera contagens;
* não cria capacidade;
* não classifica carga;
* não recalcula workload;
* não sugere responsável.

Não invalidar workload em chamadas GET.

Somente mutações reais já existentes continuam invalidando caches adequados.

---

# 17. Fora de escopo — proibido implementar

Não implementar nesta versão:

* SLA;
* deadline;
* due date;
* aging policy;
* breach detection;
* overdue;
* tempo máximo de resolução;
* tempo máximo sem acknowledge;
* score;
* prioridade nova;
* scoring por severidade;
* load balancing;
* capacidade por usuário;
* capacity planning;
* round-robin;
* auto-assignment;
* auto-reassignment;
* recomendação de responsável;
* "responsável ideal";
* equipes;
* filas por equipe;
* LLM;
* resumo de incidente via IA;
* classificação automática de notas;
* ações disparadas a partir de comentários;
* escalation baseada em workload;
* alteração do Operational Supervisor.

---

# 18. supervisor-guard.ts

`supervisor-guard.ts` deve permanecer intacto.

Não alterar:

* Response Policy;
* Planner;
* Policy Evaluator;
* Executor;
* Circuit Breaker;
* recovery;
* scheduler;
* detecção;
* decisão automática;
* escalation automática;
* follow-up automático.

Confirmar explicitamente no relatório final:

```text
git diff -- supervisor-guard.ts
```

ou equivalente.

---

# 19. Testes backend obrigatórios

Adicionar testes cobrindo, conforme aplicável:

1. timeline contém detecção;
2. acknowledge aparece cronologicamente;
3. mudança de review aparece corretamente;
4. assign aparece corretamente;
5. reassign representa anterior → novo;
6. unassign representa responsável → null;
7. escalation relacionada aparece quando vínculo existe;
8. follow-up relacionado aparece quando vínculo existe;
9. eventos de outro incidente nunca aparecem;
10. ordenação é determinística;
11. usuário sem `agents.operations.read` recebe 403;
12. usuário somente leitura recebe 200;
13. GET da timeline não grava audit log;
14. GET da timeline não altera estado;
15. ausência de review não quebra timeline;
16. ausência de assignment não quebra timeline;
17. ausência de escalation/follow-up não quebra timeline;
18. sem N+1.

Se notas forem implementadas, adicionar também:

19. criação de nota respeita autorização;
20. nota pertence exclusivamente ao incidente correto;
21. nota não altera review;
22. nota não altera assignment;
23. nota não altera workload;
24. nota é auditada conforme padrão do projeto;
25. política de append-only/edição funciona conforme decisão arquitetural.

---

# 20. Testes frontend

Adicionar testes frontend somente se existir lógica nova relevante e testável.

Exemplos:

* ordenação client-side, se existir;
* rendering condicional complexo;
* interação de criação de nota, se implementada;
* tratamento de estados específicos.

Não criar testes artificiais apenas para aumentar contagem.

---

# 21. Validação final

Executar:

## Backend

```bash
npx tsc --noEmit
npm run test -- --test-concurrency=1
```

ou comandos equivalentes reais do repositório.

Registrar:

* baseline anterior;
* quantidade exata de testes novos;
* total final esperado;
* total final observado.

Os números devem reconciliar exatamente.

---

## Frontend

Executar:

```bash
tsc --noEmit
eslint
node --test
next build
```

usando os comandos reais existentes no projeto.

Registrar resultados.

---

# 22. Migration

Se nenhuma migration for necessária:

declarar explicitamente:

```text
Nenhuma migration criada.
```

e explicar por quê.

Se migration for necessária apenas para notas humanas:

1. justificar antes;
2. limitar migration exclusivamente a esse novo conceito;
3. não duplicar eventos existentes;
4. manter vínculo inequívoco com incidente;
5. manter autoria e timestamps;
6. aplicar constraints adequadas;
7. testar integridade;
8. documentar rollback/compatibilidade conforme padrão existente.

---

# 23. Relatório final obrigatório

O fechamento deve conter:

## 23.1 Descoberta

* estruturas revisadas;
* fontes canônicas encontradas;
* necessidade ou não de migration;
* justificativa.

## 23.2 Timeline

Listar exatamente quais eventos foram implementados.

## 23.3 Fontes

Para cada evento:

```text
evento → fonte persistente
```

Exemplo:

```text
incident_detected → audit_logs
assigned → audit_logs / assignment history existente
review_status_changed → ...
```

Usar somente o que realmente foi encontrado.

## 23.4 Estratégia anti-N+1

Informar quantidade de queries ou estratégia batched utilizada.

## 23.5 Autorização

Informar permissions usadas.

## 23.6 Arquivos

* criados;
* alterados.

## 23.7 Testes

* testes novos;
* baseline;
* total final;
* typecheck;
* lint;
* build.

## 23.8 Autonomia

Declarar explicitamente:

```text
A v4.0 não aumentou autonomia operacional.
```

## 23.9 supervisor-guard.ts

Declarar explicitamente se permaneceu intacto.

## 23.10 Commit/deploy

Não fazer commit nem deploy sem aprovação posterior.

---

# 24. Critérios de aprovação

A v4.0 só será considerada aprovável se:

* não existir segunda fonte de verdade para eventos existentes;
* migration tiver sido evitada quando derivação for suficiente;
* qualquer migration criada estiver estritamente justificada;
* timeline usar a identidade canônica do incidente;
* ordenação for determinística;
* nenhum evento de outro incidente puder vazar;
* autorização read-only estiver correta;
* GET não gerar side effects;
* não houver N+1;
* ownership atual continuar vindo da v3.8;
* workload continuar vindo da v3.9;
* review atual continuar vindo da v3.6;
* Supervisor e guardrails permanecerem intactos;
* nenhuma funcionalidade de SLA/autonomia tiver sido antecipada;
* suíte completa permanecer verde.

---

# 25. Diretriz principal

A pergunta que a v4.0 deve responder é:

> “O que aconteceu com este incidente, em que ordem, e quem realizou cada ação?”

Ela NÃO deve responder ainda:

> “Está atrasado?”

> “Quem deveria assumir?”

> “Quem está sobrecarregado?”

> “Devemos escalar automaticamente?”

> “Qual a prioridade ideal?”

Essas perguntas pertencem a versões posteriores.
