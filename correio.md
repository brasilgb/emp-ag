# Agentes v2.5 — Operational Supervision & Autonomous Incident Response

## 1. Objetivo

Implementar uma camada de supervisão operacional sobre a arquitetura de agentes existente, capaz de detectar degradações operacionais, correlacionar sinais provenientes dos módulos já existentes e aplicar respostas seguras e determinísticas.

A v2.5 NÃO deve criar um novo sistema de execução.

Ela deve coordenar exclusivamente mecanismos já existentes:

* Jobs
* Runs
* Events
* Event Rules
* Action Plans
* Approvals
* Decision Queue
* Recovery v2.4
* Circuit Breaker / autonomy controls
* Audit logs
* Policy Evaluator

O supervisor deve responder à seguinte pergunta:

> “Existe alguma condição operacional que exija observação, recuperação segura, redução de autonomia ou intervenção humana?”

---

# 2. Princípio arquitetural obrigatório

O Operational Supervisor é um **coordenador de segurança operacional**, não um Executor.

Fluxo conceitual:

```text
Operational Signals
       ↓
Health Assessment
       ↓
Incident Classification
       ↓
Response Policy
       ↓
observe
recover
restrict_autonomy
manual_attention
       ↓
Existing official mechanisms
```

Proibido:

```text
Supervisor
   ↓
LLM decide o que executar
   ↓
tool arbitrária
```

O LLM nunca deve decidir autonomamente:

* conceder permissões;
* ignorar approvals;
* reativar autonomia;
* executar shell;
* executar SQL arbitrário;
* chamar ferramentas fora do catálogo oficial;
* alterar Policy Evaluator;
* modificar roles/permissions;
* contornar Circuit Breaker.

---

# 3. Fontes de sinais

Reaproveitar dados reais da plataforma.

O supervisor deve inicialmente considerar, no mínimo:

### Workflow Recovery

Dados da v2.4:

* stale workflows;
* manual attention pendente;
* última reconciliação;
* falhas de recovery.

### Jobs / Runs

Detectar situações como:

* runs consecutivamente falhando;
* job com muitas falhas recentes;
* execução presa;
* budget excedido;
* job desabilitado por segurança;
* scheduler executando mas workflow não avançando.

Não inventar estados: revisar schema e código existentes antes da implementação.

### Event Engine

Considerar:

* deliveries falhando repetidamente;
* evento sem processamento esperado;
* event rules produzindo falhas repetidas;
* backlog operacional anormal, caso possa ser calculado com dados existentes.

### Approvals

Considerar:

* approvals críticas pendentes por período excessivo;
* grande volume pendente;
* execução bloqueada exclusivamente aguardando aprovação.

A existência de approval pendente não deve automaticamente representar incidente.

### Decision Queue

Considerar:

* decisões operacionais abertas;
* decisões `agents.recovery.*`;
* itens `requiresHumanAttention=true`.

### Circuit Breaker / Autonomy

Considerar:

* circuit breaker aberto;
* autonomy global desabilitada;
* bloqueios recentes;
* recorrência de trips.

### Audit Logs

Usar quando necessário para calcular:

* falhas recentes;
* última ocorrência;
* histórico de incidentes;
* mudanças de estado.

Evitar criar nova persistência se a informação já puder ser derivada de forma barata e segura.

---

# 4. Operational Health Snapshot

Criar um serviço central equivalente conceitualmente a:

```ts
getOperationalHealth()
```

Ele deve produzir um snapshot estruturado semelhante a:

```ts
type OperationalHealth = {
  status:
    | 'healthy'
    | 'degraded'
    | 'attention_required'
    | 'restricted';

  generatedAt: Date;

  summary: {
    activeIncidents: number;
    criticalIncidents: number;
    manualAttentionPending: number;
    staleWorkflows: number;
    failingJobs: number;
    failingDeliveries: number;
  };

  signals: OperationalSignal[];

  incidents: OperationalIncident[];

  recommendations: OperationalRecommendation[];
};
```

Os nomes podem ser ajustados ao padrão real do projeto.

Não persistir snapshots apenas por conveniência.

---

# 5. Operational Signals

Criar um vocabulário pequeno e explícito.

Exemplo:

