# Agentes v3.0 — Operational Observability & Control Center

A v2.9 está aprovada e deve estar commitada antes desta execução.

## Objetivo

Criar uma camada de observabilidade operacional sobre tudo o que já foi construído, sem adicionar nova autonomia, novo Planner, nova Policy, novo Executor, novo mecanismo de Approval ou nova máquina de execução.

O sistema deve permitir ao operador entender rapidamente:

* o que está acontecendo;
* o que está parado;
* o que está vencido;
* o que precisa de aprovação;
* o que falhou;
* qual Responsibility/Agent originou o caso;
* qual Escalation/FollowUp está associada;
* quais ações foram propostas;
* quais Action Plans resultaram dessas propostas;
* quais ações foram executadas, bloqueadas ou aguardam aprovação;
* quem tomou cada decisão;
* e qual foi o resultado final.

## Princípios bloqueantes

1. Não criar segundo Planner.
2. Não criar segundo Policy Evaluator.
3. Não criar segundo Executor.
4. Não criar segundo Approval Workflow.
5. Não criar mecanismo paralelo de Jobs/Scheduler/Supervisor.
6. Não alterar sem necessidade as máquinas de estado já aprovadas.
7. Não criar estado derivado persistido se puder ser calculado com segurança a partir das estruturas existentes.
8. Não duplicar auditoria.
9. Não conceder acesso a dados de outra entidade sem respeitar sua permission própria.
10. Frontend nunca é barreira de segurança.
11. Toda autorização permanece no backend.
12. LLM não participa de autorização, permission, ownership ou transições.
13. Não criar polling agressivo ou infraestrutura nova de eventos apenas para montar dashboards.
14. Nenhuma migration antiga pode ser alterada.
15. Migration nova somente se houver necessidade estrutural comprovada.

## Etapa 1 — Revisão arquitetural obrigatória

Antes de escrever código, revisar integralmente as estruturas existentes relacionadas a:

* Responsibilities;
* Operations Supervisor;
* Escalations;
* FollowUps;
* Operational Action Proposals;
* Action Plans;
* Action Plan Items;
* Approvals;
* Jobs/Runs;
* Director Decisions/Initiatives, se participarem da execução operacional;
* audit log existente;
* permissions;
* endpoints já existentes;
* hooks e páginas frontend já existentes.

Mapear quais informações já podem ser obtidas diretamente sem criar novos campos ou tabelas.

Registrar no relatório a revisão antes de implementar.

## Etapa 2 — Operational Control Center

Criar uma página operacional central, preferencialmente reutilizando ou evoluindo o dashboard existente do Operations Supervisor, em vez de criar navegação paralela sem necessidade.

A página deve apresentar, no mínimo:

### Visão geral

Indicadores derivados de dados reais:

* Responsibilities ativas;
* Escalations abertas;
* FollowUps abertos;
* FollowUps vencidos;
* Action Proposals `submitted`;
* Proposals `planned`;
* Proposals `failed`;
* Action Plans aguardando Approval;
* Action Plans bloqueados/parciais/falhos quando aplicável;
* Approvals pendentes;
* Jobs com falhas recentes, se já houver relação operacional útil.

Não persistir esses números em uma nova tabela se puderem ser calculados com consultas existentes.

### Filas operacionais

Separar claramente:

* Precisa de atenção agora;
* Aguardando humano;
* Falhou;
* Em execução/acompanhamento;
* Resolvido recentemente.

Os critérios devem ser determinísticos e documentados.

Não inventar “prioridade de IA”.

## Etapa 3 — Timeline operacional

Para um FollowUp ou outro caso operacional relevante, oferecer uma timeline derivada das estruturas reais existentes.

Exemplo conceitual:

Responsibility
→ Supervisor detectou situação
→ Escalation criada
→ FollowUp criado
→ Action Proposal criada
→ submetida
→ Action Plan criado
→ item exigiu Approval
→ Approval aprovada/rejeitada
→ execução
→ resultado
→ Proposal completed/failed
→ FollowUp concluído/descartado pelo humano

