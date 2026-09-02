# Execução — Agentes v1.9: Director Decision & Prioritization

Implementar a versão **Agentes v1.9 — Director Decision & Prioritization** sobre a base consolidada da v1.8.

A v1.8 já entrega:

* Operational Signals determinísticos;
* Daily Operations Brief;
* Mesa do Diretor;
* integração com CRM, Projetos, Financeiro, Suporte/CS e Agentes;
* Action Plans;
* Planner;
* Policy Evaluator;
* Executor determinístico;
* Approval Workflow;
* Jobs;
* Events;
* Governance;
* auditoria;
* incidentes;
* settings;
* circuit breakers;
* execução controlada.

A v1.9 NÃO deve criar outro executor, outro mecanismo de autorização, outro sistema de jobs, outro sistema de eventos ou outro mecanismo paralelo de aprovação.

O objetivo agora é transformar sinais operacionais em uma **fila executiva de decisões e prioridades**, permitindo ao Diretor Virtual organizar o que deve receber atenção primeiro e acompanhar a resolução.

---

# 1. Objetivo funcional

Criar uma camada chamada conceitualmente:

**Director Decision Queue**

Ela deve responder perguntas como:

* O que exige atenção primeiro?
* O que é crítico para a operação?
* O que pode esperar?
* Quais problemas estão se acumulando?
* Quais situações continuam abertas?
* Qual domínio está concentrando mais risco?
* Quais itens precisam de decisão humana?
* Quais itens já possuem Action Plan?
* Quais estão aguardando aprovação?
* Quais foram resolvidos?
* Quais voltaram a ocorrer?

A fila deve ser construída sobre os Operational Signals da v1.8.

Não duplicar a coleta de dados dos módulos.

---

# 2. Princípio fundamental

Separar claramente:

Operational Signal
↓
Decision/Priority Item
↓
Action Plan
↓
Policy Evaluator
↓
Executor / Approval

Um Decision Item representa:

> "Esta situação merece acompanhamento executivo."

Ele NÃO representa autorização para executar uma ação.

Nenhuma prioridade deve alterar permissões.

Nenhum score deve permitir bypass do Policy Evaluator.

Nenhuma situação "critical" deve significar "execute automaticamente".

---

# 3. Antes de implementar

Explorar obrigatoriamente:

* schemas atuais de agents;
* migrations v1.0–v1.8;
* operational-signals;
* operations-service;
* workflows/catalog;
* Action Plans;
* approvals;
* jobs;
* runs;
* incidents;
* events;
* audit;
* settings/config existente;
* frontend da Mesa do Diretor;
* permissions existentes.

Não inventar estruturas que já existam.

Reaproveitar IDs e relações reais.

---

# 4. Decision Item

Criar uma representação persistente para itens que merecem acompanhamento executivo.

Avaliar o melhor nome após analisar o projeto. Sugestões:

* `agent_director_decisions`
* `agent_director_items`
* `agent_decision_queue`

Escolher um nome consistente com o padrão atual.

Campos mínimos conceituais:

* id
* signalType
* domain
* entityType
* entityId
* title
* description
* severity
* impact
* urgency
* priorityScore
* status
* firstDetectedAt
* lastDetectedAt
* occurrenceCount
* resolvedAt
* resolvedBy
* actionPlanId nullable
* approvalId nullable, somente se fizer sentido arquiteturalmente
* assignedUserId nullable
* metadata
* createdAt
* updatedAt

Não armazenar informação duplicada desnecessariamente.

Quando a referência puder ser derivada de Action Plan/Approval, preferir relação adequada em vez de cópia inconsistente.

---

# 5. Status do Decision Item

Definir state machine explícita.

Sugestão inicial:

* open
* acknowledged
* action_planned
* awaiting_approval
* in_progress
* resolved
* dismissed

Avaliar quais realmente são necessários.

Não criar estados que não possam ser determinados de forma confiável.

Toda transição mutante deve:

* validar origem;
* validar status atual;
* validar permission;
* ser auditada.

---

# 6. Deduplicação / recorrência

Um requisito importante da v1.9:

O mesmo problema não deve criar infinitos Decision Items a cada geração de brief.

