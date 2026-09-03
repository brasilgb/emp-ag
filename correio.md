# Execução — Agentes v2.4: Workflow Recovery, Reconciliation & Operational Resilience

## Objetivo

Implementar um mecanismo genérico e seguro de recuperação/reconciliação para workflows dos agentes que utilizam o padrão:

```text
claim persistido
→ I/O externo / processamento
→ conclusão
→ compensação via catch em falha normal
```

Hoje esse padrão aparece em pelo menos:

```text
Initiative execution
Executive Review
Strategic Memory
```

Em exceções JavaScript normais os serviços já compensam corretamente.

O problema desta versão é outro:

> Se o processo Node/container morrer depois do claim persistido e antes da conclusão/compensação, o estado transitório pode permanecer órfão indefinidamente.

A v2.4 deverá detectar e reconciliar esses estados sem criar arquitetura paralela.

---

# 1. Princípio arquitetural

Não criar:

* segundo Executor;
* segundo Scheduler de negócio;
* segundo Planner;
* segundo Policy Evaluator;
* segundo Approval Workflow;
* sistema paralelo de jobs;
* mecanismo de execução direta durante recovery.

A recuperação deve operar SOBRE os workflows existentes.

Fluxo conceitual:

```text
Existing Workflow
      ↓
Persistent Transitional State
      ↓
Process crash / interruption
      ↓
Stale Workflow Detection
      ↓
Recovery/Reconciliation
      ↓
safe_retry | revert | mark_failed | manual_attention
      ↓
Official existing pipeline
```

Recovery nunca deve significar:

```text
"execute qualquer coisa para consertar"
```

---

# 2. Estados atualmente relevantes

Levantar no código real todos os estados transitórios que podem ficar presos.

No mínimo revisar:

## Initiative

Exemplo esperado:

```text
active
```

quando existe claim/início mas Action Plan ou conclusão não foi produzida corretamente.

## Executive Review

```text
draft
```

## Strategic Memory

```text
draft
```

Não assumir esses como os únicos estados.

Antes de implementar, mapear os workflows reais e documentar:

```text
entity
transitional state
terminal states
claim timestamp
expected next transition
existing retry behavior
```

---

# 3. Conceito de stale workflow

Não usar apenas:

```text
status == draft
```

como prova de problema.

Um workflow em execução normal também pode estar temporariamente em estado transitório.

Definir stale usando tempo.

Sugestão:

```text
updated_at < now() - stale_threshold
```

ou timestamp específico de claim caso o schema atual permita.

Preferir utilizar timestamps já existentes.

Só adicionar coluna nova se houver justificativa concreta.

---

# 4. Threshold configurável

Criar configuração explícita.

Exemplo conceitual:

```text
AGENT_WORKFLOW_STALE_AFTER_SECONDS
```

ou configuração equivalente consistente com o projeto.

Deve possuir:

* valor default seguro;
* validação;
* limite mínimo razoável;
* documentação.

Não espalhar números mágicos pelo código.

Para testes, permitir threshold curto.

---

# 5. Recovery Registry

Criar um mecanismo central pequeno que conheça os workflows recuperáveis.

Exemplo conceitual:

```text
agents/recovery/
```

Possíveis arquivos:

```text
types.ts
registry.ts
detector.ts
recovery-service.ts
initiative-recovery.ts
executive-review-recovery.ts
strategic-memory-recovery.ts
```

Não é obrigatório usar exatamente estes nomes.

Cada adapter deverá saber:

```text
como detectar
como validar
como reconciliar
```

sua própria entidade.

O core de recovery não deve conhecer detalhes internos de todas as tabelas.

---

# 6. Tipos de resultado da reconciliação

Usar resultado estruturado.

Exemplo:

```text
recovered
retried
reverted
marked_failed
manual_attention
skipped
```

Não usar apenas boolean.

Cada tentativa deve explicar:

```text
entityType
entityId
previousState
result
reason
timestamp
```

---

# 7. Initiative Recovery

Revisar exatamente como `startInitiativeExecution` funciona hoje.

Não inventar comportamento sem ler o fluxo real.

Para Initiative stale:

O recovery deve primeiro verificar fatos existentes.