```ts
type OperationalSignal = {
  type: OperationalSignalType;
  severity: 'info' | 'warning' | 'critical';
  source: string;
  entityType?: string;
  entityId?: string;
  detectedAt: Date;
  reason: string;
  metadata?: Record<string, safe value>;
};
```

Nunca incluir:

* secrets;
* tokens;
* credentials;
* payloads sensíveis;
* stack traces completos contendo informações confidenciais.

---

# 6. Classificação de incidentes

Um ou mais sinais relacionados poderão formar um incidente operacional.

Tipos iniciais sugeridos:

```text
workflow_stale
repeated_job_failure
run_stuck
delivery_failure
recovery_required
manual_attention_required
autonomy_circuit_open
approval_bottleneck
operational_degradation
```

Não criar tipos que não correspondam a condições reais encontradas no código.

---

# 7. Severidade

Definir severidade deterministicamente.

Sugestão inicial:

### info

Situação operacional observável, porém sem degradação.

### warning

Há degradação ou risco operacional, mas o sistema continua funcionando.

### critical

Existe risco de:

* loop operacional;
* execução repetidamente falhando;
* perda de controle da autonomia;
* impossibilidade de reconciliar automaticamente;
* integridade operacional ameaçada.

Severity nunca deve ser escolhida por LLM.

---

# 8. Response Policy

Criar um componente explícito semelhante a:

```text
operational-response-policy.ts
```

A política recebe o incidente e retorna exclusivamente uma destas decisões:

```ts
type OperationalResponse =
  | 'observe'
  | 'safe_recovery'
  | 'restrict_autonomy'
  | 'manual_attention';
```

Se houver necessidade real, pode existir:

```text
already_handled
```

ou equivalente.

Evitar vocabulário excessivo.

---

# 9. Observe

Usado quando:

* condição merece monitoramento;
* não existe correção automática comprovadamente segura;
* ainda não atingiu threshold de intervenção.

Nenhuma mutação operacional deve ocorrer.

Deve haver auditabilidade adequada.

---

# 10. Safe Recovery

Safe Recovery significa exclusivamente chamar mecanismos de recovery já considerados seguros.

Inicialmente:

```text
Recovery v2.4
```

O Supervisor NÃO deve implementar reconciliação própria.

Exemplo:

```text
incident
   ↓
Response Policy = safe_recovery
   ↓
runRecovery/reconcileOne existente
```

Nunca:

```text
incident
   ↓
Supervisor altera diretamente tabela de workflow
```

---

# 11. Restrict Autonomy

Esta é uma ação de segurança.

Usar somente quando existir condição objetiva que torne perigoso continuar executando autonomamente.

Exemplos possíveis:

* falhas repetidas acima de threshold;
* circuit breaker já indicando degradação;
* loop de execução detectado;
* volume de falhas superior a limite de segurança.

Preferencialmente utilizar mecanismo de autonomia/circuit breaker já existente.

Não criar um segundo kill switch.

### Regra fundamental

O Supervisor pode:

```text
reduzir autonomia
```

mas NÃO pode automaticamente:

```text
aumentar autonomia
```

Se autonomia foi reduzida por segurança, restaurá-la deve obedecer ao mecanismo existente e, quando apropriado, exigir CEO/admin.

---

# 12. Manual Attention

Reutilizar a Director Decision Queue.

Não criar:

* incident inbox separada;
* segunda tabela de decisões;
* segunda central de aprovações.

Para incidentes que exigem atenção humana:

```text
domain='agents'
signalType='agents.operations.<tipo>'
requiresHumanAttention=true
```

ou padrão equivalente coerente com v1.9/v2.4.

Deduplicação obrigatória.

O mesmo incidente não pode criar uma nova decisão a cada scan.

---

# 13. Incident Correlation

Implementar correlação simples e determinística.

Exemplo:

```text
job X
↓
run failure
↓
novo run
↓
failure
↓
novo run
↓
failure
```

Deve representar uma condição operacional única de:

```text
repeated_job_failure: job X
```

e não três incidentes independentes, se semanticamente forem o mesmo problema.

Não implementar machine learning.

Não utilizar LLM para correlation.

Preferir:

```text
incidentType + entityType + entityId
```

como identidade/deduplication key quando aplicável.

---

# 14. Thresholds

