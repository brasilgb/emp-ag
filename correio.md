# Execução — Agentes v1.8: Director Operations & Business Workflows

## Objetivo

Transformar o Diretor Virtual de uma infraestrutura genérica de agentes em uma camada operacional capaz de acompanhar a agência e coordenar ações reais sobre:

* CRM;
* Projetos e Tarefas;
* Financeiro;
* Suporte / Customer Success.

A v1.8 NÃO deve criar um novo motor de agentes, novo executor ou novo mecanismo de autorização.

Toda ação deve continuar obrigatoriamente passando pela arquitetura já existente:

Objetivo
→ Planner
→ Policy Evaluator
→ Action Plan / Plan Items
→ Executor determinístico
→ Approvals quando necessárias
→ Audit
→ Jobs / Runs / Events quando aplicável.

O LLM nunca decide autorização.

---

# 1. Regra arquitetural principal

O Diretor Virtual deve funcionar como um coordenador dos módulos existentes.

Ele poderá:

* consultar situação operacional;
* detectar situações que merecem atenção;
* montar briefing diário;
* propor ações;
* criar Action Plans;
* delegar ações aos agentes existentes;
* disparar workflows já autorizados;
* acompanhar resultados de Runs;
* reportar bloqueios, approvals e incidentes.

Ele NÃO poderá:

* acessar SQL diretamente;
* acessar shell;
* executar ferramenta arbitrária;
* ignorar permissions;
* aprovar a própria ação;
* alterar policy;
* alterar roles/permissões;
* alterar secrets;
* executar operações destrutivas fora do executor existente.

---

# 2. Criar uma camada de Operational Signals

Precisamos de uma representação determinística dos fatos relevantes da agência.

Criar algo conceitualmente semelhante a:

`agents/director/operational-signals.ts`

Os sinais devem ser produzidos através dos services/repositories existentes dos módulos.

Não fazer queries SQL dentro do Diretor.

Estrutura sugerida:

```ts
type OperationalSignal = {
  id: string
  type: string
  domain: 'crm' | 'projects' | 'finance' | 'support'
  severity: 'info' | 'attention' | 'warning' | 'critical'
  title: string
  description: string
  entityType?: string
  entityId?: number
  detectedAt: Date
  metadata: Record<string, unknown>
}
```

A geração deve ser determinística.

O LLM pode interpretar sinais posteriormente, mas não inventá-los.

---

# 3. Sinais mínimos da v1.8

Implementar somente sinais baseados em dados e funcionalidades que realmente existem hoje.

Antes de escrever código:

1. inventariar schemas;
2. inventariar services;
3. inventariar endpoints;
4. determinar quais sinais podem ser derivados com segurança dos dados existentes.

Não criar coluna ou conceito fictício apenas para atender a esta lista.

Prioridade:

## CRM

Exemplos, caso os dados atuais permitam:

* lead sem atividade há X dias;
* lead parado em uma etapa do pipeline;
* cliente sem contato recente;
* atividade CRM vencida;
* lead criado sem follow-up.

## Projetos / Tarefas

* tarefa atrasada;
* tarefa próxima do vencimento;
* projeto com tarefas críticas atrasadas;
* projeto sem atividade recente;
* tarefas sem responsável, caso esse conceito exista.

## Financeiro

Somente com dados já existentes:

* contas/recebimentos vencidos;
* cobrança próxima;
* receita ou despesa que demande atenção;
* pendência financeira associada a cliente/projeto.

Não inventar regras contábeis ou financeiras que o módulo ainda não suporte.

## Suporte / Customer Success

* ticket aberto há muito tempo;
* ticket sem atualização;
* ticket de prioridade alta pendente;
* cliente com múltiplas ocorrências recentes;
* situação compatível com risco de atendimento, se houver dados suficientes.

---

# 4. Regras operacionais

Não espalhar números mágicos pelo código.

Os thresholds iniciais podem viver em catálogo determinístico próprio da v1.8.

Exemplo:

```ts
leadStaleDays
taskDueSoonDays
ticketStaleHours
projectInactiveDays
```

Não colocar isso ainda no módulo administrativo da v1.7 sem necessidade.

Primeiro queremos provar os workflows.

Se esses parâmetros demonstrarem necessidade operacional real de alteração em runtime, serão promovidos posteriormente ao sistema de settings da v1.7.

---

# 5. Director Operations Service

Criar uma camada central:

`agents/director/operations-service.ts`

Responsabilidades:

* coletar sinais;
* classificar por domínio;
* ordenar por prioridade;
* fornecer visão consolidada da agência;
* produzir dados estruturados para briefing;
* fornecer contexto controlado para o Planner.

Não permitir que esse service execute ações diretamente.

---

# 6. Daily Operations Brief

Criar a primeira capacidade operacional real do Diretor:

**Daily Operations Brief**

O briefing deve responder deterministicamente:

* O que precisa de atenção hoje?
* Quais clientes/leads merecem acompanhamento?
* Quais tarefas/projetos estão atrasados?
* Quais pendências financeiras precisam ser observadas?
* Quais tickets/situações de suporte estão críticos?
* Existem approvals pendentes?
* Existem Jobs/Runs com falhas?
* Existem circuit breakers abertos?
* Existem incidents ativos?

Formato da API deve ser estruturado.

Exemplo conceitual:

```json
{
  "generatedAt": "...",
  "summary": {
    "critical": 2,
    "warning": 4,
    "attention": 7
  },
  "domains": {
    "crm": [],
    "projects": [],
    "finance": [],
    "support": [],
    "agents": []
  }
}
```

Evitar gerar apenas texto.

A estrutura é a fonte oficial.

---

# 7. Briefing narrativo opcional por LLM

Se o LLM estiver habilitado, poderá transformar o briefing estruturado em uma apresentação executiva amigável.

Porém:

* os fatos vêm do backend;
* números vêm do backend;
* IDs vêm do backend;
* entidades vêm do backend;
* severidade vem do backend.

O LLM apenas resume/organiza o conteúdo.

Se LLM estiver desligado ou falhar, o briefing estruturado deve continuar funcionando completamente.

Não tornar essa feature dependente de OpenAI/Gemini.

---

# 8. Proposed Actions

O Diretor poderá transformar um OperationalSignal em uma proposta operacional.

Exemplos:

* “Criar atividade de follow-up para este lead.”
* “Criar tarefa para tratar atraso deste projeto.”
* “Preparar ação de acompanhamento deste cliente.”
* “Encaminhar ticket para acompanhamento.”
* “Criar plano para analisar essas pendências.”

IMPORTANTE:

Nenhuma dessas ações é executada pelo Director Operations Service.

Ele deve criar um objetivo/intenção compatível com o Planner já existente.

Esse objetivo entra no pipeline oficial de Action Planning.

---

# 9. Workflow templates

Criar uma pequena camada de templates determinísticos.

Exemplo:

`agents/director/workflows/catalog.ts`

Primeiros workflows sugeridos:

```text
crm.follow_up_stale_lead
projects.handle_overdue_task
finance.review_overdue_item
support.review_stale_ticket
director.daily_operations_review
```

Cada workflow deve definir:

* domínio;
* trigger/signal aceito;
* objetivo que será enviado ao Planner;
* campos obrigatórios;
* permissions necessárias indiretamente pelas tools/actions envolvidas.

O workflow NÃO define autorização.

Policy Evaluator continua sendo autoridade.

---

# 10. Não criar automação cega

Nesta versão, sinais não devem automaticamente gerar mutações em massa.

Classificação inicial:

### Pode rodar automaticamente

Somente leituras e geração de briefing.

### Pode gerar Action Plan automaticamente

Situações explicitamente consideradas seguras pela policy já existente.

### Deve exigir approval

Qualquer operação cuja tool/action já seja classificada assim pelo mecanismo atual.

### Bloqueado

Continua bloqueado normalmente.

Não modificar regras existentes para facilitar a v1.8.

---