Implementar uma chave determinística ou estratégia equivalente baseada em algo como:

`signalType + entityType + entityId`

Quando o mesmo problema reaparecer:

* atualizar `lastDetectedAt`;
* incrementar `occurrenceCount`;
* manter `firstDetectedAt`;
* reabrir somente se houver regra explícita e segura.

Investigar sinais sem `entityId`.

Nesses casos criar chave estável baseada nos dados reais disponíveis.

Não usar texto gerado por LLM como chave.

---

# 7. Resolução

Um Decision Item pode ser resolvido quando houver evidência determinística de que sua condição não existe mais.

Exemplo:

* tarefa estava vencida;
* tarefa foi concluída;
* próximo scan não encontra mais o sinal;
* item pode ser marcado como resolved automaticamente, se a regra for confiável.

Entretanto:

NÃO resolver automaticamente situações cuja ausência no collector possa ser causada por:

* erro na fonte;
* módulo partial;
* timeout;
* falha de coleta.

Se o domínio falhou durante coleta, preservar os itens existentes daquele domínio.

Isso é obrigatório.

---

# 8. Priorização determinística

Criar um mecanismo de `priorityScore`.

Não delegar o score principal ao LLM.

O score deve ser explicável.

Avaliar uma composição semelhante a:

priorityScore =
severityWeight

* impactWeight
* urgencyWeight
* agingWeight
* recurrenceWeight

Não implementar cegamente essa fórmula.

Primeiro definir quais dimensões podem ser calculadas com os dados reais existentes.

Exemplo conceitual:

Severity:

* critical
* warning
* attention
* info

Impact:

* high
* medium
* low

Urgency:

* immediate
* soon
* normal

Aging:

quanto tempo o Decision Item está aberto.

Recurrence:

quantas vezes o mesmo problema foi detectado.

O algoritmo deve ser:

* determinístico;
* testável;
* documentado;
* estável;
* sem números mágicos espalhados.

Centralizar pesos e thresholds em catálogo/configuração.

---

# 9. Impacto

Impact não deve ser inventado pelo LLM.

Criar regras por `signalType`.

Exemplos conceituais:

`support.ticket_critical`
→ impacto provavelmente alto.

`finance.receivable_overdue`
→ impacto pode depender do valor financeiro, se esse valor estiver realmente disponível no sinal.

`projects.task_unassigned`
→ impacto normalmente menor que projeto inteiro vencido.

`agents.job_circuit_open`
→ impacto elevado para operação automatizada.

Não assumir dados não presentes.

Caso uma fonte necessária não esteja no signal, ampliar o collector somente se puder fazê-lo usando service/repository oficial do domínio.

---

# 10. Urgência

Calcular com dados reais.

Exemplos:

* SLA já vencido;
* vencimento financeiro atrasado N dias;
* tarefa vencida N dias;
* follow-up vencido N dias;
* circuit breaker aberto.

Centralizar thresholds.

O uso de `now` deve continuar parametrizável para testes.

Nada de `new Date()` espalhado em regras de negócio.

---

# 11. Explicabilidade

Todo item deve permitir entender:

* por que foi criado;
* por que recebeu determinado score;
* quais fatores contribuíram;
* qual sinal originou;
* quantas vezes ocorreu;
* há quanto tempo está aberto.

Criar algo semelhante a:

```ts
priorityFactors: {
  severity: ...
  impact: ...
  urgency: ...
  aging: ...
  recurrence: ...
}
```

ou estrutura equivalente.

Evitar salvar cálculos que possam ficar inconsistentes, caso seja melhor recalculá-los.

Escolher conscientemente entre persistir e derivar.

---

# 12. Ranking

Criar serviço que entregue:

* fila global;
* fila por domínio;
* top critical;
* awaiting CEO/human decision;
* awaiting approval;
* aging items;
* recurrent items.

Ordenação principal:

1. priorityScore DESC
2. firstDetectedAt ASC ou outra regra explicitamente documentada.

Desempate precisa ser determinístico.

---

# 13. Integração com Action Plans

Decision Item não cria Action Plan automaticamente só por existir.

O usuário/Diretor pode solicitar:

**Propor ação**

Reutilizar EXATAMENTE o pipeline da v1.8:

`planEvaluateAndPersistActionPlan()`
+
`executeActionPlan()`

Quando um Action Plan nascer a partir de um Decision Item:

* relacionar o item ao Action Plan;
* atualizar estado adequadamente;
* manter audit trail.

Não duplicar `POST /director/signals/:id/propose` sem necessidade.

Avaliar se ele deve:

A) continuar operando sobre Signal e vincular Decision Item;

ou

B) migrar conceitualmente para Decision Item mantendo compatibilidade da API existente.

Compatibilidade é prioritária.

Não quebrar frontend/API v1.8.

---

# 14. Integração com Approvals

Se o Action Plan resultar em `approval_required`:

o Decision Item deve refletir que existe uma decisão humana pendente.

Não criar um segundo approval.

Consultar o approval real.

Quando approval mudar:

* refletir corretamente na fila do Diretor.

Evitar duplicação de estado sempre que possível.

---

# 15. Assignment / Ownership

Permitir opcionalmente atribuir um Decision Item a um usuário responsável.

Antes de criar permission nova, verificar permissions existentes.

Não permitir atribuição a usuário inexistente.

Não interpretar `assignedUserId` como autorização para executar ferramentas.

Assignment significa apenas:

> responsável operacional pelo acompanhamento.

Toda atribuição deve ser auditada.

---

# 16. Acknowledge

Permitir que um usuário autorizado marque um item como:

`acknowledged`

Isso significa apenas:

> "alguém viu e assumiu ciência."

Não significa resolvido.

Não significa aprovado.

Não significa executado.

Guardar:

* acknowledgedAt
* acknowledgedBy

se a modelagem justificar.

---

# 17. Dismiss

Pode existir dismiss apenas se houver justificativa auditável.

Exigir:

* usuário;
* timestamp;
* reason obrigatório.

Nunca apagar o registro.

Preferir soft state.

Dismiss não deve impedir que uma condição realmente crítica futura volte a gerar/reabrir um item segundo regra clara.

---

# 18. API sugerida

Avaliar nomes finais, mas algo próximo de:

```text
GET  /agents/director/decisions
GET  /agents/director/decisions/:id

POST /agents/director/decisions/:id/acknowledge
POST /agents/director/decisions/:id/assign
POST /agents/director/decisions/:id/dismiss
POST /agents/director/decisions/:id/propose
```

Filtros úteis:

```text
?status=
?domain=
?severity=
?assignedUserId=
?requiresHumanAttention=
```

Não criar endpoints redundantes.

---

# 19. Permissions

Antes de criar qualquer permission:

inspecionar o catálogo existente.

Leitura provavelmente pode continuar sob:

`agents.read`

Ações administrativas podem talvez reaproveitar permissions existentes.

Entretanto, não forçar reuso se semanticamente inseguro.

Se realmente for necessária permission nova, justificar individualmente.

Não criar uma permission para cada botão.

---

# 20. Sync dos Operational Signals

Criar um processo claro:

`syncDirectorDecisionQueue()`

ou equivalente.

Ele deve:

1. coletar sinais;
2. criar novos Decision Items;
3. atualizar recorrências;
4. recalcular prioridade;
5. resolver itens cuja condição desapareceu;
6. preservar itens de domínios cuja coleta falhou;
7. retornar resumo da sincronização.

Resultado sugerido:

```ts
{
  created,
  updated,
  resolved,
  unchanged,
  errors
}
```

Não é obrigatório usar exatamente esse contrato.

---

# 21. Jobs

Avaliar reaproveitar o Job diário da v1.8.

O Job `director.generate_daily_brief` pode eventualmente:

* sincronizar Decision Queue;
* gerar brief.

Mas cuidado:

a tool foi definida como READ na v1.8.

Se sincronizar fila implica escrita, NÃO transformar silenciosamente uma tool READ em mutação.

Opções possíveis:

* criar uma operação interna controlada fora da tool;
* criar tool específica mutante;
* manter sync acionado por backend/job runner apropriado.

Escolher a arquitetura mais segura.

Documentar a decisão.

---

# 22. Events

Não criar dezenas de eventos.

Criar eventos somente se houver consumidores reais.

