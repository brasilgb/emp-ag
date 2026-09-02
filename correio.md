# Execução — Agentes v1.7: Agent Management & Operational Configuration

## Contexto obrigatório

Estamos evoluindo o módulo de Agentes da plataforma **Agência de Software 2026**.

Arquitetura atual:

* Backend: Fastify + TypeScript + Drizzle + PostgreSQL + Redis.
* Frontend: Next.js + TypeScript + Tailwind + shadcn/ui + TanStack Query.
* PostgreSQL é a fonte oficial de dados.
* Segurança é requisito estrutural, não etapa posterior.
* Autorização sempre no backend.
* LLM nunca recebe acesso direto a SQL, shell, credenciais, permissões ou mecanismos arbitrários de execução.
* Toda ação continua passando pela arquitetura já existente de planner → policy evaluator → action plan/items → executor → approvals.
* Não criar segundo executor, segundo planner, segundo policy engine ou mecanismo paralelo de autonomia.

Versões existentes e já aprovadas:

* v1.0 — Agentes + Diretor Virtual.
* v1.1 — LLM Interpreter + Shadow Mode + Policy/Approvals.
* v1.2 — Action Planning + Approval Workflow.
* v1.3 — Jobs, Runs, Delegation & Controlled Autonomy.
* v1.4 — Event Engine & Autonomous Operations.
* v1.5 — Autonomous Safety & Governance.
* v1.6 — Operations Control & Observability.

A v1.6 já fornece:

* operations dashboard;
* incidents;
* audit logs;
* run detail;
* lineage;
* circuit breaker visibility;
* global autonomy switch;
* autonomy switch por Job;
* métricas operacionais;
* controle e observabilidade sobre Jobs, Runs, Events e autonomia.

Não alterar comportamento existente sem necessidade comprovada.

---

# Objetivo da v1.7

Criar uma camada centralizada, persistente, auditável e segura para **configuração operacional dos agentes**, reduzindo dependência de valores espalhados em:

* `.env`;
* constants;
* configurações hardcoded;
* defaults internos;
* parâmetros fixos do circuit breaker;
* budgets;
* limites operacionais;
* comportamento de Jobs;
* parâmetros relacionados à autonomia.

A v1.7 deve permitir que operadores autorizados administrem configurações pelo produto sem editar código ou `.env`.

A versão NÃO deve aumentar a autonomia dos agentes.

Ela deve apenas:

* configurar;
* limitar;
* administrar;
* visualizar;
* sobrescrever de forma controlada;

capacidades que já existem.

---

# Princípio fundamental

Configuração nunca pode significar elevação silenciosa de privilégio.

Nenhuma configuração pode:

* conceder permission;
* alterar role;
* ignorar approval;
* permitir ferramenta não registrada;
* fazer bypass do Policy Evaluator;
* substituir autorização server-side;
* permitir que o LLM modifique suas próprias regras;
* aumentar autonomia por falha de leitura/configuração.

Sempre aplicar comportamento **fail-safe**:

> Em caso de valor inválido, configuração ausente, erro de leitura ou inconsistência, usar a configuração mais restritiva aplicável.

---

# ETAPA 1 — Inventário antes de implementar

Antes de escrever código novo, faça uma exploração completa do backend e produza um inventário das configurações operacionais atuais relacionadas aos agentes.

Pesquisar pelo menos:

* `process.env`
* `AGENT_`
* `AUTONOMY`
* `CIRCUIT`
* `BUDGET`
* `LIMIT`
* `TIMEOUT`
* `MAX_`
* `MIN_`
* `THRESHOLD`
* `CONFIDENCE`
* `SHADOW`
* `APPROVAL`
* `SCHEDULE`
* `RETRY`
* `EVENT`
* `DEPTH`
* `RUN`
* `JOB`

Classifique cada configuração encontrada em:

1. deve permanecer exclusivamente em `.env`;
2. deve ser runtime-configurável;
3. pode ter default em `.env` e override no PostgreSQL;
4. é constante de segurança e não deve ser editável pela UI.

Não transforme tudo indiscriminadamente em configuração editável.

