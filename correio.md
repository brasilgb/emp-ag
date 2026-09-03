# Execução — Agentes v2.3: Strategic Learning & Organizational Memory

## Objetivo

Implementar uma camada de **memória organizacional estratégica** para o Diretor Virtual.

O sistema deve passar a aprender com:

* Goals anteriores;
* Initiatives anteriores;
* Action Plans executados;
* Executive Reviews da v2.2;
* resultados obtidos;
* recomendações anteriores;
* decisões humanas relevantes;
* evidências de execução já persistidas.

A memória servirá exclusivamente como **contexto consultivo para análise e planejamento**.

Ela NUNCA deverá:

* conceder permissão;
* alterar authorization;
* aprovar uma ação;
* executar tools;
* modificar Policy Evaluator;
* modificar autonomia;
* substituir evidência atual;
* modificar diretamente Goals ou Initiatives;
* ser tratada como verdade absoluta.

O princípio obrigatório é:

> Histórico pode orientar uma decisão futura, mas nunca autorizar sua execução.

---

# 1. Arquitetura obrigatória

Não criar um novo mecanismo de execução, planner, approval ou policy.

A cadeia existente deve continuar sendo:

CEO Goal
→ Director Analysis
→ Initiative
→ Action Plan
→ Policy Evaluator
→ Executor
→ Execution Evidence
→ Executive Review
→ Recommendation

A v2.3 adicionará uma camada transversal:

Strategic Memory
→ utilizada como contexto pelo Diretor

Portanto:

```text
Historical Goals
Historical Initiatives
Historical Reviews
Historical Decisions
Historical Evidence
        ↓
Strategic Memory Retrieval
        ↓
Director Context
        ↓
Director Analysis / Recommendation
```

A memória nunca entra diretamente no Executor.

---

# 2. Conceito de Strategic Memory

Criar uma representação persistente e auditável de aprendizados organizacionais.

Sugestão de entidade:

`agent_strategic_memories`

Campos mínimos:

```text
id
memory_type
domain
title
summary
lesson
outcome
confidence
importance
source_goal_id
source_initiative_id
source_review_id
source_decision_id
evidence
status
created_by
created_at
updated_at
```

Os nomes finais podem ser adaptados ao padrão atual do repositório.

## memory_type

Inicialmente:

```text
initiative_outcome
strategic_lesson
decision_outcome
recurring_pattern
```

Não criar dezenas de tipos nesta versão.

## status

Sugestão:

```text
active
superseded
archived
```

Nunca deletar silenciosamente memória estratégica relevante.

---

# 3. Proveniência obrigatória

Toda memória deve possuir origem rastreável.

Uma memória NÃO pode simplesmente afirmar:

> campanhas desse tipo não funcionam.

Ela precisa conseguir responder:

```text
sourceGoalId
sourceInitiativeId
sourceReviewId
sourceDecisionId
evidence
```

conforme o tipo de memória.

O LLM nunca poderá inventar provenance.

IDs e evidências devem ser anexados deterministicamente pelo backend.

---

# 4. Criação da memória

A principal fonte inicial deverá ser a `Executive Review` criada na v2.2.

Após uma Executive Review `completed`, o sistema poderá gerar um aprendizado estratégico.

Criar um serviço explícito, por exemplo:

```text
createStrategicMemoryFromReview()
```

ou equivalente consistente com a arquitetura existente.

Não criar um novo daemon nesta versão.

Pode ser utilizado endpoint explícito ou integração segura imediatamente após conclusão da review, desde que:

* seja idempotente;
* não segure transaction durante chamada ao LLM;
* não provoque execução;
* não altere automaticamente outras entidades.

---

# 5. Separar fatos de interpretação

Esta é uma exigência central da v2.3.

A memória deverá distinguir:

## Evidência

Dados reais e determinísticos:

* Goal;
* Initiative;
* Action Plan;
* execução;
* Executive Review;
* Decision;
* métricas existentes.

## Lesson / Interpretation

Conclusão estratégica produzida pelo Diretor/LLM.

Nunca misturar os dois campos.

Exemplo:

```json
{
  "evidence": {
    "initiativeOutcome": "unsuccessful",
    "expectedResult": "...",
    "actualResult": "..."
  },
  "lesson": "A estratégia X apresentou baixo resultado quando aplicada no contexto Y."
}
```

---

# 6. Isolamento do LLM

Criar módulo específico de geração de memória, seguindo o padrão atual:

```text
agents/director/memory/
```

Sugestão:

```text
types.ts
schemas.ts
context.ts
prompt.ts
memory-extractor.ts
memory-service.ts
retrieval-service.ts
```

Não é obrigatório usar exatamente estes nomes.

O componente que chama o LLM:

* não importa `executor`;
* não importa `policy`;
* não importa mecanismo de permission;
* não escreve diretamente no banco;
* recebe DTO preparado;
* retorna apenas saída Zod validada.

---

# 7. Schema de saída do LLM

Usar `.strict()`.

Exemplo conceitual:

```text
title
summary
lesson
confidence
importance
tags
```

Não permitir campos como:

```text
tool
action
execute
permission
approval
autonomy
sql
command
```

Preferencialmente a própria estrutura não deve oferecer qualquer possibilidade de execução.

---

# 8. Memória não é verdade absoluta

A memória deve conter `confidence`.

Além disso, o prompt de uso da memória deve dizer explicitamente:

* experiências anteriores podem não se aplicar ao contexto atual;
* conflito entre memória histórica e evidência atual deve favorecer a evidência atual;
* memória serve como orientação;
* memória jamais sobrepõe regras atuais;
* memória jamais sobrepõe Policy Evaluator;
* memória jamais sobrepõe decisão humana atual.

---

# 9. Recuperação de memória

Implementar uma primeira versão simples e determinística.

Não introduzir vector database nesta etapa sem necessidade comprovada.

Preferência nesta versão:

```text
domain
memory_type
importance
confidence
recency
source relationships
```

Criar função semelhante a:

```text
getRelevantStrategicMemories(context)
```

Deve possuir limite explícito de resultados.

Exemplo:

```text
max 5 ou max 10 memories
```

Evitar enviar histórico ilimitado ao LLM.

---

# 10. Não implementar embeddings prematuramente

Nesta versão NÃO introduzir obrigatoriamente:

* pgvector;
* embeddings;
* vector store externo;
* RAG infrastructure;
* reranker;
* knowledge graph.

Primeiro validar o modelo de memória e provenance.

A arquitetura deve permitir evolução futura para busca semântica, mas não precisamos pagar essa complexidade agora.

---

# 11. Integração com Director Analysis

O Diretor poderá consultar memórias estratégicas relevantes antes de produzir análises ou recomendações.

Mas o prompt deverá separar claramente:

```text
CURRENT EVIDENCE
```

de:

```text
HISTORICAL ORGANIZATIONAL MEMORY
```

Essa separação é obrigatória.

O modelo deverá receber instrução explícita:

> A evidência atual possui precedência sobre padrões históricos.

---

# 12. Integração com Goals

Ao analisar um novo Goal, o Diretor poderá receber memórias relacionadas ao mesmo domínio.

Exemplo:

Novo Goal:

```text
Aumentar conversão comercial em 15%.
```

Memória histórica:

```text
Iniciativa anterior de aumento de contatos melhorou volume,
mas não elevou conversão por falta de qualificação dos leads.
```

Isso pode influenciar a análise.

Mas NÃO pode automaticamente:

* rejeitar o Goal;
* criar Initiative;
* executar Action Plan;
* bloquear uma estratégia.

Todas essas ações continuam no pipeline oficial.

---

# 13. Integração com Executive Review

Executive Review deverá ser uma das principais fontes de aprendizado.

Uma review pode gerar:

```text
0 ou 1 memória canônica nesta versão
```

Preferimos simplicidade e idempotência.

Se for adotada relação 1:1 inicial, documentar claramente a decisão e preparar evolução futura.

Criar constraint ou chave idempotente apropriada.

Nunca usar:

```text
find → depois insert
```

sem proteção concorrente.

---

# 14. Idempotência e concorrência

Seguir o padrão seguro já adotado nas versões anteriores.