Possíveis eventos justificáveis:

* director.decision.created
* director.decision.resolved
* director.decision.escalated

Mas somente implementar se algum fluxo existente realmente consumir.

Caso contrário, documentar como extensão futura.

---

# 23. Escalation

Implementar conceito de escalada somente de forma determinística.

Exemplos:

* critical aberto por período X;
* occurrenceCount acima de threshold;
* approval pendente há tempo excessivo.

A escalada pode aumentar prioridade ou marcar:

`requiresHumanAttention = true`

Ela NÃO pode executar ações automaticamente.

Escalation != authorization.

---

# 24. CEO Attention

Adicionar visão específica:

**Requer atenção humana**

Condição determinada por regras como:

* approval_required;
* blocked que precise decisão operacional;
* critical persistente;
* recurrent critical;
* item explicitamente escalado.

Não chamar tudo de "CEO".

Pode existir tecnicamente `requiresHumanAttention`.

A UI pode apresentar "Requer atenção".

---

# 25. Frontend — Mesa do Diretor v1.9

Expandir `/agents/director`.

Não criar uma segunda área desconectada.

Adicionar uma seção central:

**Fila de Prioridades**

Cada item deve mostrar:

* prioridade;
* severidade;
* domínio;
* título;
* motivo;
* tempo em aberto;
* recorrências;
* responsável;
* status;
* indicação de atenção humana;
* Action Plan relacionado, quando houver;
* approval pendente, quando houver.

Ações conforme permission:

* visualizar;
* reconhecer;
* atribuir;
* propor ação;
* dispensar com justificativa.

---

# 26. UX executiva

A página deve permitir ao Diretor/CEO entender em poucos segundos:

* quantos itens críticos estão abertos;
* quantos precisam de decisão humana;
* quantos aguardam approval;
* quantos estão sem responsável;
* quais estão envelhecendo;
* quais são recorrentes.

Não transformar a página em um dashboard excessivamente carregado.

Prioridade visual para exceções.

---

# 27. Drill-down

Ao abrir um Decision Item mostrar:

* origem;
* entidade relacionada;
* histórico;
* score;
* fatores do score;
* ocorrências;
* Action Plan;
* decisões do Policy Evaluator;
* approval, quando houver;
* auditoria relevante;
* responsável;
* timestamps.

Reutilizar componentes existentes sempre que possível.

---

# 28. Auditoria

Auditar no mínimo:

* decision.created
* decision.acknowledged
* decision.assigned
* decision.dismissed
* decision.resolved
* decision.action_proposed

Se houver escalada:

* decision.escalated

Não criar sistema paralelo de audit.

Usar `audit()` existente.

Metadata suficiente para reconstruir o ocorrido.

---

# 29. Segurança

Obrigatório preservar:

* autorização server-side;
* nenhuma confiança na UI;
* nenhuma decisão de permission pelo LLM;
* nenhuma execução direta pelo Decision Queue;
* nenhuma SQL access pelo LLM;
* nenhuma tool arbitrária;
* nenhum shell;
* nenhuma credential;
* nenhum bypass do Policy Evaluator;
* nenhum bypass de Approval;
* nenhum aumento de privilégio por severity/priority;
* validação Zod;
* menor privilégio;
* auditoria.

---

# 30. Concorrência

Considerar explicitamente concorrência.

Dois scans simultâneos não podem criar Decision Items duplicados.

Criar constraint/índice ou mecanismo transacional adequado.

Testar.

Não resolver somente com `find then insert` sem proteção no banco.

---

# 31. Banco / índices

Se nova tabela for necessária:

criar migration.

Avaliar índices para:

* status;
* domain;
* priority;
* assignedUserId;
* deduplicationKey;
* lastDetectedAt;
* requiresHumanAttention.

Não criar índices especulativos sem justificar.

---

# 32. Testes obrigatórios

Backend:

### Detection / sync

* cria item a partir de signal;
* não duplica na próxima coleta;
* incrementa recurrence corretamente;
* atualiza lastDetectedAt;
* resolve quando sinal desaparece;
* NÃO resolve quando domínio falha;
* reprocessamento idempotente;
* concorrência não duplica item.

### Priority

