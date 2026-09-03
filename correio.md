# Agentes v2.9 — Operational Resolution & Lifecycle Consistency

A v2.8 está aprovada e deve estar commitada antes desta execução.

Esta v2.9 possui somente DOIS objetivos funcionais.

## BLOQUEIO 1 — Tornar consistente o lifecycle Action Plan → Operational Action Proposal

Na v2.8, `syncActionProposalStatus()` é chamado na submissão inicial e no fluxo de resolução de Approval.

Isso funciona hoje, mas cria acoplamento perigoso: qualquer caminho presente ou futuro que altere um Action Plan para estado terminal pode esquecer de sincronizar a `OperationalActionProposal`, deixando-a presa em `planned`.

### Objetivo

Encontrar na arquitetura existente o ponto canônico em que o status agregado de um Action Plan é persistido/recalculado e fazer a sincronização da entidade de origem acontecer a partir desse ponto, ou de outra solução igualmente centralizada e comprovadamente única.

Não espalhar novos `syncActionProposalStatus()` por vários serviços.

Antes de alterar qualquer código:

* revisar integralmente `action-plan-executor.ts`;
* revisar `plan-approvals.ts`;
* revisar criação/execução de Action Plans;
* revisar Jobs/Runs;
* revisar Director Decisions;
* revisar Operational Action Proposals;
* identificar TODOS os caminhos reais que podem alterar o status de `agent_action_plans`.

A solução deve preservar:

* Action Plan independente da Proposal;
* Proposal nunca determina status do Action Plan;
* nenhum polling;
* nenhum novo worker;
* nenhum segundo executor;
* nenhum evento artificial se a arquitetura existente já fornecer um ponto central;
* idempotência;
* ausência de recursão/ciclo de sincronização.

### Regra

Se uma Proposal possui `actionPlanId`, seu estado derivado deve eventualmente refletir deterministicamente o estado terminal real do Action Plan correspondente.

Mapeamento atual deve ser revisado explicitamente, inclusive:

* `completed`
* `failed`
* `partial`
* estados não terminais
* Approval pendente/rejeitada, conforme o vocabulário REAL existente.

Não inventar estados.

---

## BLOQUEIO 2 — Operational Resolution baseada em evidência, sem auto-concluir FollowUp

A v2.8 deliberadamente não conclui um FollowUp quando uma Action Proposal ou Action Plan termina. Essa decisão permanece correta.

Agora precisamos fechar o ciclo de trabalho do operador.

### Objetivo

Ao visualizar um FollowUp, o usuário deve conseguir entender de forma estruturada:

* qual ação foi proposta;
* qual Action Plan foi gerado;
* resultado real do Action Plan;
* quantos itens executaram;
* quantos foram bloqueados;
* quantos exigiram Approval;
* quais falharam;
* se a Proposal terminou como `completed` ou `failed`;
* evidências/resultados já persistidos pelas estruturas existentes.

Esses dados devem vir das entidades existentes. Não duplicar resultados em JSON novo sem necessidade.

A partir dessas evidências, manter ações humanas semânticas e explícitas para o FollowUp, reutilizando a máquina de estados da v2.7.

Se já existem:

* complete;
* reopen;
* waiting;
* in_progress;
* resolution/resolutionNote;

reutilizar exatamente esses mecanismos.

### Regra fundamental

`Action Plan completed` NÃO significa automaticamente `FollowUp completed`.

`OperationalActionProposal completed` NÃO significa automaticamente `FollowUp completed`.

O sistema pode mostrar algo como “ação executada — aguardando resolução do acompanhamento”, mas a conclusão do FollowUp continua sendo uma decisão humana autorizada.

Da mesma forma, uma Proposal `failed` deve oferecer contexto suficiente para o operador decidir continuar, propor outra ação, alterar acompanhamento ou resolver justificadamente — nunca mudar o FollowUp automaticamente.

---

# PRINCÍPIOS BLOQUEANTES

Continuam obrigatórios:

* um único Planner;
* um único Policy Evaluator;
* um único Executor;
* um único mecanismo de Approval;
* nenhuma autorização dada por LLM;
* permissions reais do ator;
* authorization sempre server-side;
* frontend nunca é barreira de segurança;
* menor privilégio;
* nenhuma elevação implícita por Supervisor, Agent, owner ou sistema;
* nenhum acesso direto de LLM a banco, shell ou secrets;
* nenhuma alteração destrutiva de histórico;
* máquinas de estado determinísticas;
* operações concorrentes protegidas quando necessário;
* migrations antigas nunca reescritas;
* entidades relacionadas por FK real quando persistidas;
* não criar abstração genérica sem necessidade comprovada.

---

# TESTES MÍNIMOS

Além dos testes já existentes, testar explicitamente:

1. Proposal acompanha Action Plan `completed`.
2. Proposal acompanha Action Plan `failed`.
3. comportamento documentado para Action Plan `partial`.
4. estado não terminal não encerra Proposal indevidamente.
5. Approval pendente não marca Proposal como completed.
6. resolução de Approval atualiza corretamente o lifecycle final.
7. sincronização repetida é idempotente.
8. Action Plan sem Proposal continua funcionando normalmente.
9. Job Run continua funcionando normalmente.
10. Director Decision continua funcionando normalmente.
11. Action Plan criado diretamente continua independente.
12. conclusão da Proposal nunca conclui FollowUp automaticamente.
13. falha da Proposal nunca altera FollowUp automaticamente.
14. detalhe do FollowUp apresenta evidência real do Action Plan.
15. usuário sem permission não consegue concluir/reabrir FollowUp.
16. frontend não consegue falsificar status.
17. histórico permanece preservado.
18. nenhuma duplicação de Policy/Planner/Executor/Approval foi criada.

Adicionar testes extras caso a revisão arquitetural encontre outros caminhos reais de transição de Action Plan.

---

# QUALIDADE E FECHAMENTO

Antes de encerrar:

* suíte backend completa;
* suíte frontend completa;
* typecheck backend;
* typecheck frontend;
* lint frontend;
* build frontend;
* reconciliar baseline + testes novos;
* verificar migrations;
* `git diff --stat`;
* `git status`;
* arquivos criados;
* arquivos alterados;
* decisões arquiteturais;
* bugs encontrados;
* limitações reais.

Especialmente nos testes backend, garantir que resíduos de execuções interrompidas não sejam confundidos com regressão de produção. Não apagar dados automaticamente sem antes identificar claramente sua origem.

## NÃO FAZER COMMIT

Ao terminar, entregar relatório completo e aguardar revisão do Diretor/CEO.
