## Agentes v2.6 — Fechamento antes do commit

Antes de efetuar o commit da v2.6, faça uma última rodada **estritamente aditiva e limitada ao módulo Responsibilities**, sem alterar a arquitetura já aprovada.

### 1. Adicionar edição completa de Responsibility no frontend

A API `PATCH /agents/responsibilities/:id` já existe e está validada/testada.

Adicionar na listagem de Responsibilities uma ação **Editar**, disponível somente para quem possui:

`agents.responsibilities.manage`

Criar um `EditResponsibilityDialog` seguindo os mesmos padrões visuais e técnicos do `CreateResponsibilityDialog`.

Permitir editar somente os campos já permitidos pelo backend, respeitando integralmente as imutabilidades existentes.

Não criar nenhuma nova regra de negócio no frontend.

O formulário deve permitir ajustar, quando permitido pela API existente:

* name
* description
* priority
* conditions
* escalationPolicy
* escalationTargetAgentId
* escalationTargetUserId
* enabled

Não permitir editar:

* agentId
* domain
* responsibilityType
* createdBy
* campos históricos/timestamps

### 2. Validação

Continuar usando vocabulários fechados com `<Select>`.

As regras de compatibilidade entre:

* `escalationPolicy`
* `escalationTargetAgentId`
* `escalationTargetUserId`

devem seguir exatamente as regras já existentes no backend.

O frontend pode prevenir combinações inválidas para UX, mas **o backend continua sendo a autoridade definitiva**.

### 3. Query/invalidation

Reutilizar os hooks e query keys da v2.6.

Após edição bem-sucedida:

* invalidar lista de responsibilities;
* invalidar detalhe correspondente, se existir;
* mostrar toast de sucesso.

Não criar novo mecanismo de cache.

### 4. Testes

Adicionar testes apenas onde trouxerem cobertura real para essa edição.

Validar pelo menos:

* edição de campos permitidos;
* permission gate;
* campos imutáveis não aparecem como editáveis;
* mudança de escalation policy ajusta corretamente os campos de target;
* erro da API é apresentado corretamente;
* atualização invalida os dados esperados.

Depois rodar:

```bash
# backend
npx tsc --noEmit
npx tsx --test --test-concurrency=1 'src/**/*.test.ts'

# frontend
npx tsc --noEmit
npm test
npm run build
```

### 5. Não alterar

Não modificar:

* ownership resolution;
* deduplication;
* Operational Supervisor;
* escalation state machine;
* Planner;
* Policy Evaluator;
* Executor;
* Approval;
* Recovery;
* Circuit Breaker;
* schema/migration, salvo se surgir alguma necessidade objetiva e previamente inexistente — o esperado é **zero migration nova**.

### 6. Entrega

No relatório final informar:

* arquivos criados;
* arquivos alterados;
* testes adicionados;
* números finais exatos das suítes;
* typecheck;
* build;
* `git diff --stat`;
* `git status`.

**Não faça commit.**

Essa é apenas uma rodada de fechamento da v2.6 antes do commit já aprovado.
