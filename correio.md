# Agentes v2.7 — Operational Follow-up & Coordinated Workflows

## Objetivo

Construir uma camada formal de acompanhamento operacional sobre:

* Agent Responsibilities v2.6;
* Operational Escalations v2.6;
* Operational Supervisor v2.5;
* Decision Queue;
* Jobs/Runs;
* Planner → Policy Evaluator → Executor → Approval.

A v2.7 deve permitir que uma responsabilidade operacional gere e mantenha um **follow-up estruturado**, com responsável, estado, prazo, histórico e conclusão.

Um follow-up representa:

> “Este assunto precisa ser acompanhado até que exista uma conclusão operacional.”

Ele **não representa uma autorização para executar ações**.

---

# 1. Princípios bloqueantes

A implementação deve respeitar integralmente:

1. Follow-up nunca concede permission.
2. Follow-up nunca altera autonomia.
3. Follow-up nunca executa tool diretamente.
4. Follow-up nunca bypassa Planner → Policy → Executor → Approval.
5. Follow-up nunca transforma texto livre em comando executável.
6. LLM nunca decide ownership, permission, autorização ou transição de estado.
7. Toda associação de agente/usuário deve apontar para registros reais.
8. Histórico não pode ser destruído.
9. Transições devem ser determinísticas.
10. Reprocessamento não pode criar follow-ups duplicados continuamente.
11. Nenhum novo mecanismo paralelo de Jobs, Action Plans, Approvals ou Decisions.
12. Nenhuma comunicação agent-to-agent livre deve ser criada nesta versão.

---

# 2. Revisar primeiro a arquitetura existente

Antes de escrever código, revisar efetivamente:

* `backend/src/agents/responsibilities/`
* `backend/src/agents/escalations/`
* `backend/src/agents/operations/`
* `backend/src/agents/director/decisions/`
* Jobs e Runs
* Action Plans
* approvals
* audit
* schema e migrations
* permissions
* padrões de API do módulo Agents
* frontend de Responsibilities/Escalations/Operations

Documentar no relatório o que foi encontrado e quais estruturas serão reutilizadas.

Não inferir somente por nomes de arquivos.

---

# 3. Novo conceito: OperationalFollowUp

Criar um conceito persistido semelhante a:

`OperationalFollowUp`

Campos conceituais esperados:

* id
* responsibilityId
* escalationId opcional
* sourceType
* sourceId
* ownerAgentId
* assignedUserId opcional
* title
* description
* status
* priority
* dueAt opcional
* nextReviewAt opcional
* createdAt
* updatedAt
* acknowledgedAt
* completedAt
* dismissedAt
* createdBy
* completedBy
* dismissedBy
* resolution opcional
* metadata
* dedupKey

A modelagem final pode ser ajustada conforme o schema real encontrado.

---

# 4. Estados

Usar vocabulário fechado e máquina de estados explícita.

Sugestão:

* `open`
* `in_progress`
* `waiting`
* `completed`
* `dismissed`

Transições permitidas, por exemplo:

`open → in_progress`

`open → waiting`

`open → completed`

`open → dismissed`

`in_progress → waiting`

`in_progress → completed`

`in_progress → dismissed`

`waiting → in_progress`

`waiting → completed`

`waiting → dismissed`

`completed` e `dismissed` devem ser terminais para ações humanas normais.

Não permitir transições arbitrárias via PATCH genérico.

Criar endpoints de ação específicos quando isso melhorar a segurança e clareza.

---

# 5. Follow-up ≠ Action Plan

Esta separação deve ficar explícita no código e documentação.

Um follow-up pode dizer:

> “Cliente X precisa de retorno até sexta-feira.”

Mas não pode executar:

> `send_email()`

Se uma ação operacional precisar acontecer, deve utilizar mecanismos já existentes.

Exemplo:

Follow-up identifica necessidade de ação.

↓

Usuário/agente autorizado inicia objetivo pelo pipeline oficial.

↓

Planner gera plano.

↓

Policy avalia.

↓

Executor executa ou exige approval.

Nunca criar:

`followUp.execute()`

ou qualquer equivalente.

---

# 6. Origem dos follow-ups

Implementar inicialmente apenas origens objetivas e determinísticas.

Prioridade:

### A. Operational Escalation

Uma escalation aberta pode gerar um follow-up para seu owner.

A associação deve preservar:

* responsibility;
* sourceAgent;
* target;
* severity;
* entidade envolvida.

### B. Responsibility

Permitir criação gerencial de follow-up associado diretamente a uma Responsibility, caso exista caso de uso seguro no modelo atual.

Avaliar durante a revisão.

### C. Operational Supervisor

Preferencialmente passar pelo mecanismo de escalation existente.

Não conectar diretamente Supervisor → FollowUp se isso duplicar a responsabilidade da v2.6.

---

# 7. Criação automática

Ao criar/reabrir uma OperationalEscalation aplicável, avaliar a criação/reabertura de um FollowUp.

A regra precisa ser determinística.

Não usar LLM.

Exemplo:

`escalationId + responsibilityId + entityType + entityId`

pode formar parte da chave de deduplicação.

