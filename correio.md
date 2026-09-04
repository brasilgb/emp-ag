# Agentes v3.2 — Operational Supervision Resilience & Incident Isolation

## Objetivo

Fortalecer o **Operational Supervisor existente**, garantindo que a falha ao processar **um incidente individual** não interrompa o processamento dos demais incidentes encontrados no mesmo scan.

Esta versão é uma evolução estritamente incremental da arquitetura já existente.

Não criar:

* segundo Operational Supervisor;
* segundo scheduler;
* nova cadeia de execução;
* novo Planner;
* novo Policy Evaluator;
* novo Executor;
* novo Approval Workflow;
* mecanismo paralelo de Escalation/FollowUp;
* mecanismo paralelo de deduplicação;
* Proposal automática;
* Action Plan automático;
* autonomia adicional.

O foco é exclusivamente **resiliência, isolamento de falha e observabilidade do ciclo de supervisão existente**.

---

# 1. Princípio bloqueante

Antes de alterar qualquer código:

1. revisar integralmente:

   * `agents/operations/supervisor-service.ts`;
   * `response-policy.ts`;
   * `safe-actions.ts`;
   * `supervisor-guard.ts`;
   * `scheduler.ts`;
   * Escalation;
   * FollowUp;
   * auditoria relacionada;
   * testes existentes;

2. localizar exatamente:

   * onde cada incidente é avaliado;
   * onde `applyResponse` é chamado;
   * quais exceções podem ser lançadas;
   * quais efeitos colaterais podem ocorrer antes de uma exceção;
   * como Escalation é criada;
   * como deduplicação funciona;
   * quais audit events já existem.

**Não implementar antes dessa revisão.**

Se o comportamento pedido já existir integralmente, não duplicar código: comprovar por testes e documentação.

---

# 2. Problema confirmado na v3.1

A revisão da v3.1 identificou uma limitação real:

* `escalateSupervisorFinding(...)` já possui isolamento por incidente;
* `applyResponse(...)`, porém, não está integralmente isolado por incidente;
* uma exceção durante a resposta segura de um incidente pode interromper o restante do loop daquele scan;
* o próximo scan continua funcionando, mas os demais incidentes daquele mesmo ciclo deixam de ser processados.

A v3.2 deve corrigir **somente essa granularidade de isolamento**.

---

# 3. Resultado esperado

Para uma lista:

```text
Incident A
Incident B
Incident C
Incident D
```

se `Incident B` falhar durante sua resposta operacional:

```text
A -> processado normalmente
B -> falha isolada + auditada
C -> processado normalmente
D -> processado normalmente
```

O scan deve chegar ao final.

Uma falha individual **não pode abortar os demais incidentes**.

---

# 4. Isolamento por incidente

O processamento conceitual deve permanecer equivalente a:

```text
collect signals
    ↓
classify incidents
    ↓
for each incident
    ↓
evaluate response policy
    ↓
apply existing safe response
    ↓
create/reuse escalation when applicable
    ↓
continue
```

Cada incidente deve possuir boundary de erro própria.

Não transformar tudo em uma transaction global que faça rollback dos incidentes anteriores.

Não criar fila paralela.

Não criar retry infinito.

Não ocultar falhas.

---

# 5. Semântica de falha

Definir claramente o que significa uma falha individual.

Se uma resposta segura falhar:

* capturar a exceção;
* registrar audit;
* registrar contexto suficiente para diagnóstico;
* preservar os efeitos válidos que já tenham sido confirmados, se a operação atual não possuir transação atômica;
* nunca fingir sucesso;
* continuar para o próximo incidente.

Não fazer compensações automáticas novas sem necessidade arquitetural comprovada.

---

# 6. Auditabilidade

Antes de criar evento novo, pesquisar os eventos existentes em:

```text
agents.operations.*
```

Reutilizar nomenclatura e infraestrutura atuais.

Se nenhum evento representar corretamente uma falha individual de processamento, criar **um evento coerente com o domínio existente**, por exemplo conceitualmente:

```text
agents.operations.incident.failed
```

O nome final deve seguir o padrão real encontrado no código.

O evento deve permitir identificar, quando disponíveis:

* finding/incident;
* tipo;
* severity;
* responsibility;
* action/response tentada;
* erro;
* timestamp;
* scan relacionado.

Não registrar secrets, tokens, payloads sensíveis ou stack traces desnecessárias no audit persistido.

Logs técnicos podem conter detalhes adicionais adequados ao ambiente.

---

# 7. Resultado global do scan

Revisar como `scan.completed` representa o resultado.

O scan não deve ser reportado como totalmente bem-sucedido quando houve falhas individuais.

Se a estrutura atual permitir, o summary deverá distinguir pelo menos:

```text
evaluated
handled
failed
escalated
```

