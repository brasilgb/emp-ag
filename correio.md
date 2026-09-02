# Execução — Agentes v2.2: Executive Review & Strategic Feedback Loop

## Objetivo

Evoluir o Diretor Virtual para que ele não apenas crie Goals, Initiatives e Action Plans, mas também **avalie os resultados reais das iniciativas executadas**, registre uma revisão executiva persistente e gere recomendações estratégicas auditáveis.

A v2.2 deve ser construída **sobre a arquitetura já existente**, sem criar um segundo mecanismo de planejamento ou execução.

A cadeia oficial permanece:

CEO Goal
→ Director Analysis
→ Initiative
→ Action Plan
→ Policy Evaluator
→ Executor
→ Execution Evidence
→ Executive Review
→ Recommendation

Nenhuma recomendação pode contornar permissões, approvals, Policy Evaluator ou o executor determinístico existentes.

---

# 1. Princípio arquitetural

Separar obrigatoriamente:

* objetivo;
* execução;
* evidência;
* avaliação;
* recomendação;
* decisão humana ou automatizada autorizada.

Regra fundamental:

> O Diretor Virtual pode concluir que uma estratégia não funcionou, mas nunca pode alterar retroativamente o Goal, a Initiative ou os critérios originais para fazer o resultado parecer satisfatório.

Goals e Initiatives anteriores devem permanecer como registro histórico imutável quanto à intenção originalmente aprovada, salvo alterações explícitas realizadas por endpoints próprios e auditados.

---

# 2. Executive Review

Criar uma entidade persistente de revisão executiva.

Sugestão conceitual:

`agent_executive_reviews`

Campos mínimos:

* `id`
* `goal_id`
* `initiative_id`
* `action_plan_id`
* `created_by`
* `review_type`
* `status`
* `outcome`
* `summary`
* `expected_result`
* `actual_result`
* `evidence`
* `assessment`
* `confidence`
* `recommendation_type`
* `recommendation`
* `created_at`
* `updated_at`

Não é obrigatório usar exatamente esses nomes se houver convenção melhor já adotada no projeto.

A modelagem deve respeitar os padrões atuais de migrations, Drizzle, UUIDs, timestamps e auditoria.

---

# 3. Status da revisão

Criar lifecycle explícito.

Sugestão:

* `draft`
* `completed`
* `superseded`

Evitar lifecycle excessivamente complexo nesta versão.

Uma revisão `completed` representa uma análise histórica registrada.

Ela não significa que sua recomendação foi automaticamente aceita.

---

# 4. Outcome da Initiative

A revisão precisa separar o estado técnico da execução do resultado estratégico.

Sugestão de classificação:

* `successful`
* `partially_successful`
* `unsuccessful`
* `inconclusive`
* `blocked`

Exemplo:

Uma Initiative pode ter todos os Action Plan Items executados com sucesso técnico e ainda assim produzir:

`outcome = unsuccessful`

porque o Goal pretendido não foi atingido.

Essa distinção é obrigatória.

---

# 5. Evidência

Toda Executive Review deve registrar a evidência utilizada.

O Diretor não deve simplesmente afirmar que algo funcionou.

A revisão deve trabalhar com dados provenientes dos mecanismos autorizados da aplicação.

Exemplos:

* estado da Initiative;
* Action Plan;
* Action Plan Items;
* executions;
* approvals;
* resultados retornados por tools;
* métricas disponíveis;
* eventos;
* dados derivados já autorizados pelo backend.

Nunca fornecer:

* SQL direto ao LLM;
* acesso ao banco;
* acesso ao shell;
* credenciais;
* ferramentas arbitrárias.

O backend deve montar um DTO limitado de evidências antes de chamar o provider LLM.

---

# 6. Review Context

Criar uma estrutura determinística semelhante a:

```ts
interface ExecutiveReviewContext {
  goal: ...
  initiative: ...
  execution: ...
  actionPlan: ...
  items: ...
  evidence: ...
}
```

O contexto deve conter somente informações autorizadas e necessárias para a análise.

O LLM nunca deve escolher diretamente que tabelas consultar.

---

# 7. Executive Reviewer

Criar um componente especializado, por exemplo:

`agents/director/reviews/executive-reviewer.ts`

Responsabilidades:

1. receber o contexto normalizado;
2. chamar o LLM provider oficial;
3. exigir saída estruturada;
4. validar com Zod;
5. devolver somente análise/recomendação;
6. nunca executar ações.

Exemplo de saída estruturada:

```ts
{
  outcome:
    | 'successful'
    | 'partially_successful'
    | 'unsuccessful'
    | 'inconclusive'
    | 'blocked',

  summary: string,

  assessment: string,

  confidence: number,

  recommendation: {
    type:
      | 'none'
      | 'continue'
      | 'adjust'
      | 'new_initiative'
      | 'escalate',
    reason: string,
    proposedGoal?: string
  }
}
```

Pode ajustar os nomes conforme padrões existentes.

---

# 8. O LLM não decide autorização

A decisão do Executive Reviewer é interpretativa.

Ele NÃO pode:

* alterar Goal;
* alterar Initiative;
* alterar permissions;
* alterar autonomy;
* aprovar Action Plan Item;
* executar tool;
* criar Job;
* modificar policy;
* modificar Global Autonomy Switch;
* alterar configurações de segurança;
* executar SQL;
* executar shell.

Ele apenas gera uma recomendação validada.

---

# 9. Tipos de recomendação

Implementar inicialmente:

### `none`

Nenhuma ação adicional necessária.

### `continue`

O caminho atual continua adequado.

Pode recomendar continuidade, mas não disparar execução arbitrária.

### `adjust`

Existe desvio e uma mudança deve ser considerada.

Nesta versão, registrar a recomendação.

Não alterar silenciosamente a Initiative existente.

### `new_initiative`

O Diretor acredita que uma nova Initiative deve ser criada.

Nesse caso:

* gerar uma proposta;
* nunca executar diretamente;
* reutilizar o pipeline oficial de criação/aprovação de Initiative.

### `escalate`

O Diretor considera necessária decisão explícita do CEO.

Registrar claramente:

* motivo;
* evidência;
* risco;
* decisão solicitada.

---

# 10. Criação de nova Initiative a partir de Review

Não criar um mecanismo alternativo.

Se a recomendação for `new_initiative`, criar uma função adaptadora que reutilize os serviços já existentes.

Fluxo esperado:

Executive Review
→ Recommendation
→ proposed Initiative
→ lifecycle oficial da Initiative
→ aprovação
→ start execution
→ Action Plan oficial

Nunca:

Executive Review → Executor diretamente.

---

# 11. Idempotência

Uma Initiative não deve gerar revisões duplicadas por concorrência.

Criar proteção adequada.

Avaliar uma das abordagens:

* unique constraint adequada;
* chave baseada em Initiative + ActionPlan;
* lock/transação curta;
* claim;
* status de review.

Evitar manter transação aberta durante chamada ao LLM.

Aplicar a mesma lição aprendida na v2.1:

> Nunca manter lock ou transaction Postgres aberta enquanto provider LLM ou qualquer I/O externo estiver sendo executado.

---

# 12. Concorrência

Provar por teste que duas chamadas simultâneas de geração de review para a mesma execução:

* não criam reviews duplicadas;
* não geram recomendações duplicadas;
* não seguram lock durante LLM;
* retornam resultado consistente.

Se necessário, usar padrão semelhante ao já implementado em `startInitiativeExecution()`:

claim curta
→ trabalho externo fora de transação
→ persistência curta

---

# 13. Geração automática

Quando uma Initiative alcançar estado terminal elegível, permitir sincronização da Review.

Não é necessário criar um novo daemon ou scheduler se não houver necessidade.

Preferir aproveitar pontos existentes, por exemplo:

* após sincronização da execução;
* endpoint explícito;
* processo de leitura/review;
* event engine existente.

Não introduzir polling permanente sem necessidade.

---

# 14. Endpoint de geração

Criar endpoint seguro, por exemplo:

`POST /agents/director/initiatives/:id/review`

Ele deve:

* validar autenticação;
* validar permission;
* verificar Initiative;
* verificar execution;
* impedir revisão prematura quando não houver evidência suficiente;
* gerar ou recuperar review idempotente;
* registrar auditoria.

---

# 15. Endpoint de leitura

Criar:

`GET /agents/director/initiatives/:id/review`

ou equivalente dentro do padrão atual.

Retornar:

* outcome;
* summary;
* assessment;
* recommendation;
* confidence;
* evidence summary;
* timestamps;
* vínculos com Goal/Initiative/ActionPlan.

