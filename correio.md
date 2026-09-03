# Agência de Software 2026 — Agentes v2.6

## Agent Responsibilities, Operational Ownership & Escalation

Estamos continuando a evolução da arquitetura de agentes da Agência de Software 2026.

A v2.5.1 — Automatic Operational Supervision foi aprovada pelo Diretor/CEO e deve ser considerada baseline imutável desta implementação.

Não refatore módulos anteriores sem necessidade objetiva.

---

# 1. Objetivo da v2.6

Implementar uma camada formal de **responsabilidade operacional dos agentes**.

Até agora temos infraestrutura robusta para:

* interpretação por LLM;
* planejamento;
* Action Plans;
* Policy Evaluator;
* approvals;
* execução determinística;
* Jobs;
* Runs;
* delegação controlada;
* Event Engine;
* autonomia;
* recovery;
* governança;
* observabilidade;
* Operational Supervisor;
* supervisão automática.

Agora precisamos responder formalmente:

> Qual agente é responsável por observar determinada área da empresa?

> O que ele deve fazer quando encontrar determinada situação?

> Quando deve apenas registrar?

> Quando pode recomendar?

> Quando deve abrir uma ação/plano?

> Quando deve pedir aprovação?

> Quando deve escalar para outro agente ou para um humano?

A v2.6 deve transformar agentes em **responsáveis operacionais**, não simplesmente agentes “mais autônomos”.

---

# 2. Princípio arquitetural central

Responsabilidade NÃO significa permissão.

Nunca inferir:

```text
agent owns X
=> agent may execute anything in X
```

A responsabilidade operacional define:

```text
o que observar
+
o que interpretar
+
para quem reportar
+
quando escalar
```

Toda ação continua passando obrigatoriamente pelos mecanismos existentes:

```text
LLM / deterministic trigger
    ↓
Planner
    ↓
validation
    ↓
Policy Evaluator
    ↓
Action Plan
    ↓
permissions / approvals / autonomy
    ↓
deterministic executor
```

Nenhuma Responsibility pode:

* ignorar permissions;
* elevar role;
* elevar autonomy;
* bypassar approval;
* executar SQL;
* executar shell;
* escolher arbitrary tools;
* chamar handlers diretamente;
* alterar dados sem passar pelo executor existente.

---

# 3. Antes de implementar

Faça primeiro uma revisão real do repositório.

Identifique e documente:

1. estrutura atual de agentes;
2. definição atual de agent IDs/types;
3. permissions relacionadas;
4. Jobs;
5. Event Rules;
6. Action Plans;
7. Delegation;
8. Operational Supervisor;
9. Audit Logs;
10. notifications existentes, se houver;
11. estrutura de usuários;
12. roles;
13. forma atual de identificar responsáveis por módulos, projetos, leads, tickets ou tarefas.

Não crie mecanismos paralelos se já houver conceitos reutilizáveis.

---

# 4. Conceito: Agent Responsibility

Criar o conceito persistido de:

```text
AgentResponsibility
```

Representa uma responsabilidade operacional atribuída a um agente.

Exemplo conceitual:

```json
{
  "agent": "sales",
  "name": "Pipeline comercial",
  "scope": "crm",
  "responsibilityType": "monitor",
  "enabled": true
}
```

Mas NÃO copie cegamente esse schema.

Primeiro avalie o modelo real do projeto.

---

# 5. O que uma responsabilidade deve representar

Uma responsabilidade deve conseguir expressar pelo menos:

* agente responsável;
* nome;
* descrição;
* domínio/módulo;
* tipo;
* estado habilitado/desabilitado;
* prioridade;
* condições relevantes;
* política de escalonamento;
* timestamps;
* autor da configuração.

Tipos iniciais sugeridos:

```text
monitor
review
coordinate
follow_up
```

Evitar dezenas de tipos.

Não implementar uma DSL complexa.

---

# 6. Responsabilidade != Event Rule

Não duplicar Event Engine.

Uma Event Rule responde:

> Quando este evento acontecer, o que deve ser disparado?

Uma Responsibility responde:

> Quem é responsável operacionalmente por esta área/situação?

Uma Responsibility pode eventualmente ser consultada por:

* Operational Supervisor;
* Event Engine;
* Jobs;
* dashboards;
* relatórios;
* mecanismos futuros de escalation.

Mas não recrie Event Rules dentro de Responsibilities.

---

# 7. Operational Ownership

Precisamos conseguir consultar:

```text
Quem é responsável por CRM?
Quem é responsável por financeiro?
Quem acompanha tickets de suporte?
Quem acompanha projetos atrasados?
```

Implementar serviço determinístico semelhante a:

```text
resolveOperationalResponsibility(...)
```

