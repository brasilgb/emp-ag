# Agência de Software 2026 — Agentes v1.6

## Operations Control & Observability

Implementar a v1.6 sobre a baseline já commitada da v1.5.

A v1.5 deve ser considerada estável e não deve ser reimplementada.

## 1. Objetivo

Criar a camada operacional e de observabilidade dos agentes.

Precisamos conseguir responder rapidamente:

* O que os agentes estão fazendo?
* O que acabaram de fazer?
* Por que uma execução ocorreu?
* Quem ou qual evento causou a execução?
* Qual cadeia autônoma originou a ação?
* O que falhou?
* O que foi bloqueado?
* Quais circuit breakers estão abertos?
* Quais aprovações aguardam intervenção?
* Quais Jobs estão consumindo mais execuções?

A v1.6 não cria outro executor, planner, policy engine ou mecanismo de autonomia.

Tudo deve continuar utilizando a arquitetura v1.1–v1.5 existente.

---

# 2. Princípios obrigatórios

Preservar:

LLM
→ Planner
→ Policy Evaluator
→ Action Plan
→ Executor determinístico
→ Approval Workflow
→ Jobs/Runs
→ Event Engine
→ Autonomy Guard

Observabilidade não pode interferir na decisão de execução.

Frontend nunca é barreira de segurança.

Toda autorização permanece server-side.

Não expor:

* secrets;
* tokens;
* API keys;
* credenciais;
* conteúdo interno sensível desnecessário;
* stack traces para usuários comuns.

---

# 3. Operations Dashboard

Criar uma área operacional dos agentes.

Sugestão de rota:

`/agents/operations`

Exibir pelo menos:

### Jobs

* total;
* active;
* paused;
* cancelled;
* autonomy disabled;
* circuit open;
* circuit half_open.

### Runs

Por período:

* running;
* completed;
* failed;
* partial;
* blocked;
* cancelled.

### Autonomous operations

* execuções autônomas;
* bloqueios;
* ciclos detectados;
* rate limits;
* depth exceeded;
* chain budget exceeded;
* circuit open blocks.

### Events

* eventos criados;
* processados;
* pendentes;
* deliveries failed.

### Approvals

* pendentes;
* aprovadas;
* rejeitadas.

Não calcular essas métricas no frontend a partir de centenas de registros.

Criar endpoints agregados adequados no backend.

---

# 4. Execution Timeline

Criar visão detalhada de uma execução.

Exemplo:

`/agents/runs/:id`

A tela precisa reconstruir:

Job
→ Run
→ Action Plan
→ Plan Items
→ Executions
→ Events publicados
→ Event Deliveries
→ Runs causados posteriormente
→ Autonomy Blocks

Usar:

* `root_execution_id`;
* `causation_run_id`;
* `caused_by_run_id`;
* `autonomy_depth`;
* event/rule/delivery IDs existentes.

Exibir claramente:

`Root Run`

`Caused by Run`

`Depth`

`Trigger Type`

`Event`

`Event Rule`

---

# 5. Chain View

Criar endpoint para reconstrução de cadeia:

por exemplo:

`GET /agents/runs/:id/chain`

ou equivalente arquiteturalmente melhor.

Deve retornar estrutura determinística baseada exclusivamente em IDs persistidos.

Não utilizar LLM para inferir relacionamentos.

A API deve permitir reconstruir algo como:

Run A
└── Event X
└── Rule 15
└── Run B
└── Event Y
└── Rule 21
└── Blocked Run C

Também precisa funcionar para cadeia com múltiplos filhos.

Evitar N+1 queries.

---

# 6. Incident Center

Criar visão:

`/agents/incidents`

Incidentes derivados inicialmente dos dados existentes.

Tipos mínimos:

* `autonomy_circuit_open`
* `autonomous_cycle_detected`
* `autonomy_depth_exceeded`
* `autonomy_chain_budget_exceeded`
* `autonomous_rate_limit_exceeded`
* `job_repeated_failure`
* `event_delivery_failed`

Não criar automaticamente um sistema paralelo de incidentes se os dados existentes forem suficientes.

Primeiro avaliar se uma projection/query agregada sobre:

* autonomy blocks;
* runs;
* jobs;
* event deliveries;
* audit logs;

resolve o problema.

Persistência adicional só se houver justificativa arquitetural.

---

# 7. Controles administrativos

Na interface operacional permitir, respeitando permissions existentes:

### Job