Todos os thresholds operacionais devem:

* possuir defaults conservadores;
* ser configuráveis;
* ter limites mínimos/máximos razoáveis;
* ficar centralizados em env/config;
* não aparecer como números mágicos espalhados pelo código.

Exemplos que podem ser necessários:

```text
AGENT_OPERATIONAL_JOB_FAILURE_THRESHOLD
AGENT_OPERATIONAL_FAILURE_WINDOW_SECONDS
AGENT_OPERATIONAL_STUCK_AFTER_SECONDS
AGENT_OPERATIONAL_APPROVAL_WARNING_AFTER_SECONDS
```

Criar SOMENTE variáveis realmente utilizadas.

Não criar uma grande coleção especulativa de env vars.

---

# 15. Supervisor scan

Implementar algo conceitualmente equivalente a:

```ts
runOperationalSupervision({
  dryRun?: boolean
})
```

Fluxo:

```text
collect signals
     ↓
classify incidents
     ↓
evaluate response policy
     ↓
apply allowed responses
     ↓
audit
     ↓
return structured report
```

Resultado sugerido:

```ts
type OperationalSupervisionReport = {
  startedAt: Date;
  finishedAt: Date;

  dryRun: boolean;

  signalsDetected: number;
  incidentsDetected: number;

  observed: number;
  recovered: number;
  autonomyRestricted: number;
  escalated: number;

  results: OperationalIncidentResult[];
};
```

---

# 16. Dry-run obrigatório

Antes de execução real, deve existir modo:

```text
dryRun=true
```

No dry-run:

Permitido:

* ler banco;
* detectar sinais;
* classificar incidentes;
* aplicar Response Policy;
* produzir recomendações;
* registrar scan somente se consistente com nossa política atual de auditoria.

Proibido:

* executar recovery;
* alterar autonomia;
* criar Decision Item;
* modificar workflows.

O resultado deve mostrar claramente:

```text
would_observe
would_recover
would_restrict_autonomy
would_escalate
```

ou equivalente.

---

# 17. Idempotência

Executar o supervisor duas vezes sobre o mesmo estado não pode:

* criar decisões duplicadas;
* abrir incidentes duplicados;
* repetir recuperação destrutiva;
* desabilitar repetidamente algo já desabilitado;
* multiplicar side effects.

Todos os efeitos reais devem possuir predicados condicionais, deduplicação ou reutilizar serviços já idempotentes.

---

# 18. Concorrência

Duas execuções simultâneas do supervisor devem ser seguras.

Não exigir necessariamente lock global caso a arquitetura consiga ser naturalmente idempotente.

Porém:

```text
SELECT
↓
decisão em memória
↓
UPDATE incondicional
```

não é aceitável para operações críticas.

Usar mecanismos condicionais/transacionais existentes.

---

# 19. Scheduler

Diferentemente da v2.4, a arquitetura da v2.5 DEVE estar pronta para execução recorrente.

Entretanto:

### primeira entrega

Implementar execução manual e serviço reutilizável.

### execução automática

Só integrar ao scheduler existente se puder ser feito de forma pequena, segura e sem criar outro scheduler.

Se o scheduler atual puder chamar o serviço diretamente, pode ser integrado.

Caso a integração aumente muito o escopo, deixar serviço pronto e documentar a ativação automática para v2.5.1.

Não criar:

* cron interno concorrente;
* segundo scheduler;
* setInterval solto dentro do backend.

---

# 20. Persistência de incidentes

Antes de criar uma tabela `operational_incidents`, avaliar se incidentes podem ser derivados de:

* estado atual;
* audit logs;
* Decision Queue.

Preferência:

```text
não criar tabela nova
```

nesta versão, desde que status e histórico possam ser representados adequadamente.

Criar persistência somente se tecnicamente necessária e justificar no relatório.

---

# 21. Auditoria

Eventos sugeridos:

```text
agents.operations.scan.started
agents.operations.signal.detected
agents.operations.incident.detected
agents.operations.safe_recovery
agents.operations.autonomy_restricted
agents.operations.manual_attention
agents.operations.scan.completed
```

Ajustar conforme arquitetura real.

Registrar somente eventos significativos.

Evitar gerar dezenas de audit logs por entidade saudável.

---

# 22. Permissions