ou equivalente adequado à arquitetura existente.

Ele deve trabalhar somente com dados persistidos.

Nunca usar LLM para decidir quem é responsável.

---

# 8. Escalation Policy

Adicionar política de escalonamento associada à Responsibility.

Escalonamento deve ser simples nesta versão.

Tipos sugeridos:

```text
none
agent
human
```

Possivelmente:

```text
agent_then_human
```

somente se realmente necessário.

Não criar engine genérico de workflow.

---

# 9. Escalonamento entre agentes

Quando configurado:

```text
Sales Agent
    ↓ escalation
Director Agent
```

Isso NÃO significa execução automática pelo Diretor.

Significa criar um registro formal de escalonamento que possa ser tratado pela infraestrutura existente.

O escalonamento deve ser persistido.

Exemplo conceitual:

```text
OperationalEscalation
```

Campos possíveis:

* sourceAgent;
* targetAgent ou targetUser;
* responsibilityId;
* reason;
* severity;
* status;
* createdAt;
* acknowledgedAt;
* resolvedAt;
* metadata mínimo necessário.

Avalie o schema real antes de implementar.

---

# 10. Severidade

Criar apenas níveis suficientes para operação.

Sugestão:

```text
info
warning
critical
```

Evitar taxonomia complexa.

Se já existir severity equivalente no projeto, reutilizar.

---

# 11. Estados de escalonamento

Sugestão:

```text
open
acknowledged
resolved
dismissed
```

Não criar dezenas de estados.

Transitions devem ser validadas no backend.

---

# 12. Escalation nunca executa ação diretamente

Criar uma escalation não pode:

* executar workflow;
* corrigir dados;
* aprovar Action Plan;
* chamar executor;
* alterar autonomia.

Escalation é uma entidade operacional/gerencial.

Caso futuramente uma escalation leve à criação de uma ação, ela deverá passar pelo pipeline já existente.

---

# 13. Integração com Operational Supervisor

A integração deve ser cuidadosamente limitada.

O Operational Supervisor poderá usar Responsibilities para determinar:

> para quem uma descoberta deve ser direcionada.

Mas NÃO altere todas as regras da v2.5.

Primeiro identifique quais findings reais do supervisor podem ser associados de maneira determinística a um domínio/responsabilidade.

Se associação não for inequívoca:

```text
não atribuir automaticamente.
```

Nunca usar LLM para inventar ownership.

---

# 14. Findings e escalation

Quando um finding do Operational Supervisor for relevante e existir responsabilidade correspondente, deve ser possível criar uma escalation.

Mas evitar spam.

Definir proteção contra duplicidade.

Por exemplo:

não criar continuamente uma escalation idêntica para:

```text
mesma responsibility
+
mesmo tipo de problema
+
mesma entidade
```

enquanto existir uma equivalente ainda aberta.

Implemente de acordo com o modelo real de findings existente.

---

# 15. Deduplicação

Critério bloqueante.

Supervisão automática rodando a cada poucos minutos NÃO pode gerar centenas de escalations iguais.

Implementar deduplicação determinística.

Não usar similaridade semântica/LLM.

Pode usar fingerprint determinístico, unique constraint ou lookup adequado.

Documentar decisão.

---

# 16. Human escalation

Escalation para humano deve apontar para usuário real do sistema.

Nunca permitir:

```text
"CEO"
"admin"
"gerente"
```

como string arbitrária sem vínculo com entidade real, se o projeto já possui usuários persistidos.

Referenciar o mecanismo de users existente.

---

# 17. Permissions

Criar permissions novas somente se necessário.

Avaliar possibilidade de:

```text
agents.responsibilities.read
agents.responsibilities.manage

agents.escalations.read
agents.escalations.manage
```

Mas NÃO adicionar automaticamente antes de verificar o sistema atual.

Caso permissions existentes cubram semanticamente isso, reutilizá-las.

Backend sempre é autoridade.

Frontend nunca pode ser barreira de segurança.

---

# 18. API sugerida

Após revisar os padrões reais de routes do projeto, implementar equivalente a:

```text
GET    /agents/responsibilities
POST   /agents/responsibilities
GET    /agents/responsibilities/:id
PATCH  /agents/responsibilities/:id
DELETE /agents/responsibilities/:id
```

Se soft-delete for padrão do projeto, seguir padrão existente.

Escalations:

```text
GET   /agents/escalations
GET   /agents/escalations/:id

POST /agents/escalations/:id/acknowledge
POST /agents/escalations/:id/resolve
POST /agents/escalations/:id/dismiss
```

Não criar endpoints genéricos do tipo:

```text
POST /execute
POST /command
```

---

# 19. Criação manual de escalation