ou os equivalentes já existentes.

**Não quebrar contratos públicos existentes desnecessariamente.**

Se alterar a forma retornada implicar breaking change, manter compatibilidade e adicionar informação de maneira aditiva.

---

# 8. Scheduler

Não modificar a arquitetura do scheduler.

O scheduler automático da v3.1 continua apenas chamando:

```text
runGuardedOperationalSupervision(...)
```

que continua chamando o mesmo:

```text
runOperationalSupervision(...)
```

A v3.2 não deve criar tratamento especial somente para chamadas automáticas.

A melhoria deve funcionar igualmente para:

* supervisão manual;
* supervisão automática.

---

# 9. Guard de concorrência

Não alterar o guard atual nesta versão.

Continuamos aceitando:

* uma instância de backend;
* guard de processo;
* nenhuma execução concorrente manual/automática.

Lock distribuído continua fora do escopo até haver deploy horizontal real.

---

# 10. Escalations

Não reimplementar Escalation.

Continuar usando a infraestrutura já existente.

Preservar:

* deduplication;
* `dedupKey`;
* ownership/responsibility resolution;
* políticas existentes;
* auditoria;
* lifecycle atual.

Uma falha ao criar Escalation de um incidente deve continuar isolada dos demais.

---

# 11. FollowUps

Nenhuma mudança de lifecycle.

A supervisão automática/manual:

* pode originar Escalation;
* Escalation pode originar FollowUp conforme mecanismo atual.

O Supervisor **não pode**:

* marcar FollowUp como `completed`;
* marcar FollowUp como `dismissed`;
* alterar terminal state reservado à ação humana.

---

# 12. Action Proposals

Continuam proibidas automaticamente.

Confirmar que nenhum novo caminho desta versão chama:

```text
createActionProposal
submitActionProposal
```

ou equivalentes.

Proposal continua dependente de decisão humana explícita.

---

# 13. Action Plans / Planner / Executor

A v3.2 não pode chamar automaticamente:

```text
Planner
Policy Evaluator de Action Plan
executeActionPlan
Executor
Approval Workflow
```

O limite da supervisão continua:

```text
Signal
→ Finding/Incident
→ Safe operational response
→ Escalation
→ FollowUp
→ humano
```

---

# 14. Idempotência

Revisar efeitos das safe actions existentes.

A correção de isolamento não deve introduzir repetição indevida de efeitos em scans posteriores.

Preservar os mecanismos atuais de:

* idempotência;
* deduplicação;
* circuit breaker;
* status;
* escalations.

Não criar segunda camada de deduplicação.

---

# 15. Transações

Não envolver automaticamente o scan inteiro numa única transaction.

Se uma safe action individual já utiliza transaction, preservar.

Se existir uma inconsistência real em determinada operação individual, corrigir somente no menor boundary seguro.

Objetivo:

```text
falha em B
```

não deve causar:

```text
rollback de A
```

nem impedir:

```text
C e D
```

---

# 16. Permissões

Nenhuma permission nova salvo impossibilidade comprovada.

A supervisão deve continuar obedecendo às permissions já existentes:

```text
agents.operations.read
agents.operations.manage
```

e às regras internas já implementadas.

Esta versão não pode elevar autonomia ou permissions.

---

# 17. Control Center

Nenhuma nova tela é necessária por padrão.

Verificar apenas se os resultados após falhas parciais continuam coerentemente refletidos pelo Control Center existente.

Se Escalations/FollowUps válidos forem criados durante um scan parcialmente falho, eles devem aparecer normalmente no Control Center.

Não criar segundo dashboard.

---

# 18. Testes mínimos obrigatórios

Adicionar testes somente onde houver lacuna real.

Cobrir explicitamente:

1. três incidentes válidos → todos processados;
2. incidente do meio falha em `applyResponse` → próximo incidente ainda executa;
3. primeiro incidente falha → os restantes continuam;
4. último incidente falha → anteriores permanecem válidos;
5. múltiplos incidentes falham independentemente;
6. falha individual gera auditoria;
7. scan chega a `completed` mesmo com falha parcial controlada;
8. summary distingue falhas quando suportado;
9. Escalation válida criada antes de outra falha não desaparece;
10. Escalation válida posterior à falha ainda pode ser criada;
11. deduplicação continua funcionando;
12. FollowUps continuam refletidos corretamente;
13. nenhum FollowUp terminal é alterado automaticamente;
14. nenhuma Proposal automática é criada;
15. nenhum Action Plan automático é criado;
16. Planner não é acionado;
17. Executor não é acionado;
18. permissions/autonomia não são elevadas;
19. chamada manual possui o novo isolamento;
20. chamada automática possui o mesmo isolamento;
21. falha estrutural na coleta inicial de sinais continua sendo falha do scan, e não deve ser mascarada como simples falha individual;
22. scheduler continua vivo após uma falha estrutural de scan;
23. Control Center continua coerente depois de scan parcialmente bem-sucedido;
24. suíte Jobs continua verde;
25. suíte Director continua verde;
26. suíte Action Plans continua verde.