---

# 16. Histórico

Idealmente permitir que uma Initiative possua histórico de reviews se no futuro houver reavaliações.

Para a v2.2, pode existir inicialmente uma review canônica por Action Plan/execução.

Não criar arquitetura que impeça evolução futura.

---

# 17. Auditoria

Registrar eventos relevantes:

* review requested;
* review generation started;
* review completed;
* recommendation created;
* recommendation escalated;
* proposed Initiative criada a partir de review.

A auditoria deve incluir:

* actor;
* entity;
* IDs;
* timestamps;
* ação;
* resultado.

Nunca registrar secrets ou conteúdo sensível desnecessário.

---

# 18. Segurança

Manter os princípios permanentes do projeto.

Obrigatório:

* autorização sempre no backend;
* validação Zod;
* menor privilégio;
* nada de acesso direto do LLM ao banco;
* nada de shell;
* nada de secrets;
* nada de ferramentas arbitrárias;
* nenhuma permissão inferida pelo frontend;
* nenhuma ação mutável autorizada somente pela saída do LLM.

Toda ação posterior a uma recomendação deve passar novamente pelo pipeline de segurança existente.

---

# 19. Frontend

Adicionar a seção de Executive Review na tela de detalhe da Initiative.

Exibir pelo menos:

### Resultado

Exemplo:

`Resultado estratégico: Parcialmente bem-sucedido`

### Resumo executivo

Texto curto.

### Avaliação

Explicação mais detalhada.

### Evidências

Resumo das principais evidências usadas.

### Confiança

Exemplo:

`Confiança da avaliação: 86%`

### Recomendação

Exemplos:

* Nenhuma ação necessária
* Continuar estratégia atual
* Ajustar estratégia
* Propor nova iniciativa
* Escalar para decisão do CEO

Evitar interface que sugira que recomendação é decisão automática.

---

# 20. Indicadores visuais

Criar labels/badges consistentes para:

Outcomes:

* successful
* partially_successful
* unsuccessful
* inconclusive
* blocked

Recommendations:

* none
* continue
* adjust
* new_initiative
* escalate

Não depender apenas de cor para comunicar significado.

---

# 21. Proposta de nova Initiative no frontend

Se houver recomendação `new_initiative`, apresentar algo como:

“Diretor recomenda uma nova iniciativa”

Mostrar:

* objetivo proposto;
* justificativa;
* relação com Goal original.

A ação do usuário deve iniciar o pipeline oficial.

Não criar botão de “executar imediatamente”.

---

# 22. Escalation

Para `escalate`, mostrar claramente:

“Decisão do CEO necessária”

Com:

* contexto;
* evidência;
* motivo;
* recomendação.

Se houver sistema de decisões já existente no Diretor, reutilizá-lo em vez de criar uma segunda entidade equivalente.

---

# 23. Reaproveitamento obrigatório

Antes de criar qualquer nova infraestrutura, verificar e reaproveitar:

* Director;
* Goals;
* Initiatives;
* Action Plans;
* Action Plan Items;
* Executor;
* Policy Evaluator;
* Approvals;
* Decisions;
* Event Engine;
* Audit;
* permissions;
* schemas;
* frontend query keys;
* services;
* BFF;
* hooks.

Evitar duplicação arquitetural.

---

# 24. Testes obrigatórios

Adicionar testes reais cobrindo, no mínimo:

### Review bem-sucedida

Initiative concluída com evidência positiva:

* review criada;
* outcome `successful`;
* persisted corretamente.

### Sucesso técnico ≠ sucesso estratégico

Action Plan completo, mas resultado fornecido à review indica objetivo não atingido:

* Initiative tecnicamente completa;
* review `unsuccessful` ou `partially_successful`.

### Initiative bloqueada

* outcome coerente;
* recomendação apropriada;
* nunca classificar como sucesso.

### `skipped/shadow`

Garantir compatibilidade com a semântica estabelecida na v2.1.

Itens shadow não devem automaticamente significar falha estratégica.

A review deve avaliar a evidência disponível.

### Review não altera Goal

Verificar diretamente no banco que:

* Goal permanece intacto;
* Initiative permanece intacta;
* parâmetros originais não são reescritos pelo reviewer.

### Nova Initiative

Recommendation `new_initiative`:

* cria somente proposta pelo pipeline oficial;
* não cria Action Plan diretamente;
* não executa tool;
* não pula aprovação.

### Escalation

* gera decision/escalation usando mecanismo existente quando aplicável;
* nenhuma decisão é auto-aprovada pelo LLM.

### Permissões

Usuário sem permission adequada:

* 403;
* nenhuma review criada;
* nenhuma chamada mutável ocorre.

### Idempotência

Duas chamadas concorrentes:

```ts
await Promise.all([
  generateExecutiveReview(...),
  generateExecutiveReview(...)
])
```

Resultado:

* exatamente uma review canônica;
* nenhuma duplicação.

### Ausência de lock durante LLM

Repetir metodologia robusta da v2.1:

* provider artificialmente lento;
* durante delay consultar `pg_stat_activity`;
* confirmar `0 idle in transaction` relacionado ao processo.

### Falha do provider

Se LLM falhar:

* não deixar review permanentemente presa;
* permitir retry seguro;
* nenhuma entidade estratégica corrompida.

---

# 25. Testes da suíte completa

Ao final rodar a suíte completa, obrigatoriamente de forma determinística.

Baseline atual antes da v2.2:

Backend:

```text
455 testes
455 pass
0 fail
```

Frontend:

```text
72 testes
72 pass
0 fail
```

A nova implementação deve preservar todos os anteriores e adicionar os testes da v2.2.

Não aceitar regressão.

Não esconder flakiness com retry.

Se houver teste intermitente:

1. investigar;
2. encontrar causa raiz;
3. corrigir;
4. executar novamente a suíte completa.

---

# 26. Typecheck e build

Obrigatório:

Backend:

```bash
npx tsc --noEmit
```

Frontend:

```bash
npx tsc --noEmit
npm run build
```

Todos devem terminar sem erros.

Se lint ainda não estiver configurado no projeto, apenas registrar isso no relatório. Não adicionar ferramenta de lint incidentalmente como parte desta entrega.

---

# 27. Não fazer

Não implementar nesta versão:

* aprendizado autônomo que altera policies;
* self-modifying prompts;
* alteração automática de permissions;
* criação automática de tools;
* acesso SQL pelo LLM;
* shell pelo LLM;
* modificação de código pelo Diretor;
* autoaprovação;
* mudança automática de Goal;
* alteração automática da estratégia histórica;
* novo mecanismo de Executor;
* segundo Planner;
* segundo Approval Workflow.

---

# 28. Critério de conclusão da v2.2

Só considerar Agentes v2.2 concluída se:

1. Executive Review estiver persistida.
2. Evidência estiver separada da interpretação do LLM.
3. Resultado técnico estiver separado do resultado estratégico.
4. Recommendations estiverem estruturadas.
5. LLM não possuir poder de autorização.
6. Recommendation `new_initiative` reutilizar o pipeline existente.
7. Escalation reutilizar decisões existentes quando possível.
8. Concorrência estiver protegida.
9. Nenhuma transaction ficar aberta durante chamada ao LLM.
10. Goal original não puder ser silenciosamente modificado pelo review.
11. Auditoria estiver implementada.
12. Frontend apresentar review e recommendation.
13. Backend completo passar.
14. Frontend completo passar.
15. Typecheck passar.
16. Build de produção passar.

---

# 29. Relatório final obrigatório

Ao terminar, NÃO fazer commit.

Entregar relatório contendo exatamente:

1. Resumo da implementação.
2. Arquitetura adotada.
3. Schema/migrations.
4. Fluxo completo da Executive Review.
5. Como evidências são coletadas.
6. Como o LLM é isolado de autorização e execução.
7. Lifecycle/status/outcomes/recommendations.
8. Estratégia de concorrência/idempotência.
9. Prova de ausência de transaction/lock durante LLM.
10. Integração com Goals/Initiatives/Action Plans.
11. Integração de `new_initiative`.
12. Integração de `escalate`.
13. Auditoria e segurança.
14. Arquivos criados.
15. Arquivos alterados.
16. Testes adicionados.
17. Números exatos da suíte backend.
18. Números exatos da suíte frontend.
19. Typecheck/build.
20. `git diff --stat`.
21. `git status`.
22. Pendências ou limitações reais encontradas.

Finalizar explicitamente com:

**NENHUM COMMIT FOI REALIZADO.**

Aguardar revisão do Diretor/CEO.