* critical supera attention em condições equivalentes;
* aging aumenta prioridade conforme regra;
* recurrence aumenta prioridade conforme regra;
* thresholds de urgência;
* desempate determinístico;
* now controlado.

### State transitions

* open → acknowledged;
* assignment;
* dismiss com reason;
* transição inválida rejeitada;
* permission insuficiente rejeitada.

### Action Plan

* propose chama pipeline oficial;
* não há bypass;
* relation com Action Plan é persistida;
* approval_required aparece corretamente.

### Security

* leitura sem permission → 403;
* mutação sem permission → 403;
* usuário não pode usar Decision Item para elevar permission.

### Regression

Executar TODA suíte existente.

Não reduzir cobertura.

---

# 33. Frontend tests

Testar no mínimo:

* derivação de status;
* labels;
* ordenação;
* filtros;
* links de entidades;
* estado de atenção humana;
* visualização de approval/action plan relacionados.

---

# 34. Cenário integrado obrigatório

Criar um cenário real de teste:

1. inserir/usar entidade de negócio que gere signal;
2. sincronizar Director Decision Queue;
3. confirmar Decision Item;
4. executar nova sincronização;
5. confirmar que não duplicou;
6. propor ação;
7. passar pelo Planner;
8. passar pelo Policy Evaluator;
9. confirmar Action Plan persistido;
10. confirmar estado do Decision Item;
11. resolver a condição original;
12. sincronizar;
13. confirmar resolved.

Não mockar toda a cadeia.

Pode mockar provider LLM onde necessário para determinismo, mas usar componentes reais do pipeline.

---

# 35. Não fazer nesta versão

Não implementar:

* IA decidindo prioridades livremente;
* autoaprovação;
* autoexecução baseada somente em severity;
* machine learning de prioridades;
* SLA configurável genérico para toda agência;
* notificações WhatsApp/email;
* integração externa n8n;
* calendário;
* novos módulos de negócio;
* dashboards analíticos complexos;
* OKRs;
* planejamento estratégico;
* agentes negociando entre si;
* memória vetorial;
* RAG;
* embeddings;
* refatorações grandes fora do escopo.

A v1.9 é exclusivamente:

**Decision Queue + Prioritization + Ownership + Lifecycle.**

---

# 36. Critérios de aprovação

A versão somente pode ser considerada concluída se:

1. Operational Signals continuarem determinísticos.
2. Decision Items forem persistidos de forma idempotente.
3. Não existirem duplicações por concorrência.
4. Priority Score for determinístico e explicável.
5. Ausência de signal resolver item somente quando a coleta daquele domínio foi confiável.
6. Decision Item nunca autorizar execução.
7. Action Plan continuar passando pelo pipeline oficial.
8. Approval continuar sendo o mecanismo oficial.
9. Toda mutação relevante for auditada.
10. Permissions forem verificadas no backend.
11. Nenhuma regressão v1.0–v1.8.
12. Backend typecheck limpo.
13. Frontend typecheck limpo.
14. Todos os testes passarem.
15. Frontend build passar.

---

# 37. Entrega esperada

Ao finalizar, entregar relatório contendo:

1. resumo;
2. arquitetura final;
3. inventário explorado antes da implementação;
4. arquivos criados;
5. arquivos alterados;
6. migration;
7. schema do Decision Item;
8. deduplication strategy;
9. state machine;
10. priority algorithm;
11. thresholds/pesos;
12. integração com Operational Signals;
13. integração com Action Plans;
14. integração com Approvals;
15. integração com Jobs;
16. Events implementados ou justificativa para não implementar;
17. permissions;
18. endpoints;
19. auditoria;
20. frontend;
21. testes;
22. cenário integrado;
23. bugs encontrados durante desenvolvimento;
24. riscos/débitos técnicos;
25. compatibilidade v1.0–v1.8;
26. comandos de migration/seed/deploy;
27. git diff/status.

---

# 38. Regra de encerramento

NÃO fazer commit automático.

Ao terminar:

* deixar todas as alterações no working tree;
* executar validação final;
* apresentar o relatório completo;
* aguardar revisão do Diretor/CEO.

Nenhum commit até aprovação expressa.