# 11. Integração com Jobs

Criar suporte para um Job do tipo operacional do Diretor reutilizando `agent_jobs`.

Não criar tabela paralela de scheduler.

Exemplo de objetivo recorrente:

```text
Gerar briefing operacional diário da agência e identificar situações que requerem atenção.
```

O Scheduler v1.3 deverá conseguir executá-lo.

Se houver necessidade de metadata específica, avaliar extensão mínima do Job atual antes de criar nova estrutura.

---

# 12. Integração com Events

Aproveitar o Event Engine da v1.4 quando fizer sentido.

Não criar event bus paralelo.

Exemplo futuro:

* CRM activity overdue;
* support ticket escalated;
* payment overdue;
* task overdue.

Nesta v1.8, só publicar novos eventos quando existir um fato transacional claro e uma integração limpa com os módulos.

Não instrumentar dezenas de eventos apenas por antecipação.

---

# 13. Director Operations API

Criar endpoints administrativos.

Sugestão:

```text
GET  /agents/director/operations
GET  /agents/director/brief
GET  /agents/director/signals

GET  /agents/director/signals/:id

POST /agents/director/signals/:id/propose
```

O endpoint `propose` deve gerar Action Plan através da orquestração existente.

Não executar uma mutação diretamente.

Avaliar nomes finais seguindo o padrão atual das rotas.

---

# 14. Permissions

Criar permissions específicas apenas se forem realmente necessárias.

Sugestão:

```text
agents.director.operations.read
agents.director.operations.manage
```

Mas antes verificar se permissions equivalentes já existem.

Não duplicar permissão semanticamente idêntica.

O CEO recebe as permissions administrativas conforme mecanismo atual.

---

# 15. Frontend — Director Operations

Criar uma página operacional do Diretor.

Sugestão:

`/agents/director`

A tela deve funcionar como uma “mesa do diretor”, não como outro dashboard genérico.

Mostrar:

## Resumo

* críticas;
* warnings;
* attention;
* approvals pendentes;
* incidents;
* circuitos abertos;
* Jobs com problema.

## CRM

Lista dos principais sinais.

## Projetos

Principais atrasos/riscos.

## Financeiro

Pendências relevantes.

## Suporte

Pendências relevantes.

Cada sinal deve permitir:

* abrir a entidade relacionada quando houver rota;
* visualizar detalhes;
* solicitar proposta de ação.

Não permitir mutações diretas na UI se elas deveriam passar pelo Action Plan.

---

# 16. UX de proposta

Quando o usuário selecionar “Propor ação”:

1. backend constrói o objetivo determinístico a partir do signal/workflow;
2. Planner cria o Action Plan;
3. Policy Evaluator avalia;
4. tela mostra resultado:

```text
Executável automaticamente
Approval necessário
Bloqueado
Shadow
```

Se houver approval necessária, utilizar a interface de approvals já existente.

Não criar confirmação paralela.

---

# 17. Agent Operations Signals devem ser reproduzíveis

Precisamos conseguir testar sinal → ação.

Portanto:

* separar coleta de dados de interpretação;
* separar signal detector de workflow;
* evitar depender do relógio global diretamente;
* permitir injeção/controlabilidade de `now` nos testes quando necessário.

Isso evita testes flaky de data/hora.

---

# 18. Segurança

Manter as diretrizes permanentes do projeto.

Obrigatório:

* autorização backend;
* validação Zod;
* nenhum acesso SQL pelo LLM;
* nenhuma tool arbitrária;
* nenhuma interpolação de prompt capaz de mudar permissions;
* nenhum Action Plan pode executar algo que o usuário criador não poderia executar diretamente;
* outputs do LLM continuam não confiáveis até validação;
* auditoria de ações administrativas;
* não expor dados de outros tenants/contextos caso o sistema possua escopo correspondente.

A v1.8 não deve enfraquecer nenhum controle da v1.0–v1.7.

---

# 19. Auditoria

Registrar pelo menos:

```text
agents.director.brief_generated
agents.director.action_proposed
```