Exemplos:

### Caso A

Initiative `active`, mas Action Plan válido já existe.

Então não criar outro Action Plan.

Reconstruir/reconciliar a visão da Initiative a partir do estado real.

### Caso B

Initiative `active`, sem Action Plan, claim claramente stale.

Permitir voltar a um estado seguro que possibilite retry através do serviço oficial.

Não criar plano diretamente dentro do recovery.

### Caso C

Existem evidências contraditórias/corrompidas.

Não tentar adivinhar.

Marcar necessidade de atenção humana ou registrar falha operacional adequada.

---

# 8. Executive Review Recovery

Review `draft` stale:

Verificar se a review possui conteúdo completo compatível com `completed`.

Se não possuir, o comportamento preferencial é permitir retry seguro.

Exemplo:

```text
draft stale
→ remover/reverter claim
→ próxima chamada normal pode gerar novamente
```

Não chamar LLM automaticamente durante reconciliação, salvo justificativa extremamente clara.

Preferência desta versão:

> recovery torna o workflow novamente executável; não executa o workflow cognitivo sozinho.

---

# 9. Strategic Memory Recovery

Mesmo princípio da Executive Review.

```text
draft stale
→ validar
→ limpar/reverter claim
→ permitir criação normal posteriormente
```

Nunca fabricar uma memória incompleta como `active`.

Nunca copiar `lesson` ou interpretação de outro registro para “consertar”.

---

# 10. Recovery deve ser idempotente

Executar recovery duas vezes sobre o mesmo estado não pode causar dano.

Exemplo:

Primeira execução:

```text
draft stale → removed
```

Segunda:

```text
registro não existe → skipped
```

e não erro destrutivo.

Adicionar testes explícitos.

---

# 11. Concorrência no recovery

Dois processos podem tentar reconciliar a mesma entidade.

Proteger a operação.

Evitar:

```text
SELECT
→ decidir
→ UPDATE/DELETE
```

sem condição de corrida protegida.

Preferir operações condicionais:

```text
DELETE ... WHERE id=? AND status='draft' AND updated_at < threshold
```

ou:

```text
UPDATE ... WHERE ... RETURNING
```

Assim apenas um reconciliador vence.

Não segurar locks enquanto executa I/O externo.

Idealmente recovery desta versão nem precisa fazer I/O externo.

---

# 12. Recovery nunca deve elevar privilégios

O reconciliador é infraestrutura interna.

Mas isso não significa que ele possa:

* aprovar ações;
* mudar owner;
* conceder permission;
* alterar Policy Evaluator;
* ignorar Approval;
* executar tool em nome de usuário;
* criar Action Plan diretamente.

Quando o workflow precisar continuar, ele deve voltar a um estado no qual o pipeline oficial possa continuar normalmente.

---

# 13. Manual attention

Há casos em que recuperação automática seria perigosa.

Criar conceito de:

```text
manual_attention
```

Quando houver inconsistência real.

Preferencialmente reutilizar a infraestrutura existente de:

```text
Director Decision Queue
```

ou mecanismo operacional já existente, SE semanticamente apropriado.

Não criar uma segunda “fila de incidentes” sem necessidade.

Se reutilizar Decision Queue, diferenciar claramente:

```text
operational recovery issue
```

de uma decisão estratégica normal.

---

# 14. Auditoria

Adicionar eventos coerentes.

Sugestão:

```text
agents.recovery.scan.started
agents.recovery.stale_detected
agents.recovery.reconciled
agents.recovery.manual_attention
```

Não registrar evento para cada entidade saudável examinada.

Evitar ruído excessivo.

Metadata útil:

```text
workflowType
entityId
previousState
ageSeconds
action
result
reason
```

Nunca secrets.

---

# 15. Observabilidade

Criar uma visão agregada do estado de recovery.

No mínimo o backend deve conseguir informar:

```text
stale workflows total
por tipo
mais antigo
último scan
última reconciliação
manual attention pendente
```

Pode ser calculado sob demanda nesta versão.

Não precisa criar Prometheus/Grafana se o projeto ainda não usa.

---

# 16. API operacional

Criar endpoints administrativos mínimos.