Usar índice único no banco e operação atômica.

Não usar apenas:

`SELECT → se não existe → INSERT`

sem proteção contra concorrência.

---

# 8. Deduplicação e recorrência

Definir claramente:

* o que constitui o mesmo follow-up;
* quando um evento é apenas repetição;
* quando um follow-up terminal deve reabrir;
* quando deve permanecer histórico encerrado.

Preferencialmente seguir padrões já comprovados nas versões anteriores.

Testar concorrência real com `Promise.all`.

Uma mesma ocorrência simultânea não pode produzir vários registros.

---

# 9. Ownership

O owner deve vir da Responsibility existente.

Não recalcular ownership com LLM.

Não permitir que um FollowUp invente um agente responsável.

Se houver alteração posterior do ownership da Responsibility, preservar no histórico qual era o owner original do FollowUp.

Avaliar se existe necessidade legítima de reassignment.

Caso seja implementado reassignment:

* deve exigir permission;
* target agent/user deve existir;
* deve gerar auditoria;
* nunca deve reescrever histórico anterior.

---

# 10. Human assignment

Quando a Responsibility possuir target humano ou quando houver decisão explícita de um usuário autorizado, o FollowUp pode possuir:

`assignedUserId`

Sempre FK para usuário real.

Não aceitar strings livres como:

* CEO
* gerente
* admin
* financeiro

---

# 11. Prazo e revisão

Adicionar suporte a:

* `dueAt`
* `nextReviewAt`

Esses campos representam acompanhamento, não scheduler de execução.

Nesta versão, não criar uma nova scheduler engine se a infraestrutura existente puder suportar revisão.

Avaliar reutilização de Jobs/Event Engine/Operational Supervisor somente se houver encaixe arquitetural natural.

Se não houver, persistir os campos e oferecer filtros de:

* vencidos;
* próximos do prazo;
* aguardando revisão.

Não construir mecanismo complexo somente para “usar” os campos.

---

# 12. Waiting

O estado `waiting` deve representar dependência externa ou humana.

Se necessário, permitir registrar:

* `waitingReason`
* `waitingUntil`

Mas texto permanece apenas descritivo.

Nunca interpretar `waitingReason` como comando.

---

# 13. Conclusão

Completar um follow-up deve exigir uma conclusão estruturada suficiente para auditoria.

Exemplo:

`resolution`

Campo textual descritivo.

Registrar:

* completedAt
* completedBy
* resolution

Não apagar escalation, decision, job ou qualquer outro registro relacionado.

---

# 14. Relação com Escalation

Definir comportamento claro.

Sugestão:

Escalation gera FollowUp.

Acknowledge da escalation não necessariamente conclui o FollowUp.

Resolver o FollowUp também não deve automaticamente marcar a Escalation como resolved, a menos que exista uma regra objetiva e segura para isso.

Evitar sincronizações bidirecionais mágicas.

Se for necessário algum vínculo automático, deve ser:

* unidirecional;
* determinístico;
* explícito;
* testado.

---

# 15. Permissions

Primeiro avaliar possibilidade de reutilização.

Provavelmente serão necessárias:

* `agents.followups.read`
* `agents.followups.manage`

Evitar permissions excessivamente granulares sem necessidade concreta.

Toda proteção obrigatoriamente no backend.

Frontend PermissionGate é somente UX.

---

# 16. Auditoria

Reutilizar `audit()` existente.

Eventos sugeridos:

* `agents.followup.created`
* `agents.followup.reopened`
* `agents.followup.started`
* `agents.followup.waiting`
* `agents.followup.resumed`
* `agents.followup.completed`
* `agents.followup.dismissed`
* `agents.followup.reassigned`
* `agents.followup.updated`

Evitar eventos redundantes.

---

# 17. API

Criar rotas seguindo o padrão real existente.

Provável conjunto:

### Consulta

`GET /agents/follow-ups`

`GET /agents/follow-ups/:id`

Filtros:

* status
* priority
* ownerAgentId
* assignedUserId
* responsibilityId
* escalationId
* overdue

### Transições

`POST /agents/follow-ups/:id/start`

`POST /agents/follow-ups/:id/wait`

`POST /agents/follow-ups/:id/resume`

`POST /agents/follow-ups/:id/complete`

`POST /agents/follow-ups/:id/dismiss`

Se reassignment for realmente necessário:

`POST /agents/follow-ups/:id/reassign`

Não expor endpoint que permita alterar livremente `status`.

---

# 18. Frontend

Integrar ao módulo Agents existente.

Adicionar item:

**Follow-ups**

Criar uma tela operacional semelhante aos dashboards já existentes.

Mostrar pelo menos:

* título;
* domínio;
* responsibility;
* owner;
* assigned human;
* priority;
* status;
* origem;
* prazo;
* próxima revisão;
* idade do follow-up.

Filtros úteis:

* abertos;
* em andamento;
* aguardando;
* vencidos;
* concluídos;
* prioridade;
* domínio.

---

# 19. Visão de atenção operacional

Adicionar uma pequena visão/resumo no topo, sem criar novo sistema de analytics.