Avaliar se realmente existe necessidade operacional de:

```text
POST /agents/escalations
```

Se não houver caso real nesta versão, NÃO criar.

Preferência:

escalations originadas de mecanismos internos controlados.

---

# 20. Auditoria

Auditar alterações importantes.

Eventos sugeridos:

```text
agents.responsibility.created
agents.responsibility.updated
agents.responsibility.enabled
agents.responsibility.disabled

agents.escalation.created
agents.escalation.acknowledged
agents.escalation.resolved
agents.escalation.dismissed
```

Não criar eventos redundantes.

Utilizar infraestrutura de audit existente.

Metadata deve ser mínimo e seguro.

Nunca incluir secrets.

---

# 21. Histórico

Escalation deve manter história suficiente para saber:

* quando abriu;
* quem recebeu;
* quando foi reconhecida;
* quando foi encerrada;
* quem realizou a mudança.

Se Audit Log existente já fornece parte disso, reutilizar.

Não criar um event sourcing paralelo.

---

# 22. Frontend

Integrar ao módulo de Agents.

Sugestão:

```text
/agents/responsibilities
```

e:

```text
/agents/escalations
```

Mas primeiro verifique a navegação atual.

Se fizer mais sentido utilizar páginas existentes do módulo Agents, prefira integração ao invés de proliferação de rotas.

---

# 23. UI — Responsibilities

Exibir:

* agente;
* responsabilidade;
* domínio;
* tipo;
* prioridade;
* escalation policy;
* estado;
* responsável de escalonamento;
* ações permitidas conforme permission.

Criar/editar por formulário estruturado.

Não permitir campo livre que resulte em execução.

---

# 24. UI — Escalations

A lista deve permitir operação real.

Mostrar pelo menos:

* severidade;
* origem;
* agente responsável;
* destino;
* motivo;
* entidade relacionada, quando houver;
* criada em;
* estado.

Filtros úteis:

```text
open
acknowledged
resolved
critical
agent
human
```

Não adicionar filtros sem utilidade.

---

# 25. Dashboard / indicadores

Se simples e coerente com a UI atual, mostrar indicadores:

```text
Escalations abertas
Escalations críticas
Aguardando reconhecimento
Resolvidas recentemente
```

Não construir analytics complexo nesta versão.

---

# 26. Segurança

Aplicar as diretrizes permanentes do projeto:

* validação Zod;
* authorization server-side;
* menor privilégio;
* nenhuma confiança no frontend;
* nenhum acesso arbitrário do LLM;
* nenhuma SQL dinâmica originada por LLM;
* nenhuma ferramenta arbitrária;
* auditoria;
* IDs validados;
* evitar mass assignment;
* respostas sem vazamento de dados internos;
* tenant isolation se o projeto já utilizar tenancy.

---

# 27. Concorrência

Se duas execuções tentarem criar a mesma escalation ao mesmo tempo, deduplicação deve continuar correta.

Teste explicitamente.

Não confiar somente em:

```text
SELECT
if (!exists)
INSERT
```

se isso puder gerar race condition.

Preferir proteção transacional/constraint quando aplicável.

---

# 28. Integridade referencial

Não permitir:

* responsibility apontando para agent inexistente;
* target agent inválido;
* target user inexistente;
* escalation apontando para responsibility inexistente;
* estado impossível.

Utilizar FKs quando compatíveis com a modelagem existente.

---

# 29. Responsabilidade desabilitada

Quando:

```text
responsibility.enabled = false
```

ela:

* continua existindo para histórico;
* não deve receber novas escalations automáticas;
* não altera escalations já existentes.

Testar.

---

# 30. Alteração de ownership

Se uma Responsibility muda de target de escalation:

* novas escalations seguem nova configuração;
* escalations antigas mantêm destino histórico original.

Nunca retroativamente alterar histórico.

---

# 31. Exclusão

Não permitir que exclusão destrua histórico operacional.

Se existirem escalations associadas, decidir entre:

* impedir delete;
* soft delete;
* apenas disabled.

Escolha seguindo os padrões reais do projeto.

Preferência arquitetural:

```text
disabled
```

para entidades que tenham histórico.

---

# 32. Não implementar nesta versão

Não adicionar:

* organograma visual;
* BPMN;
* workflow designer;
* rule builder genérico;
* linguagem própria;
* chat entre agentes;
* e-mail;
* WhatsApp;
* Slack;
* push notification;
* SLA completo;
* distributed agent runtime;
* embeddings;
* vector database;
* autonomous team formation;
* LLM escolhendo agente responsável;
* criação automática de novos agentes;
* multi-stage escalation engine;
* Redis Streams/Kafka apenas para isso.

Esses assuntos poderão ser tratados futuramente.