Sugestão:

```text
GET  /agents/recovery/status
GET  /agents/recovery/stale
POST /agents/recovery/run
```

Possivelmente:

```text
POST /agents/recovery/:type/:id
```

somente se houver necessidade clara para recuperação manual de um item.

`POST /run` deve executar apenas a reconciliação segura definida nesta versão.

Não disparar execução arbitrária de agentes.

---

# 17. Permissions

Recovery é operação administrativa sensível.

Não usar apenas `agents.read` para executar reconciliação.

Reaproveitar uma permission administrativa existente se semanticamente correta.

Se nenhuma permission existente representar adequadamente essa capacidade, aí sim justificar uma permission nova, como:

```text
agents.recovery.manage
```

Não criar permission nova automaticamente; primeiro avaliar o modelo atual.

Leitura de status pode usar permission mais ampla de observabilidade/admin, conforme arquitetura real.

Authorization sempre backend.

---

# 18. Execução manual primeiro

Nesta versão, preferir:

```text
POST /agents/recovery/run
```

manual/administrativo.

Não criar daemon automaticamente de início.

Depois que o mecanismo estiver comprovado, podemos integrá-lo ao scheduler existente.

Isso reduz risco enquanto validamos as regras.

---

# 19. Integração futura com scheduler

A arquitetura deve permitir posteriormente algo como:

```text
reconcileStaleAgentWorkflows()
```

ser chamado pelo scheduler existente.

Não criar scheduler novo.

Não implementar recorrência automática nesta versão salvo necessidade técnica comprovada.

---

# 20. Dry-run

Adicionar capacidade de dry-run se for simples e limpa.

Exemplo:

```text
POST /agents/recovery/run?dryRun=true
```

Retorna:

```text
o que seria reconciliado
por quê
qual ação seria aplicada
```

sem alterar banco.

Isso é muito útil operacionalmente.

Se implementado, garantir que dry-run não produza efeitos colaterais.

---

# 21. Recovery report

O serviço deve retornar relatório estruturado.

Exemplo:

```json
{
  "startedAt": "...",
  "finishedAt": "...",
  "dryRun": false,
  "scanned": 12,
  "stale": 3,
  "recovered": 2,
  "manualAttention": 1,
  "items": [...]
}
```

Nunca esconder erros individuais.

Se uma entidade falhar na reconciliação, avaliar se o scan pode continuar nas demais.

Preferência:

```text
best-effort por item
```

com relatório completo.

---

# 22. Tratamento de erro

Distinguir:

```text
workflow não stale
workflow já reconciliado
workflow inconsistente
erro operacional do DB
erro inesperado
```

Não transformar tudo em 500 genérico internamente.

API pode mapear conforme padrão atual de `AgentError`.

---

# 23. Segurança contra deleção indevida

Qualquer DELETE usado para limpar claims deve possuir predicados fortes.

Exemplo conceitual:

```text
id = ?
AND status = 'draft'
AND updated_at < staleBefore
```

Nunca:

```text
DELETE WHERE status='draft'
```

como operação cega.

Preferir `RETURNING`.

Adicionar teste garantindo que registro recente não seja removido.

---

# 24. Testes obrigatórios

Adicionar no mínimo:

### Detection

1. Initiative stale é detectada.
2. Initiative recente não é stale.
3. Executive Review draft stale é detectada.
4. Review draft recente não é stale.
5. Strategic Memory draft stale é detectada.
6. Memory draft recente não é stale.

### Recovery

7. Review draft stale volta a permitir retry.
8. Memory draft stale volta a permitir retry.
9. Recovery não remove review completed.
10. Recovery não remove memory active.
11. Initiative com Action Plan existente não cria segundo plano.
12. Initiative stale sem plano volta a estado seguro conforme fluxo real.
13. Inconsistência relevante gera manual_attention.

### Idempotência/concorrência

14. Duas reconciliações concorrentes produzem um único efeito.
15. Recovery repetido é idempotente.
16. Entidade alterada por outro processo antes do recovery é skipped com segurança.

### Segurança

17. Recovery nunca cria approval.
18. Recovery nunca executa tool.
19. Recovery nunca modifica permission.
20. Recovery nunca altera Policy Evaluator.
21. Usuário sem permission não executa `/recovery/run`.