Antes da implementação, registrar no relatório quais parâmetros foram encontrados e qual decisão foi tomada para cada um.

---

# ETAPA 2 — Modelo de configuração

Criar modelo persistente adequado para configurações operacionais.

Evitar uma tabela completamente solta sem validação semântica.

Pode ser usada uma tabela genérica de settings apenas se houver:

* chave conhecida;
* schema conhecido;
* validação explícita;
* tipo;
* escopo;
* default;
* limites;
* documentação no código.

Sugestão conceitual:

`agent_operational_settings`

Campos possíveis:

* `id`
* `key`
* `scope`
* `scope_id`
* `value`
* `value_type`
* `created_at`
* `updated_at`
* `updated_by`

Escopos mínimos:

* `global`
* `job`

Não implementar escopo por usuário ou tenant nesta versão, a menos que a arquitetura atual já exija isso.

Usar unique constraint adequada, por exemplo:

`(key, scope, scope_id)`

Garantir que configuração global tenha `scope_id = null`.

Se Drizzle/PostgreSQL dificultar unique parcial, implementar de forma segura equivalente.

---

# Configurações inicialmente suportadas

Após o inventário, priorizar configurações diretamente ligadas à autonomia já existente.

Pelo menos avaliar:

### Circuit breaker

* failure threshold;
* recovery/cooldown se já existir;
* demais limites reais encontrados no código.

O Incident Center da v1.6 possui atualmente `job_repeated_failure` baseado em 3 Runs.

Se tecnicamente adequado, eliminar essa divergência e fazer o incidente respeitar a configuração efetiva do threshold do circuit breaker.

Não duplicar regra.

### Autonomy depth

Se já existir limite hardcoded/env para profundidade de autonomia/delegação:

* expor como configuração operacional;
* validar mínimo/máximo;
* nunca permitir profundidade ilimitada.

### Job/run budgets

Configurar limites que já existam no runtime, por exemplo:

* máximo de runs;
* ações;
* eventos;
* duração;
* custo;
* tokens;

somente se esses conceitos já existirem concretamente no projeto.

Não inventar budget fictício somente para preencher interface.

### Retry

Se existir retry operacional real:

* máximo de tentativas;
* backoff;

avaliar se deve ser configurável.

### Outros limites

Adicionar somente os que forem encontrados durante o inventário e fizerem sentido operacional.

---

# Hierarquia das configurações

Implementar resolução explícita:

1. override específico do Job;
2. configuração global persistida;
3. default configurado no backend / `.env`;
4. fallback seguro hardcoded.

A resolução precisa estar centralizada.

Criar algo equivalente a:

`AgentOperationalConfigResolver`

ou outro nome coerente com a arquitetura atual.

Não espalhar:

```ts
setting ?? env ?? default
```

por vários módulos.

Toda leitura runtime deve passar pelo resolver central.

---

# Cache

Se necessário, pode usar Redis para cache de configuração.

Porém:

* PostgreSQL continua fonte oficial;
* cache nunca pode ser fonte da verdade;
* alterações devem invalidar cache imediatamente;
* falha de Redis não pode impedir aplicação das configurações;
* fallback deve consultar PostgreSQL.

Se não houver necessidade real de cache nesta escala, preferir simplicidade e não implementá-lo ainda.

---

# Backend — endpoints

Criar API administrativa coerente com os padrões existentes.

Sugestão:

```text
GET    /agents/settings
GET    /agents/settings/:key
PATCH  /agents/settings/:key
DELETE /agents/settings/:key
```

Para override por Job:

```text
GET    /agents/jobs/:id/settings
PATCH  /agents/jobs/:id/settings/:key
DELETE /agents/jobs/:id/settings/:key
```

Ou estrutura equivalente mais apropriada ao projeto.

`DELETE` deve significar remover override persistido e voltar à configuração herdada/default.

Não deletar conceito/default da configuração.

---

# Effective configuration

É essencial que a API permita distinguir:

* valor configurado;
* valor efetivo;
* origem.

Exemplo:

```json
{
  "key": "circuit.failureThreshold",
  "configuredValue": 5,
  "effectiveValue": 5,
  "source": "global",
  "defaultValue": 3
}
```

Para um Job:

```json
{
  "key": "circuit.failureThreshold",
  "configuredValue": null,
  "effectiveValue": 5,
  "source": "global",
  "defaultValue": 3
}
```

Valores válidos para `source` podem ser:

* `job`
* `global`
* `env`
* `default`

ou equivalente.

Isso é necessário para a UI explicar claramente o comportamento real.

---

# Validation

Toda configuração deve ter schema explícito.

Usar Zod ou padrão já existente no backend.

Cada setting conhecido deve possuir metadados equivalentes a:

```ts
{
  key,
  type,
  defaultValue,
  min?,
  max?,
  enum?,
  description,
  securityLevel
}
```

Não aceitar keys arbitrárias vindas do frontend.

Endpoint deve rejeitar:

* chave desconhecida;
* tipo inválido;
* valor fora da faixa;
* enum inválido;
* valor inseguro;
* escopo inadequado.

---

# Configurações sensíveis

Não expor nem tornar editáveis:

* API keys;
* JWT secret;
* database URL;
* Redis credentials;
* SMTP passwords;
* OpenAI/Gemini keys;
* tokens;
* secrets;
* certificados;
* credentials de integração.

A tela de configurações de agentes é operacional, não gerenciamento de secrets.

---

# Permissions

Criar permissões explícitas.

Sugestão:

```text
agents.settings.read
agents.settings.manage
```

Somente quem possui `manage` pode escrever.

`read` pode visualizar configuração efetiva.

Seguir o padrão atual de seed de permissions.

Garantir que o CEO receba as novas permissions pelo mecanismo existente.

Lembrar que `db:seed` deverá ser executado após deploy.

---

# Auditoria

Toda alteração deve gerar audit log.

Registrar no mínimo:

* actor;
* action;
* key;
* scope;
* scopeId;
* valor anterior;
* valor novo;
* timestamp.

Não registrar secrets porque secrets não fazem parte deste módulo.

Actions sugeridas:

```text
agents.settings.updated
agents.settings.override_created
agents.settings.override_removed
```

Usar o mecanismo de auditoria existente.

Não criar segundo sistema de auditoria.

---

# Frontend

Criar página:

```text
/agents/settings
```

Adicionar à navegação existente de Agentes.

A página deve ser operacional, não um formulário genérico de key/value.

Agrupar configurações por domínio.

Exemplo:

### Autonomia

* máximo de profundidade;
* parâmetros relacionados a autonomia.

### Circuit Breaker

* failure threshold;
* cooldown/recovery se aplicável.

### Jobs / Runs

* budgets;
* retries;
* outros limites encontrados.

---

# UI de configuração

Para cada setting mostrar:

* nome amigável;
* descrição;
* valor efetivo;
* origem;
* default;
* valor global configurado;
* faixa permitida quando aplicável.

No detalhe do Job, mostrar overrides.

Exemplo:

```text
Circuit breaker failure threshold

Efetivo: 5
Origem: Global

[ Usar configuração global ]

Override deste Job:
[ 7 ]
```

Se houver override:

```text
Efetivo: 7
Origem: Job
Global: 5
Default: 3
```

Deve ser visualmente impossível confundir valor herdado com override explícito.

---

# Confirmações para mudanças críticas

Configurações que alterem autonomia ou circuit breaker devem exigir confirmação na UI.

Preferir componente de dialog já disponível no shadcn/ui.

A v1.6 ainda usa `window.confirm`.

Nesta v1.7, para a página nova, usar modal/dialog apropriado.

Não é obrigatório refatorar todos os confirms antigos da v1.6, salvo se for trivial e sem risco.

---

# Segurança de valores

Definir limites razoáveis.

Exemplos conceituais:

```text
circuit.failureThreshold: 1..20
autonomy.maxDepth: 0..10
retry.maxAttempts: 0..10
```

Mas não adotar estes números cegamente.

Derivar os valores reais do comportamento atual do projeto.

Se precisar alterar limites, documentar justificativa.

Nunca permitir:

* `Infinity`;
* número negativo quando não fizer sentido;
* número absurdamente alto;
* `null` como meio de remover proteção;
* string arbitrária para setting numérico.

---

# Integração real

Depois de persistir settings, substituir o uso dos valores antigos nos pontos reais do runtime.

Exemplo:

Se hoje existe algo como:

```ts
const threshold = Number(
  process.env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD ?? 3
)
```

isso deve passar a usar o resolver central.

Não basta criar a tela e salvar no banco.

A configuração deve efetivamente governar:

* Job Runner;
* circuit breaker;
* autonomia;
* incidents;
* budgets;

onde aplicável.

---

# Importante: consistência temporal

Para cada execução, decidir claramente quando a configuração é lida.

Recomendação:

* resolver settings no início do Run;
* usar snapshot coerente durante aquele Run.

Evitar que uma alteração no meio de uma execução produza comportamento inconsistente.

Se o projeto já possui arquitetura que favoreça leitura em cada etapa, documentar a decisão.

---

# Kill switch

O kill switch global e o kill switch por Job da v1.6 continuam sendo controles independentes.

Configuração NÃO deve substituir kill switch.

A lógica efetiva de autonomia continua respeitando algo equivalente a:

```text
global switch
AND job switch
AND policy
AND permissions
AND circuit state
AND budgets
AND operational settings
```

Nenhuma configuração pode reativar um Job/global switch desligado.

---

# Policy Engine

Nesta versão, policies podem ser visualizadas, mas não transformar o Policy Evaluator em engine editável livremente.

Se as regras atuais forem hardcoded, pode ser criada uma visão somente leitura mostrando:

* tipo de ação;
* requirement;
* approval requirement;
* shadow/block;
* explicação.

Não implementar editor arbitrário de policy se isso significar que um operador pode acidentalmente criar bypass de segurança.

Caso existam regras claramente seguras para parametrização, documentar antes de implementar.

---

# Migrations

Criar migration apenas se necessária para o modelo persistente.

Ela deve ser:

* reversível conceitualmente;
* idempotência respeitada pelo sistema de migration;
* compatível com dados existentes;
* sem apagar configurações atuais.

Se valores anteriores existirem somente em `.env`, não é necessário migrá-los automaticamente para rows.

O resolver pode tratá-los como fallback/origin `env`.

---

# Testes obrigatórios

Adicionar testes reais no backend.

Cobrir pelo menos:

## Authorization

* usuário sem permission → 403;
* read vs manage;
* frontend nunca é considerado barreira.

## Validation

* chave desconhecida → 400;
* tipo inválido;
* abaixo do min;
* acima do max;
* enum inválido.

## Resolution hierarchy

Testar:

```text
job override > global DB > env/default > safe fallback
```

## Override

* criar;
* alterar;
* remover;
* voltar a herdar valor global.

## Audit

* alteração gera audit;
* valor anterior/novo corretos.

## Runtime

Pelo menos um teste precisa provar que alterar um setting muda efetivamente o comportamento operacional.

Exemplo ideal:

* configurar circuit threshold;
* executar Runs falhando;
* verificar circuit breaker usando novo valor.

## Fail-safe

Simular erro/valor inválido quando possível e comprovar que não ocorre aumento de autonomia.

## Compatibility

Suíte v1.0–v1.6 continua passando integralmente.

---

# Frontend

Executar:

```text
typecheck
build
test
```

Adicionar testes quando houver lógica pura relevante.

Não criar testes cosméticos apenas para aumentar contagem.

---

# Seed

Atualizar seed das permissions.

Testar seed idempotente.

Registrar explicitamente no relatório final:

```text
Deploy requires:
db:migrate
db:seed
```

antes da aplicação utilizar as novas telas.

---

# Documentação da configuração

Criar no código um catálogo único dos settings suportados.

Algo conceitualmente semelhante:

```ts
AGENT_OPERATIONAL_SETTINGS = {
  "circuit.failureThreshold": {...},
  "autonomy.maxDepth": {...}
}
```

Esse catálogo deve servir como fonte para:

* validação;
* defaults;
* metadata da API;
* frontend quando apropriado.

Evitar duplicar a definição dos limites em backend e frontend.

---

# Não fazer

Não:

* criar segundo executor;
* criar segundo planner;
* criar policy engine paralelo;
* permitir configuração arbitrária;
* permitir LLM editar settings;
* armazenar secrets;
* permitir bypass de approval;
* permitir bypass de permission;
* executar SQL dinâmico;
* criar shell tool;
* criar tabela desnecessária para cada setting;
* mover tudo do `.env` para PostgreSQL;
* quebrar v1.0–v1.6;
* alterar arquitetura fundamental sem necessidade;
* fazer commit antes da revisão final.

---

# Resultado esperado

Ao final, um operador autorizado deve conseguir abrir:

```text
/agents/settings
```

e compreender imediatamente:

* quais proteções estão ativas;
* quais valores estão sendo usados;
* qual a origem de cada valor;
* quais parâmetros podem ser alterados;
* quais valores são globais;
* quais Jobs possuem overrides.

E o backend deve usar esses valores efetivamente.

A arquitetura deve continuar garantindo:

```text
LLM
 ↓
Planner
 ↓
Policy Evaluator
 ↓
Permissions
 ↓
Operational Settings
 ↓
Budgets / Circuit Breaker
 ↓
Approval quando necessário
 ↓
Deterministic Executor
 ↓
Audit
```

O LLM nunca controla esta cadeia.

---

# Processo obrigatório de execução

Não repetir o problema que tivemos no saneamento da v1.5.

Trabalhar assim:

```text
implementar
→ typecheck/test
→ analisar causa concreta de qualquer falha
→ corrigir a causa
→ executar novamente
```

Não fazer dezenas de execuções cegas esperando flakiness desaparecer.

Se houver teste intermitente, investigar imediatamente isolamento/estado compartilhado.

A suíte backend deve continuar usando a estratégia estabilizada após a v1.5, inclusive `--test-concurrency=1` se esse continuar sendo o padrão atual do projeto.

---

# Relatório final obrigatório

Quando terminar, NÃO fazer commit.

Entregar relatório contendo:

## 1. Resumo

O que foi implementado.

## 2. Inventário

Todas as configurações encontradas e classificação:

```text
env-only
runtime configurable
env + DB override
constant/security invariant
```

## 3. Arquitetura

Como funciona o resolver e a hierarquia de configuração.

## 4. Arquivos criados

Lista completa.

## 5. Arquivos alterados

Lista completa.

## 6. Migration

Nome e conteúdo conceitual.

## 7. Settings suportados

Tabela:

```text
key
tipo
default
min/max
scopes
origem anterior
```

## 8. Endpoints

Método, rota e permission.

## 9. Permissions

Novas permissions e seed.

## 10. Segurança

Explicar por que nenhuma configuração consegue elevar privilégio ou ignorar safety controls.

## 11. Auditoria

Actions registradas e dados armazenados.

## 12. Runtime integration

Mostrar exatamente quais partes do runtime passaram a consultar o resolver.

## 13. Testes

Quantidade nova e total.

Informar:

```text
backend typecheck
backend tests
frontend typecheck
frontend tests
frontend build
```

## 14. Compatibilidade

Confirmar v1.0–v1.6.

## 15. Riscos / débitos técnicos

Listar explicitamente.

## 16. Deploy

Confirmar necessidade de:

```bash
npm run db:migrate
npm run db:seed
```

ou comandos equivalentes reais do projeto.

## 17. Git

Mostrar:

```bash
git status --short
```

Não executar commit.

---

# Critério de aprovação da v1.7

A versão somente poderá ser considerada concluída se:

1. configuração estiver persistida e validada;
2. runtime realmente consumir os valores;
3. overrides de Job funcionarem;
4. hierarquia estiver testada;
5. alterações forem auditadas;
6. permissions forem server-side;
7. fail-safe estiver preservado;
8. nenhuma autonomia nova tiver sido criada;
9. toda suíte anterior continuar verde;
10. working tree estiver pronto para nossa revisão final.

Não fazer commit automaticamente.