---

# 19. Diferenciar dois tipos de falha

A implementação deve preservar a diferença entre:

## Falha individual

Exemplo:

```text
applyResponse(incident B) throws
```

Resultado:

```text
audita B
continua C
continua D
scan completa com falha parcial
```

## Falha estrutural do scan

Exemplo:

```text
não consegue coletar sinais do banco
```

Resultado:

```text
scan falha
scheduler captura no boundary já existente
audita scheduler.failed quando automático
próximo tick continua possível
```

Não transformar falha estrutural em sucesso parcial.

---

# 20. Não engolir exceções silenciosamente

Todo `catch` introduzido precisa ter propósito explícito.

Proibido:

```ts
catch {
  // ignore
}
```

A menos que seja comportamento já arquiteturalmente justificado e auditado por outro boundary.

Falhas individuais devem ser observáveis.

---

# 21. Compatibilidade

Preservar:

* rotas existentes;
* frontend;
* scheduler;
* settings;
* env vars;
* schema;
* migrations;
* permissions;
* contracts, salvo extensão aditiva necessária.

**Zero migration é o resultado esperado**, salvo prova concreta de necessidade.

Não criar migration para armazenar algo que já pertence ao audit log existente.

---

# 22. Segurança

Revalidar que nenhum erro registrado exponha:

* credentials;
* tokens;
* cookies;
* connection strings;
* prompts sensíveis;
* secrets de integração;
* dados pessoais desnecessários.

Persistir somente contexto operacional necessário.

---

# 23. Documentação no código

Comentários somente quando explicarem decisão arquitetural não óbvia.

Especialmente documentar o boundary:

```text
a falha de um incidente não deve impedir o processamento dos demais
```

Evitar comentários que apenas repitam o código.

---

# 24. Execução dos testes

Rodar:

```text
backend targeted tests
backend full suite
frontend full suite
backend typecheck
frontend typecheck
frontend lint
backend build
frontend build
```

Se a alteração for exclusivamente backend, a suíte frontend ainda deve ser executada ao menos uma vez como regressão final.

Não aceitar flakiness como sucesso.

Se algum teste falhar, identificar causa raiz.

---

# 25. Baseline

Usar como baseline inicial:

```text
Backend: 713 testes
Frontend: 119 testes
```

Reconciliar precisamente qualquer diferença.

Exemplo:

```text
baseline backend: 713
novos testes: +N
resultado esperado: 713 + N
resultado medido: X
```

Não aceitar simplesmente “todos passaram” sem reconciliação da contagem.

---

# 26. Git

Antes de qualquer commit apresentar:

```bash
git status
git diff --stat
```

e identificar separadamente:

* arquivos de produção;
* testes;
* documentação;
* configuração.

Não fazer commit até aprovação do Diretor/CEO.

---

# 27. Relatório final obrigatório

Entregar relatório contendo:

1. resumo;
2. revisão da arquitetura encontrada;
3. causa exata da limitação;
4. solução adotada;
5. boundary de isolamento;
6. comportamento de falha individual;
7. comportamento de falha estrutural;
8. auditoria;
9. Escalations;
10. FollowUps;
11. confirmação de ausência de Proposal automática;
12. confirmação de ausência de Action Plan automático;
13. scheduler;
14. concorrência;
15. Control Center;
16. permissions;
17. migrations;
18. arquivos criados;
19. arquivos alterados;
20. testes adicionados;
21. números exatos das suítes;
22. reconciliação do baseline;
23. typecheck/lint/build;
24. bugs encontrados;
25. limitações reais;
26. débitos técnicos;
27. decisões interpretativas;
28. `git diff --stat`;
29. `git status`;
30. estado dos containers/deploy;
31. confirmação de que nenhum mecanismo paralelo foi criado.

---

# 28. Gate esperado

A v3.2 somente será considerada aprovável se pudermos afirmar:

```text
Uma falha operacional em um incidente individual
não interrompe os demais incidentes do mesmo scan.
```

e simultaneamente:

```text
Falhas estruturais continuam visíveis.
Nenhuma autonomia nova foi criada.
Nenhuma Proposal é criada automaticamente.
Nenhum Action Plan é criado automaticamente.
Nenhum segundo Supervisor/Scheduler/Executor existe.
Escalation e FollowUp continuam usando a cadeia governada existente.
```

---

## Regra final

**Não faça commit.**

Execute a v3.2, rode os testes, apresente o relatório completo e aguarde aprovação do Diretor/CEO.