Avaliar permissions existentes antes de criar novas.

Leitura provavelmente poderá usar:

```text
agents.operations.read
```

Execução administrativa deve avaliar se:

```text
agents.recovery.manage
```

é semanticamente suficiente ou se realmente precisamos de:

```text
agents.operations.manage
```

Criar nova permission somente se houver necessidade semântica real.

Autorização sempre no backend.

Frontend nunca deve ser barreira de segurança.

---

# 23. API

Sugestão inicial:

```http
GET /agents/operations/health
GET /agents/operations/incidents
POST /agents/operations/supervise?dryRun=true
POST /agents/operations/supervise?dryRun=false
```

Só criar endpoints adicionais se houver necessidade objetiva.

O endpoint de execução nunca deve aceitar instruções livres do usuário como:

```json
{
  "action": "execute anything"
}
```

Ele executa apenas a política operacional previamente codificada.

---

# 24. Frontend

Criar uma página administrativa:

```text
/agents/operations
```

Nome visual sugerido:

```text
Operações
```

ou:

```text
Saúde Operacional
```

Adicionar à sub-nav de Agentes.

Tela deve ser claramente operacional, não uma ferramenta cotidiana.

---

# 25. Dashboard operacional

Exibir:

### Overall health

```text
Healthy
Degraded
Attention Required
Restricted
```

### Indicadores

* incidentes ativos;
* incidentes críticos;
* stale workflows;
* jobs com falhas;
* falhas de eventos/deliveries;
* atenção humana;
* estado da autonomia;
* estado do circuit breaker;
* último scan.

### Incidentes

Tabela:

```text
Severity
Type
Entity
Problem
Detected
Recommended response
Current state
```

---

# 26. Ações da UI

Permitir:

### Simular supervisão

Executa `dryRun=true`.

Sem confirmação obrigatória.

### Executar supervisão

Executa operação real.

Exigir diálogo de confirmação.

Mostrar antes:

```text
Esta operação poderá executar recoveries previamente autorizados,
restringir autonomia em condições de segurança e criar itens de
atenção humana.
```

Não apresentar como “IA vai corrigir tudo”.

---

# 27. Autonomous safety rules

Adicionar regras explícitas e testes para provar que o Supervisor:

1. nunca concede permission;
2. nunca altera role;
3. nunca executa SQL arbitrário;
4. nunca executa shell;
5. nunca executa tool arbitrária;
6. nunca cria Action Plan por conta própria;
7. nunca ignora approval;
8. nunca altera decisão do Policy Evaluator;
9. nunca remove bloqueio imposto por Circuit Breaker;
10. nunca aumenta autonomia automaticamente;
11. só executa recovery pelos serviços oficiais;
12. só escala humanos pela Decision Queue oficial.

---

# 28. Testes obrigatórios

Cobrir no mínimo:

## Signal detection

1. estado saudável não gera incidente;
2. stale workflow gera signal;
3. falha isolada de job abaixo do threshold não gera incidente crítico;
4. falhas consecutivas atingindo threshold geram incidente;
5. condição de autonomia restrita aparece no health;
6. Decision Queue com recovery pendente aparece no health.

## Classification

7. severity correta para warning;
8. severity correta para critical;
9. incident correlation evita duplicação;
10. entidade diferente produz incidente independente.

## Policy

11. condição observável → observe;
12. stale recuperável → safe_recovery;
13. condição perigosa → restrict_autonomy;
14. condição não reconciliável → manual_attention.

## Safety

15. supervisor nunca cria Action Plan;
16. nunca cria approval;
17. nunca chama ferramenta arbitrária;
18. nunca modifica permissions;
19. nunca aumenta autonomia;
20. nunca ignora Circuit Breaker.

## Execution

21. dry-run sem side effects;
22. dry-run informa ações que seriam executadas;
23. safe recovery chama Recovery v2.4;
24. manual attention reutiliza Decision Queue;
25. restrict autonomy reutiliza mecanismo oficial.

## Idempotency

26. dois scans não duplicam Decision Item;
27. recovery já realizado não roda novamente;
28. autonomy já restrita não sofre efeito duplicado.

## Concurrency

29. dois supervisors concorrentes não provocam dois efeitos reais incompatíveis.

## API/Auth