Exemplo:

* Open
* In Progress
* Waiting
* Overdue
* Critical

Todos derivados deterministicamente dos dados.

Não usar LLM para calcular esses números.

---

# 20. UX

Ações devem aparecer somente quando válidas para o estado atual.

Exemplo:

`open`

→ Iniciar
→ Aguardar
→ Concluir
→ Descartar

`waiting`

→ Retomar
→ Concluir
→ Descartar

`completed`

→ somente leitura.

Mesmo assim, backend sempre deve validar novamente.

---

# 21. Segurança

Manter princípios permanentes do projeto:

* validação Zod strict;
* autorização backend;
* FK real;
* least privilege;
* nenhuma SQL/tool/shell via LLM;
* auditabilidade;
* estados fechados;
* input textual nunca executável;
* dedup atômico;
* histórico protegido.

---

# 22. Banco de dados

Usar migration oficial do Drizzle.

Não editar migration antiga.

Criar índices adequados para:

* status
* owner
* assignedUser
* responsibility
* escalation
* dueAt
* dedupKey

Aplicar FKs com estratégia de `restrict` ou `set null` conforme preservação histórica adequada.

Documentar as decisões.

---

# 23. Testes mínimos obrigatórios

Cobrir no mínimo:

### Criação

1. escalation válida gera follow-up.
2. sem responsibility aplicável não gera follow-up indevido.
3. owner vem da responsibility.
4. target humano é usuário real.

### Dedup

5. mesma ocorrência não duplica follow-up.
6. chamadas concorrentes produzem uma única linha.
7. comportamento de recorrência após terminal é explicitamente testado.

### Estados

8. `open → in_progress`
9. `in_progress → waiting`
10. `waiting → in_progress`
11. conclusão válida
12. dismissal válido
13. transições inválidas → 409
14. terminal não aceita transição arbitrária.

### Permissions

15. sem read → 403.
16. read permite leitura.
17. read não permite manage.
18. manage permite transições.

### Histórico

19. timestamps e atores preservados.
20. conclusão não destrói origem/escalation.
21. reassignment, se implementado, preserva owner original/histórico.

### Supervisor/Escalation

22. integração existente continua verde.
23. dry-run continua sem side effects.
24. escalation dedup continua funcionando.
25. nenhuma regressão no Supervisor v2.5/v2.6.

---

# 24. Concorrência

Executar teste real, não simulado, de concorrência de criação de FollowUp.

Exemplo:

8 ou mais chamadas simultâneas com a mesma chave.

Resultado esperado:

* 1 registro persistido;
* nenhum erro inesperado;
* nenhum histórico corrompido.

---

# 25. Não construir nesta versão

Não implementar:

* chat agent-to-agent;
* mailbox entre agentes;
* negociação entre agentes;
* workflow designer;
* BPMN;
* multi-stage escalation engine;
* automação genérica estilo n8n;
* nova scheduler engine;
* execução direta pelo follow-up;
* linguagem/DSL de workflow;
* geração dinâmica de código;
* permission derivada de responsibility;
* autonomia derivada de ownership.

Esses itens estão explicitamente fora do escopo.

---

# 26. Compatibilidade

Preservar integralmente:

* CRM
* Projects
* Finance
* Support
* Agents anteriores
* Director
* Planner
* Policy
* Executor
* Approvals
* Jobs
* Runs
* Events
* Governance
* Circuit Breaker
* Recovery
* Operational Supervisor
* Responsibilities
* Escalations

Nenhuma regressão é aceitável.

---

# 27. Validação final

Executar obrigatoriamente:

## Backend

```bash
npx tsc --noEmit
npx tsx --test --test-concurrency=1 'src/**/*.test.ts'
```

## Frontend

```bash
npx tsc --noEmit
npm test
npm run build
```

Reconciliar matematicamente os números de testes com o baseline atual:

* Backend: **644**
* Frontend: **111**

Qualquer divergência deve ser explicada antes de considerar a entrega concluída.

---

# 28. Relatório final

Entregar:

1. resumo;
2. revisão da arquitetura encontrada;
3. modelo adotado;
4. estados/transições;
5. ownership;
6. relação Responsibility → Escalation → FollowUp;
7. estratégia de deduplicação;
8. tratamento de concorrência;
9. permissions;
10. auditoria;
11. API;
12. frontend;
13. migrations;
14. arquivos criados;
15. arquivos alterados;
16. testes adicionados por arquivo;
17. números exatos das suítes;
18. reconciliação com baseline;
19. typecheck;
20. build;
21. bugs encontrados;
22. limitações reais;
23. débitos técnicos;
24. `git diff --stat`;
25. `git status`.

---

# 29. Critério final de aprovação

A v2.7 somente pode ser considerada concluída se pudermos afirmar:

> A empresa agora consegue acompanhar formalmente uma responsabilidade operacional do surgimento até sua conclusão, sabendo quem é responsável, qual é o estado, qual é o prazo e qual foi a resolução — sem conceder novas permissões nem criar um caminho paralelo de execução.

**Não faça commit.**

Entregue tudo no working tree para revisão do Diretor/CEO.
