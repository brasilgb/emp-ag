A suíte final está aprovada: 692/692 backend, 119/119 frontend, typecheck e lint zerados. Não investigar mais a suíte.

Restam exclusivamente dois bloqueios funcionais já solicitados:

Remover planned → cancelled. cancelActionProposal deve aceitar somente propostas submitted. Depois que existe Action Plan, a governança pertence integralmente ao Action Plan/Approval/Executor existente. Atualizar state machine, backend, frontend e testes.
Tratar falha após a reivindicação de /submit. Hoje a Proposal é reivindicada como planned antes de planEvaluateAndPersistActionPlan. Se Planner/persistência falhar, não pode permanecer planned com actionPlanId = null. Implementar solução determinística e auditável e adicionar teste que force essa falha.

Não criar novo Planner, Executor, Approval, mecanismo de cancelamento de Action Plan, polling ou arquitetura paralela.

Após as duas correções, rodar somente os testes necessários e depois a suíte completa, typecheck, lint e build. Atualizar o relatório para refletir a máquina de estados e o comportamento reais. Não fazer commit.