Não registrar toda leitura automática se isso produzir ruído excessivo.

Seguir o padrão do audit service existente.

Metadata útil:

* signal id/type;
* domain;
* entityType;
* entityId;
* resultingActionPlanId;
* actor.

---

# 20. Testes obrigatórios

Criar testes suficientes para comprovar comportamento, sem perseguir número artificial.

Cobrir obrigatoriamente:

### Signals

* detecção positiva;
* não detectar falso positivo;
* threshold;
* ordenação por severidade;
* isolamento entre domínios;
* datas controladas.

### Brief

* consolidação correta;
* contadores;
* módulos vazios;
* falha isolada de uma fonte sem corromper silenciosamente dados.

Definir explicitamente se falha de um módulo torna briefing parcial ou erro total.

Minha preferência:

**briefing parcial explícito**, com algo como:

```json
{
  "status": "partial",
  "errors": [
    {
      "domain": "finance",
      "code": "SOURCE_UNAVAILABLE"
    }
  ]
}
```

Nunca fingir que `[]` significa “sem problema” quando na verdade houve erro na consulta.

### Proposed Action

Teste de integração:

OperationalSignal real/fixture
→ POST propose
→ createActionPlan oficial
→ Policy Evaluator
→ Plan persistido.

Provar que não existe bypass.

### Permissions

* usuário sem read;
* usuário com read;
* manage/propose separado quando aplicável.

### Regression

Toda suíte v1.0–v1.7 continua verde.

---

# 21. Não fazer

Não implementar nesta versão:

* novo LLM provider;
* nova arquitetura de executor;
* nova tabela de approvals;
* scheduler paralelo;
* event bus paralelo;
* SQL gerado por IA;
* “agentes especializados” duplicando services;
* memória vetorial/RAG sem caso de uso concreto;
* envio de e-mail;
* WhatsApp;
* integração n8n;
* cobrança automática;
* criação automática de leads externos;
* prospecção;
* alteração dos settings v1.7 além do estritamente necessário.

Esses itens virão em fases próprias.

---

# 22. Processo obrigatório

Antes de implementar:

1. revisar a arquitetura v1.0–v1.7;
2. inventariar os quatro módulos reais;
3. listar os sinais que são realmente possíveis com os dados atuais;
4. informar quais sinais sugeridos acima não podem ser implementados sem inventar dados;
5. propor o escopo definitivo da v1.8;
6. somente então implementar.

Durante a execução:

* corrigir causa raiz, não mascarar teste;
* não diminuir cobertura;
* não alterar expectativas válidas só para deixar teste verde;
* registrar qualquer bug real encontrado;
* evitar refatorações não relacionadas.

Não fazer commit automático.

---

# 23. Critério de sucesso

A v1.8 só está concluída quando conseguirmos demonstrar este fluxo real:

```text
Dados reais dos módulos
        ↓
Operational Signals
        ↓
Director Operations Brief
        ↓
Usuário identifica uma situação
        ↓
Propor ação
        ↓
Planner existente
        ↓
Policy Evaluator
        ↓
Action Plan
        ↓
Executor / Approval / Block / Shadow
        ↓
Audit
```

E, adicionalmente, um Job recorrente deve conseguir gerar o briefing usando a infraestrutura existente de Jobs/Runs.

---

# 24. Entrega final

Ao finalizar, entregar relatório exatamente nesta estrutura:

1. Resumo
2. Inventário dos módulos
3. Sinais implementados
4. Sinais avaliados mas não implementados e motivo
5. Arquitetura
6. Arquivos criados
7. Arquivos alterados
8. Endpoints
9. Permissions
10. Workflow templates
11. Integração com Planner/Policy/Executor
12. Integração Jobs/Events
13. Segurança
14. Auditoria
15. Frontend
16. Testes
17. Compatibilidade v1.0–v1.7
18. Bugs encontrados
19. Riscos/débitos técnicos
20. Deploy/migrations
21. Git status

Não fazer commit.

Aguardar revisão final do Diretor/CEO.
