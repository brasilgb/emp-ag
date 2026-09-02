# Saneamento final — Agentes v2.1

A implementação da v2.1 está funcional, mas antes da aprovação final precisamos resolver três pontos arquiteturais/semânticos.

**NÃO adicionar novas funcionalidades.**

**NÃO redesenhar a v2.1.**

**NÃO fazer commit.**

Corrigir ou comprovar somente os itens abaixo e executar novamente todas as validações.

---

## 1. Não manter transação/row lock durante Planner ou LLM

O relatório informa que `startInitiativeExecution()` mantém:

```text
SELECT ... FOR UPDATE
+
transação
```

desde o claim da Initiative até o término de:

```text
planEvaluateAndPersistActionPlan()
executeActionPlan()
```

Precisamos corrigir isso.

Não manter uma transação PostgreSQL aberta enquanto houver:

* chamada ao LLM;
* Planner;
* provider externo;
* operação potencialmente demorada;
* execução de Action Plan.

Isso pode produzir lock prolongado, contenção no pool e degradação operacional.

### Objetivo

Preservar simultaneamente:

```text
duas chamadas concorrentes
→ apenas um início efetivo
→ apenas um Action Plan associado
```

SEM manter row lock durante chamadas externas.

### Investigar a melhor solução usando a arquitetura existente

Preferir mecanismo de claim curto e atômico.

Exemplos conceituais possíveis:

```text
CAS de estado/token
```

ou mecanismo equivalente.

A ideia é:

```text
transação curta:
    validar
    adquirir direito exclusivo de iniciar
commit

fora da transação:
    planner / policy / persist plan / executor

transação curta:
    vincular resultado
```

Mas não implementar esse pseudofluxo cegamente.

Primeiro analisar schema e serviços existentes e encontrar a solução mais simples que:

* seja concorrente;
* seja idempotente;
* não exija migration se desnecessário;
* não permita Action Plan duplicado;
* permita recuperação limpa se planejamento falhar;
* não deixe Initiative eternamente em estado intermediário;
* não mantenha lock durante LLM.

Se for impossível garantir isso com o schema atual sem uma alteração mínima, documentar claramente antes de introduzir nova coluna/constraint.

Não criar arquitetura complexa desnecessariamente.

### Teste obrigatório

Criar/manter teste real:

```text
Promise.all([
  startInitiativeExecution(...),
  startInitiativeExecution(...)
])
```

Resultado:

```text
1 execução efetiva
1 Action Plan
mesmo actionPlanId retornado ou estado idempotente equivalente
0 duplicações
```

E provar que a transação que faz o claim NÃO envolve Planner/LLM.

---

## 2. Verificar semântica de conclusão manual

Investigar exatamente o comportamento atual de:

```text
POST .../complete
completeInitiative()
```

Responder objetivamente:

### Caso

Initiative:

```text
status = active
```

Action Plan:

```text
7 itens
5 completed
1 waiting_approval
1 pending
```

O endpoint manual permite:

```text
active → completed
```

?

Se SIM, isso permite declarar concluída uma Initiative cuja execução objetivamente ainda não terminou.

Nesse caso, corrigir.

A v2.1 definiu conclusão operacional baseada em evidência determinística:

```text
Action Plan concluído
AND
todos os Action Plan Items concluídos com sucesso
```

Portanto o caminho normal de conclusão deve respeitar essa regra.

Se existir uma razão legítima para manter conclusão humana independente da execução, ela precisa ter semântica distinta e explicitamente documentada; não presumir isso.

Para esta v2.1, preferir não criar conceito novo.

### Testes obrigatórios

Cobrir:

```text
active + itens pendentes → não pode completed
active + waiting approval → não pode completed
active + blocked/failed → não pode completed
active + todos completed → completed permitido
```

Verificar tanto sincronização automática quanto endpoint manual, se ele continuar existindo.

---

## 3. Verificar significado real de `skipped`

Hoje:

```text
blockedItems = blocked | skipped
```

e:

```text
blocked/skipped + nada em voo
→ Initiative.status = blocked
```

Não assumir que isso é correto apenas pelo nome.

Investigar no executor existente todos os locais onde:

```text
execution_status = 'skipped'
```

é produzido.

Documentar as causas reais.

### Decisão

Se `skipped` significar necessariamente:

```text
não executado por impedimento/dependência bloqueada
```

a classificação atual pode permanecer.

Se houver casos onde `skipped` represente uma conclusão terminal não problemática, não tratá-lo automaticamente como `blocked`.

Não mudar sem antes provar a semântica no código existente.

Adicionar teste representando cada causa real de `skipped` encontrada.

---

# Validação final

Depois das correções:

```text
backend typecheck
backend tests completos

frontend typecheck
frontend tests completos
frontend build
```

Se o projeto realmente não possui lint configurado, apenas registrar isso novamente.

Não estimar números.

Usar números reais do runner.

---

# Relatório final

Entregar somente:

1. causa raiz dos três pontos;
2. solução aplicada;
3. como a concorrência funciona agora;
4. prova de que não existe transação/lock durante LLM;
5. regra definitiva de conclusão;
6. semântica real de `skipped`;
7. arquivos alterados;
8. testes adicionados/modificados;
9. números exatos da suíte;
10. typecheck/build;
11. `git diff --stat`;
12. `git status`.

Se algum dos três pontos já estiver correto, provar com código/teste em vez de modificá-lo.

**NÃO FAZER COMMIT.**

Aguardar autorização final do Diretor/CEO.