Deve existir claim ou constraint no banco capaz de impedir duas memórias canônicas para a mesma origem.

Exemplo conceitual:

```text
UNIQUE(source_review_id, memory_type)
```

quando aplicável.

Chamadas concorrentes devem produzir:

```text
1 memória
```

e não duas.

Adicionar teste concorrente real.

---

# 15. Falha de provider

Se houver chamada ao LLM para extração da memória:

* não deixar registro permanentemente em estado transitório em exceção normal;
* permitir retry seguro;
* não abrir transaction durante chamada externa.

Repetir a prova de:

```sql
pg_stat_activity
```

se o padrão utilizado envolver claim + chamada externa.

Esperado durante delay artificial do provider:

```text
idle in transaction = 0
```

---

# 16. Auditoria

Auditar pelo menos:

```text
agents.director.memory.requested
agents.director.memory.created
agents.director.memory.reused
agents.director.memory.archived
```

Ajustar aos fluxos realmente implementados.

Não inventar eventos que nunca ocorrem.

Registrar:

```text
actor
memoryId
sourceReviewId
sourceGoalId
sourceInitiativeId
timestamp
metadata necessária
```

Não registrar secrets nem conteúdo sensível desnecessário.

---

# 17. Segurança

Reutilizar permissions existentes quando semanticamente corretas.

Preferência:

Leitura:

```text
agents.read
```

Administração/criação estratégica:

```text
agents.director.initiatives.manage
```

ou permission de Diretor já existente que seja realmente adequada.

Não criar permission nova apenas para inflar granularidade.

Authorization sempre no backend.

Frontend nunca é barreira de segurança.

---

# 18. API

Criar endpoints mínimos.

Sugestão:

```text
GET /agents/director/memories
GET /agents/director/memories/:id
POST /agents/director/reviews/:id/memory
```

ou estrutura coerente com as rotas existentes.

Filtros úteis:

```text
domain
memoryType
status
goalId
initiativeId
```

Não criar CRUD administrativo gigantesco.

Nesta versão precisamos principalmente:

* criar;
* consultar;
* recuperar memórias relevantes.

---

# 19. Frontend

Criar visualização clara para o CEO/Diretor.

Uma memória deve mostrar:

```text
Título
Tipo
Domínio
Aprendizado
Confidence
Importância
Origem
Data
```

Quando possível, permitir navegar para:

```text
Goal de origem
Initiative de origem
Executive Review
```

Não apresentar memória como “regra”.

Usar linguagem visual semelhante a:

```text
Aprendizado histórico
```

e não:

```text
Decisão obrigatória
```

---

# 20. Strategic Memory no contexto do Diretor

Quando uma memória for utilizada numa análise, deve ser possível saber quais memórias entraram no contexto.

Persistir ou auditar IDs utilizados.

Exemplo:

```text
memoryIdsUsed: [...]
```

Não precisamos armazenar o prompt inteiro.

Precisamos garantir auditabilidade suficiente para responder:

> Por que o Diretor considerou essa experiência anterior?

---

# 21. Não criar aprendizado autônomo irrestrito

Não implementar nesta versão:

* alteração automática das próprias policies;
* autoedição de prompts;
* mudança automática de thresholds;
* criação automática de permissions;
* “self-improving agent”;
* treinamento de modelo;
* fine-tuning;
* alteração autônoma das regras do sistema.

A memória é **contexto**, não alteração de comportamento estrutural.

---

# 22. Regras de precedência

Documentar e aplicar esta ordem:

```text
1. Permissions / Authorization
2. Policy / Safety rules
3. Human decisions / approvals
4. Current deterministic evidence
5. Current business context
6. Historical strategic memory
7. LLM interpretation
```

Nenhuma memória pode ultrapassar os níveis anteriores.

---

# 23. Testes obrigatórios

Adicionar testes cobrindo no mínimo:

