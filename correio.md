# Agentes — Saneamento técnico pós-v3.4

Execute exclusivamente o saneamento das 2 falhas pré-existentes identificadas no fechamento da v3.4.

## Escopo

1. `backend/src/routes/agents/job-runs.test.ts:112`

   * Investigue a causa exata do nondeterminismo do mock do LLM Interpreter.
   * O teste deve ser determinístico.
   * Não relaxe assertions apenas para fazê-lo passar.
   * Não introduza chamadas reais a LLM.
   * Preserve o comportamento funcional atual, salvo se encontrar um bug real.

2. `backend/src/routes/agents/settings.test.ts:386`

   * Investigue por que o override de `circuit.failureThreshold` não abre o circuito na primeira falha conforme esperado.
   * Determine se a divergência está na implementação, propagação/configuração do override ou no próprio teste.
   * Corrija a causa raiz.
   * Não crie um segundo mecanismo de Circuit Breaker nem bypass específico para testes.

## Restrições

* Não alterar funcionalidades da v3.4.
* Não alterar `supervisor-guard.ts`.
* Não iniciar nova versão funcional dos Agentes.
* Não criar migrations, salvo se surgir evidência inequívoca de necessidade — neste caso, pare e reporte antes.
* Não fazer rebuild/deploy dos containers permanentes.
* Não fazer commit.

## Validação obrigatória

Após as correções:

* rodar isoladamente os testes afetados múltiplas vezes para comprovar determinismo;
* executar `npx tsc --noEmit`;
* executar a suíte completa do backend com `--test-concurrency=1`;
* confirmar a meta de baseline integral, atualmente esperada em `738/738`;
* executar `git diff --check`;
* apresentar `git status`;
* explicar a causa raiz de cada falha e por que a correção não mascara regressões.

Se a suíte completa não chegar a 738/738, não trate como concluído: identifique e reporte precisamente qualquer falha restante.

Entregue relatório final para revisão, sem commit.