* pause;
* resume;
* cancel;
* enable autonomy;
* disable autonomy.

### Event Rule

* enable;
* disable.

### Global autonomy

Exibir estado atual.

Se já existir endpoint seguro para alterar, reutilizá-lo.

Caso não exista interface adequada, implementar endpoint autorizado e auditado.

Ações destrutivas ou de impacto amplo devem exigir confirmação de UI.

Autorização final sempre no backend.

---

# 8. Circuit breaker visibility

Exibir claramente em Jobs:

* state;
* failure count;
* openedAt;
* cooldown quando puder ser derivado;
* autonomia enabled/disabled.

Estados:

* closed;
* open;
* half_open.

Não criar estado frontend diferente do persistido.

---

# 9. Auditoria

Criar uma tela utilizável para `audit_logs`.

Filtros mínimos:

* action;
* actor/user;
* Job;
* Run/rootExecutionId quando disponível;
* intervalo de data;
* autonomia;
* approvals.

Paginação obrigatória.

Não carregar a tabela inteira no navegador.

Metadata JSON deve poder ser inspecionada, mas com apresentação legível.

---

# 10. APIs

Criar somente APIs necessárias.

Preferência:

* endpoints agregados;
* paginação cursor/limit consistente com o projeto;
* queries indexadas;
* schemas Zod;
* permissions explícitas;
* validação server-side.

Não disponibilizar query SQL arbitrária.

---

# 11. Performance

As páginas de observabilidade não podem executar dezenas de requests por render.

Criar endpoints compostos/agregados quando fizer sentido.

Revisar índices existentes antes de adicionar novos.

Adicionar índice somente quando a query real justificar.

---

# 12. Frontend

Usar arquitetura existente:

* Next.js;
* TypeScript;
* Tailwind;
* shadcn/ui;
* TanStack Query;
* BFF existente.

Criar componentes reutilizáveis para:

* metric cards;
* status;
* run timeline;
* chain nodes;
* incident rows;
* filters.

Evitar dashboard visualmente poluído.

Prioridade é legibilidade operacional.

---

# 13. Segurança

Obrigatório:

* permissions no backend;
* Zod;
* nenhuma ação privilegiada confiando no frontend;
* audit log das operações administrativas;
* não retornar secrets;
* não retornar env;
* não retornar credentials de providers;
* não expor prompt interno completo sem necessidade.

A v1.6 deve respeitar o princípio permanente do projeto:

Segurança é requisito de arquitetura, não etapa posterior.

---

# 14. Testes

Adicionar testes para:

* operações dashboard aggregation;
* filtros;
* chain reconstruction;
* múltiplos filhos da mesma chain;
* circuit visibility;
* autonomy blocks;
* incident derivation;
* authorization;
* paginação;
* controles administrativos.

A correção adicionada na v1.5:

`--test-concurrency=1`

deve permanecer.

Não remover essa configuração nesta versão.

---

# 15. Regra operacional de testes

A partir desta versão:

Não executar a suíte repetidamente esperando uma falha desaparecer.

Fluxo obrigatório:

1. executar;
2. falhou;
3. diagnosticar;
4. corrigir;
5. executar novamente.

Máximo de 3 validações completas consecutivas sem descoberta nova.

Se a mesma falha aparecer novamente:

PARAR E INVESTIGAR.

Não executar uma sequência de dezenas de testes.

---

# 16. Não fazer nesta versão

Não implementar ainda:

* billing de agentes;
* marketplace;
* multi-agent chat livre;
* memória vetorial;
* RAG;
* shell;
* SQL via LLM;
* acesso arbitrário a ferramentas;
* execução remota;
* Kubernetes;
* novo workflow engine.

Manter foco em Operations & Observability.

---

# 17. Gates finais

Ao concluir:

Backend:

* typecheck;
* testes;
* migrations;
* validação de permissions.

Frontend:

* testes;
* build.

Executar smoke test somente das funcionalidades novas necessárias.

Não recriar loops autônomos grandes apenas para provar novamente a v1.5.

---

# 18. Entrega

Apresentar:

1. resumo;
2. arquitetura;
3. arquivos criados;
4. arquivos alterados;
5. migrations;
6. endpoints;
7. páginas;
8. modelo da chain;
9. incident model;
10. permissions;
11. segurança;
12. testes;
13. resultados;
14. riscos/débitos;
15. compatibilidade v1.0–v1.5;
16. recomendação final.

Não fazer commit automaticamente até a revisão final.