---

# 33. Testes obrigatórios

Cobrir pelo menos:

## Responsibilities

1. criar responsibility válida;
2. rejeitar agent inválido;
3. leitura por permission;
4. escrita por permission;
5. update;
6. enable/disable;
7. disabled não participa de resolução operacional;
8. ownership resolution correto.

## Escalations

9. criar escalation válida via serviço interno;
10. target agent;
11. target human;
12. severity;
13. acknowledge;
14. resolve;
15. dismiss;
16. transição inválida rejeitada;
17. usuário sem permission rejeitado;
18. histórico preservado.

## Deduplicação

19. mesma ocorrência não cria segunda escalation aberta;
20. duas chamadas concorrentes não criam duplicata;
21. após resolução, nova ocorrência pode gerar nova escalation, se essa for a política adotada.

## Supervisor

22. finding com responsibility correspondente pode gerar escalation;
23. finding sem responsabilidade não inventa ownership;
24. responsibility disabled não recebe escalation;
25. supervisor continua funcionando mesmo se criação de escalation falhar, desde que isso seja compatível com a arquitetura real e a falha seja adequadamente auditada.

## Segurança

26. payload extra rejeitado quando pertinente;
27. IDs inválidos rejeitados;
28. unauthorized/forbidden corretamente;
29. frontend não concede permission inexistente.

---

# 34. Testes de regressão

Rodar suíte completa.

Não basta rodar somente novos testes.

Registrar:

```text
baseline anterior
novo total
pass
fail
skipped
```

Esperado antes da implementação:

```text
Backend: 599 testes passando
Frontend: 94 testes passando
```

Caso números reais estejam diferentes ANTES de implementar, documentar antes de continuar.

Não esconder divergência de baseline.

---

# 35. Typecheck / build

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

Executar lint somente se houver configuração real.

Não inventar sucesso de lint se projeto não possuir configuração.

---

# 36. Migration

Se novas tabelas forem realmente necessárias, criar migration seguindo Drizzle/migrations existentes.

Provavelmente serão necessárias entidades equivalentes a:

```text
agent_responsibilities
agent_operational_escalations
```

Mas nomes e schema devem seguir convenções reais do repositório.

Não criar tabelas até revisar o modelo existente.

---

# 37. Critérios bloqueantes

A v2.6 NÃO pode ser aprovada se:

1. Responsibility conceder permission;
2. Responsibility alterar autonomy;
3. ownership for decidido por LLM;
4. escalation executar ação diretamente;
5. escalation bypassar Planner/Policy/Executor;
6. supervisor criar duplicatas continuamente;
7. deduplicação tiver race condition evidente;
8. target humano não referenciar usuário real;
9. target agent puder ser inválido;
10. estado de escalation aceitar transições arbitrárias;
11. permissions forem aplicadas somente no frontend;
12. histórico puder ser destruído inadvertidamente;
13. responsibility desabilitada continuar recebendo escalation automática;
14. alteração de ownership reescrever histórico;
15. suíte completa apresentar regressão.

---

# 38. Relatório final obrigatório

Ao terminar, NÃO FAÇA COMMIT.

Entregue relatório contendo:

1. resumo;
2. revisão da arquitetura encontrada;
3. modelo conceitual adotado;
4. responsibilities;
5. ownership resolution;
6. escalation model;
7. escalation policy;
8. severity;
9. estados;
10. transitions;
11. integração com Operational Supervisor;
12. estratégia de deduplicação;
13. proteção contra race condition;
14. target agent;
15. target human;
16. comportamento de responsibility disabled;
17. alteração de ownership;
18. política de delete/disable;
19. permissions;
20. auditoria;
21. API;
22. frontend;
23. migrations;
24. arquivos criados;
25. arquivos alterados;
26. testes adicionados por arquivo;
27. testes de responsibilities;
28. testes de escalation;
29. testes de concorrência/deduplicação;
30. testes de supervisor;
31. testes de permissions;
32. números exatos da suíte backend;
33. números exatos da suíte frontend;
34. reconciliação com baseline 599/94;
35. typecheck;
36. build;
37. git diff --stat;
38. git status;
39. bugs encontrados durante implementação;
40. limitações reais;
41. débitos técnicos;
42. conclusão confrontando cada critério bloqueante.

---

# 39. Regra final

Não faça commit.

Não esconda erro.

Não reduza cobertura para conseguir verde.

Não altere testes antigos apenas para acomodar comportamento incorreto.

Não use LLM como mecanismo de autorização, ownership ou decisão de segurança.

Implemente primeiro a solução correta e mínima, seguindo a arquitetura real encontrada no repositório.

Ao final, aguarde aprovação do Diretor/CEO.