A timeline não deve criar uma segunda fonte de histórico.

Prioridade de implementação:

1. reutilizar audit log existente;
2. complementar com entidades persistidas quando necessário;
3. somente criar estrutura nova se existir um gap real impossível de resolver com os dados atuais.

## Etapa 4 — Evidência e drill-down

A partir do Control Center, permitir navegar para as páginas existentes:

* Responsibility;
* Escalation;
* FollowUp;
* Proposal;
* Action Plan;
* Approval;
* Job/Run quando relevante.

Não duplicar telas completas que já existem.

Adicionar apenas resumos úteis para decidir para onde navegar.

## Etapa 5 — SLA operacional derivado

Avaliar se já existem timestamps suficientes para identificar:

* FollowUp vencido;
* FollowUp sem atualização há muito tempo;
* Approval pendente há muito tempo;
* Proposal `submitted` não processada;
* Proposal `failed`;
* execução com falha;
* Escalation sem FollowUp quando deveria possuir um.

Preferir regras derivadas.

Se algum SLA depender de configuração inexistente, documentar primeiro a necessidade e escolher o menor modelo possível.

Não introduzir um motor genérico de SLA nesta versão.

## Etapa 6 — Segurança e permissions

Revisar permissions de cada informação exibida.

Exemplos:

* `agents.followups.read` não deve implicitamente conceder conteúdo completo de Action Plan;
* evidência de Action Plan continua exigindo `agents.plan.read`;
* Approvals devem continuar respeitando permission própria;
* ações operacionais continuam exigindo suas permissions atuais.

O backend deve filtrar/proteger os dados independentemente do frontend.

## Etapa 7 — Auditoria

Não duplicar eventos existentes.

A interface deve usar a auditoria como fonte de evidência quando possível.

Se for necessário adicionar audit a alguma ação atualmente não auditada, justificar objetivamente.

## Etapa 8 — Testes mínimos

Adicionar testes para pelo menos:

1. métricas do Control Center refletem registros reais;
2. FollowUp terminal não aparece como aberto;
3. FollowUp vencido calculado corretamente;
4. Proposal failed aparece na fila de falhas;
5. Approval pendente aparece na fila humana;
6. Action Plan sem Proposal continua independente;
7. usuário sem permission não recebe dados protegidos;
8. nenhuma consulta altera estado;
9. timeline preserva ordem temporal;
10. timeline não inventa evento inexistente;
11. Proposal completed não significa FollowUp completed;
12. Proposal failed não significa FollowUp failed/concluído;
13. dados de Action Plan respeitam `agents.plan.read`;
14. nenhuma nova autorização é tomada no frontend;
15. Jobs/Director continuam funcionando sem regressão;
16. baseline completo continua reconciliado.

## Verificação obrigatória

Executar:

* testes específicos;
* suíte completa backend;
* suíte completa frontend;
* typecheck backend;
* typecheck frontend;
* lint frontend;
* build backend;
* build frontend.

Baseline atual oficial:

* Backend: 700 testes.
* Frontend: 119 testes.

Qualquer divergência deve ser reconciliada objetivamente.

## Entrega

Não fazer commit.

Entregar relatório contendo:

1. resumo;
2. revisão arquitetural realizada;
3. estruturas reutilizadas;
4. Control Center implementado;
5. métricas implementadas e suas fórmulas/regras;
6. filas operacionais e critérios;
7. timeline;
8. drill-down;
9. permissions;
10. auditoria;
11. migrations;
12. arquivos criados;
13. arquivos alterados;
14. testes novos;
15. números exatos das suítes;
16. reconciliação do baseline;
17. typecheck/lint/build;
18. bugs encontrados;
19. limitações reais;
20. débitos técnicos;
21. decisões interpretativas;
22. `git diff --stat`;
23. `git status`;
24. confirmação de que não foi criado novo Planner/Policy/Executor/Approval/Scheduler;
25. confirmação de que nenhuma informação derivada foi persistida desnecessariamente.

Não fazer commit. Aguardar revisão do Diretor/CEO.