1. Executive Review gera memória válida.
2. Memória contém provenance real.
3. Evidência persistida é separada do lesson produzido pelo LLM.
4. Duas chamadas concorrentes geram apenas uma memória.
5. Segunda chamada normal é idempotente.
6. Falha do provider permite retry.
7. Nenhuma transaction permanece aberta durante chamada ao LLM.
8. Memória nunca altera Goal original.
9. Memória nunca altera Initiative original.
10. Memória nunca cria Action Plan.
11. Memória nunca executa tool.
12. Memória nunca cria approval.
13. Memória histórica pode ser recuperada por domínio.
14. Limite de quantidade recuperada é respeitado.
15. Memória arquivada não entra em contexto normal.
16. Evidência atual é apresentada separadamente da memória histórica.
17. Usuário sem permission não cria memória.
18. Usuário sem permission apropriada não acessa endpoint protegido.
19. IDs das memórias utilizadas ficam auditáveis.
20. Frontend apresenta labels corretamente.

Adicionar testes adicionais se necessários.

---

# 24. Regressão

Rodar a suíte COMPLETA.

Baseline atual após v2.2:

Backend:

```text
472 tests
472 pass
0 fail
```

Frontend:

```text
76 tests
76 pass
0 fail
```

Não aceitar apenas testes novos isoladamente.

No relatório final informar:

```text
baseline
novos testes
total final
pass
fail
```

e reconciliar matematicamente os números.

---

# 25. Typecheck/build

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

Se lint continuar inexistente, apenas registrar isso.

Não adicionar ferramenta de lint fora do escopo.

---

# 26. Migration

Usar o fluxo oficial Drizzle:

```text
drizzle-kit generate
drizzle-kit migrate
```

Confirmar consistência entre:

```text
migration SQL
drizzle/meta/_journal.json
snapshot
__drizzle_migrations
```

Não editar tracking manualmente salvo necessidade comprovada.

Se houver desvio, documentar exatamente.

---

# 27. Restrições arquiteturais absolutas

É proibido criar:

* segundo Planner;
* segundo Executor;
* segundo Approval Workflow;
* segundo Policy Evaluator;
* acesso SQL pelo LLM;
* shell para LLM;
* credenciais no prompt;
* execução direta originada de Strategic Memory;
* autoaprovação baseada em memória;
* bypass de permissions.

---

# 28. Critérios de aprovação

A v2.3 somente poderá ser considerada concluída se:

1. memória estratégica estiver persistida;
2. provenance estiver rastreável;
3. evidência e interpretação estiverem separadas;
4. Executive Review puder alimentar memória;
5. criação for idempotente;
6. concorrência estiver protegida;
7. falha de provider tiver retry seguro;
8. nenhum lock/transaction permanecer durante I/O externo;
9. recuperação tiver limite;
10. memórias arquivadas não contaminarem contexto;
11. evidência atual tiver precedência explícita;
12. LLM continuar sem poder de autorização;
13. memória não modificar Goals;
14. memória não modificar Initiatives;
15. memória não executar nada;
16. uso da memória for auditável;
17. frontend distinguir aprendizado histórico de decisão;
18. backend completo passar;
19. frontend completo passar;
20. typechecks passarem;
21. build de produção passar;
22. nenhuma arquitetura paralela tiver sido criada.

---

# 29. Relatório final obrigatório

Ao concluir, NÃO faça commit.

Entregar `executed.md` contendo:

1. resumo da implementação;
2. arquitetura adotada;
3. schema/migrations;
4. modelo da Strategic Memory;
5. tipos de memória implementados;
6. como provenance funciona;
7. como evidência é separada da interpretação;
8. como o LLM foi isolado;
9. fluxo de criação da memória;
10. fluxo de recuperação;
11. regras de precedência;
12. integração com Executive Review;
13. integração com Goals/Director;
14. estratégia de concorrência/idempotência;
15. comportamento em falha do provider;
16. prova de ausência de transaction/lock durante LLM;
17. auditoria;
18. segurança/permissions;
19. frontend implementado;
20. arquivos criados;
21. arquivos alterados;
22. testes adicionados;
23. números exatos da suíte backend;
24. números exatos da suíte frontend;
25. typecheck/build;
26. `git diff --stat`;
27. `git status`;
28. limitações ou pendências reais encontradas.

Não esconder falhas ou limitações.

**NÃO REALIZAR COMMIT.**

Aguardar aprovação final do Diretor/CEO.