### Dry-run

22. Dry-run detecta os mesmos stale items.
23. Dry-run não altera banco.
24. Dry-run não gera side effects.

### Observabilidade/auditoria

25. stale_detected é auditado quando apropriado.
26. reconciled contém entity/type/reason.
27. manual_attention fica visível.
28. status agregado retorna contagens corretas.

Adicionar outros testes conforme o código real exigir.

---

# 25. Regressão

Baseline atual após v2.3:

Backend:

```text
491 tests
491 pass
0 fail
```

Frontend:

```text
82 tests
82 pass
0 fail
```

Executar suíte completa.

Reconciliar matematicamente:

```text
baseline
+ novos testes
= total final
```

Não aceitar somente suítes novas.

---

# 26. Frontend

Criar tela operacional simples.

Sugestão:

```text
/agents/recovery
```

Mostrar:

```text
Saúde dos workflows
Stale total
Initiatives
Executive Reviews
Strategic Memories
Mais antigo
Manual attention
Última execução
```

Ações:

```text
Simular recuperação
Executar recuperação
```

Exibir confirmação adequada antes de operação real.

Não apresentar isso como ferramenta diária do usuário comum.

É tela administrativa/operacional.

---

# 27. UX do dry-run

Após simular:

Mostrar tabela/lista:

```text
Tipo
ID
Estado
Idade
Problema
Ação proposta
```

Somente depois permitir executar recovery real.

Não é obrigatório forçar dry-run antes da operação real no backend, mas a UI pode privilegiar esse fluxo.

---

# 28. Typecheck/build

Executar:

Backend:

```bash
npx tsc --noEmit
```

Frontend:

```bash
npx tsc --noEmit
npm run build
```

Se lint continuar inexistente, apenas registrar.

---

# 29. Migration

Evitar migration se timestamps/estados atuais forem suficientes.

Se for necessária migration, usar:

```text
drizzle-kit generate
drizzle-kit migrate
```

e validar:

```text
SQL
_journal.json
snapshot
__drizzle_migrations
```

Não criar colunas apenas por conveniência.

---

# 30. Critérios de aprovação

A v2.4 só estará aprovada se:

1. workflows stale forem detectados com threshold temporal;
2. registros recentes não forem confundidos com stale;
3. recuperação for idempotente;
4. concorrência estiver protegida;
5. Executive Review draft órfã puder ser recuperada;
6. Strategic Memory draft órfã puder ser recuperada;
7. Initiative órfã puder ser reconciliada com segurança;
8. recovery nunca criar segundo Action Plan;
9. recovery nunca executar tool;
10. recovery nunca criar approval;
11. recovery nunca modificar permissions;
12. inconsistências perigosas forem escaladas para atenção humana;
13. dry-run não tiver side effects;
14. operações forem auditáveis;
15. status agregado existir;
16. permission administrativa proteger execução;
17. nenhuma arquitetura paralela tiver sido criada;
18. backend completo passar;
19. frontend completo passar;
20. typechecks passarem;
21. build passar.

---

# 31. Relatório final obrigatório

Ao concluir, NÃO faça commit.

Entregar `executed.md` contendo:

1. resumo;
2. problema estrutural resolvido;
3. workflows mapeados;
4. arquitetura de recovery;
5. definição de stale;
6. configuração/threshold;
7. registry/adapters;
8. Initiative recovery;
9. Executive Review recovery;
10. Strategic Memory recovery;
11. regras de idempotência;
12. proteção concorrente;
13. dry-run;
14. manual attention;
15. integração com Decision Queue, se usada;
16. auditoria;
17. observabilidade/status;
18. API;
19. permissions;
20. frontend;
21. migrations, se houver;
22. arquivos criados;
23. arquivos alterados;
24. testes adicionados;
25. números exatos backend;
26. números exatos frontend;
27. typecheck/build;
28. `git diff --stat`;
29. `git status`;
30. bugs/limitações reais encontradas.

Não esconder limitações.

**NÃO REALIZAR COMMIT.**

Aguardar aprovação final do Diretor/CEO.