30. leitura sem permission → 403;
31. leitura com permission adequada → 200;
32. execução sem permission administrativa → 403;
33. dry-run autorizado → 200;
34. execução real autorizada → 200.

## Status

35. health summary matematicamente consistente;
36. contagem por severity consistente;
37. último scan auditado corretamente.

Adicionar outros testes que forem necessários após leitura do código real.

---

# 29. Compatibilidade

A v2.5 deve preservar integralmente:

* Agentes v1.x;
* Action Planning;
* Approvals;
* Jobs;
* Runs;
* Events;
* Event Rules;
* Director Decision Queue;
* Strategy;
* Executive Reviews;
* Strategic Memory;
* Recovery v2.4;
* Circuit Breaker;
* permissions atuais;
* audit logs atuais.

Nenhum fluxo existente deve ser reimplementado.

---

# 30. Migração

Evitar migration.

Antes de criar nova tabela/coluna:

1. verificar schema atual;
2. verificar audit logs;
3. verificar Decision Queue;
4. verificar estado do Job/Run/Event;
5. verificar Recovery.

Se for inevitável criar migration:

* justificar;
* manter mínima;
* adicionar índices necessários;
* garantir compatibilidade com dados existentes.

---

# 31. Processo obrigatório de implementação

Antes de escrever código:

1. revisar implementação real de Jobs/Runs;
2. revisar Event Engine;
3. revisar Approvals;
4. revisar Decision Queue;
5. revisar Circuit Breaker/autonomy;
6. revisar Recovery v2.4;
7. revisar audit logs;
8. mapear quais estados reais representam degradação;
9. documentar rapidamente o mapa encontrado.

Somente então implementar.

Não inferir estados apenas pelos nomes.

---

# 32. Validação final

Executar:

### Backend

```bash
npx tsc --noEmit
```

Suite completa usando o mesmo runner/concurrency oficial do projeto.

Registrar números exatos:

```text
tests
pass
fail
skipped
```

Comparar contra baseline da v2.4:

```text
526 / 526
```

### Frontend

Executar suite completa.

Baseline da v2.4:

```text
87 / 87
```

Executar:

```bash
npx tsc --noEmit
npm run build
```

Executar lint somente se houver script/config real.

Não afirmar lint OK se lint não existir.

---

# 33. Relatório final

Entregar relatório contendo:

1. resumo;
2. mapa operacional encontrado;
3. arquitetura;
4. fontes de sinais;
5. signal types;
6. incident types;
7. severity;
8. health calculation;
9. response policy;
10. safe recovery;
11. autonomy restriction;
12. manual attention;
13. correlation/deduplication;
14. thresholds;
15. dry-run;
16. concorrência;
17. idempotência;
18. scheduler;
19. auditoria;
20. API;
21. permissions;
22. frontend;
23. migrations;
24. arquivos criados;
25. arquivos alterados;
26. testes adicionados;
27. números exatos backend;
28. números exatos frontend;
29. typecheck/build;
30. git diff --stat;
31. git status;
32. bugs/limitações reais encontrados.

### Regra final

**NÃO FAZER COMMIT.**

Todas as mudanças devem permanecer no working tree aguardando análise e autorização do Diretor/CEO.

---

# 34. Critérios de aprovação

A v2.5 somente será aprovada se:

* não criar segundo Executor;
* não criar segundo scheduler;
* não criar segundo Circuit Breaker;
* não criar segunda Decision Queue;
* não criar mecanismo paralelo de recovery;
* incidentes forem derivados de estados reais;
* classificação for determinística;
* Response Policy não depender de LLM;
* recovery usar exclusivamente v2.4;
* supervisor nunca elevar autonomia;
* condição perigosa puder restringir autonomia;
* condição ambígua for escalada ao humano;
* dry-run não produzir side effects;
* execução real for idempotente;
* concorrência for segura;
* operations health estiver disponível;
* auditoria estiver implementada;
* backend authorization estiver correta;
* testes de segurança cobrirem proibições críticas;
* suíte completa permanecer verde;
* frontend build permanecer verde;
* nenhuma regressão arquitetural for introduzida.

Não mascarar bugs encontrados durante a implementação. Registrar todos no relatório final, mesmo quando forem corrigidos durante o desenvolvimento.
