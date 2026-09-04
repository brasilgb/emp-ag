# Agentes v4.2 — Operational SLA Analytics & Performance Visibility

## Objetivo

Implementar uma camada de **analytics e visibilidade de desempenho operacional baseada nos dados de incidentes e SLA já existentes**, transformando a visão individual da v4.1 em indicadores agregados de operação.

A v4.2 deve responder perguntas como:

* quantos incidentes foram encerrados dentro e fora do SLA;
* qual é o breach rate;
* quanto tempo, em média e mediana, leva para reconhecer um incidente;
* quanto tempo leva para resolvê-lo;
* como esses indicadores variam por severidade;
* como o desempenho varia entre responsáveis;
* como o desempenho evolui no tempo.

A versão é **estritamente analítica e observacional**.

Não deve:

* criar autoassignment;
* alterar prioridade da fila;
* reatribuir incidentes;
* fechar incidentes;
* escalar automaticamente;
* criar follow-up automaticamente;
* disparar ações por breach;
* criar scheduler de SLA;
* alterar autonomia;
* usar LLM para classificação ou decisão;
* modificar `supervisor-guard.ts`.

---

# 1. Descoberta obrigatória antes da implementação

Antes de criar código, revisar obrigatoriamente:

* `audit_logs`;
* `agent_operational_incident_reviews`;
* `agent_operational_incident_assignments`;
* SLA da v4.1;
* `computeIncidentSla`;
* timeline v4.0;
* fila `Needs Attention`;
* workload/ownership v3.9;
* `supervision-insights-service.ts`;
* `incident-review-service.ts`;
* `incident-assignment-service.ts`;
* endpoints atuais de Operations;
* tipos frontend relacionados a incidentes;
* componentes atuais de `/agents/operations`;
* RBAC de `agents.operations.read` e `agents.operations.manage`;
* quaisquer utilitários existentes de agregação, período, paginação e data.

Responder explicitamente no relatório final:

1. Os dados necessários para analytics já existem?
2. Algum indicador exige estado novo persistido?
3. É necessária migration?
4. Quais timestamps são fontes canônicas para:

   * detecção;
   * acknowledgement;
   * assignment;
   * fechamento;
   * deadline?
5. É possível calcular os indicadores diretamente dos dados existentes?
6. O volume esperado permite agregação em tempo de leitura?
7. Existe risco de N+1?
8. Algum indicador requer reconstrução histórica via `audit_logs`?
9. Qual é a diferença entre métricas de incidentes abertos e fechados?
10. Quais métricas seriam semanticamente incorretas sem um intervalo temporal explícito?

Não criar migration antes de responder essas perguntas.

---

# 2. Regra arquitetural principal

A v4.2 deve trabalhar, sempre que possível, como uma camada de leitura.

Não persistir:

* breach rate;
* médias;
* medianas;
* percentuais;
* tempos médios;
* séries temporais;
* rankings;
* contadores derivados;
* snapshots de analytics.

Esses valores devem ser derivados dos registros canônicos.

Uma tabela/materialized view/cache só pode ser considerada se houver evidência concreta de que a leitura direta é inadequada.

Se isso não for comprovado, não criar infraestrutura adicional.

---

# 3. Escopo temporal

Toda métrica agregada deve possuir período explícito.

Implementar filtro temporal com pelo menos:

* `from`;
* `to`.

Preferencialmente suportar presets no frontend:

* 24 horas;
* 7 dias;
* 30 dias;
* período personalizado.

Definir claramente qual timestamp determina a inclusão do incidente em cada métrica.

Regra sugerida:

### Métricas de entrada

Para:

* incidentes detectados;
* severidade;
* volume de entrada;

usar `detectedAt`.

### Métricas de fechamento

Para:

* incidentes resolvidos;
* SLA cumprido;
* SLA violado;
* resolution time;

usar `closedAt`.

Essa distinção deve ficar documentada no código e nos contratos.

---

# 4. Métricas mínimas

Criar um contrato agregado equivalente a:

```ts
interface OperationalSlaAnalytics {
  period: {
    from: string
    to: string
  }

  incidents: {
    detected: number
    closed: number
    open: number
  }

  sla: {
    completedWithinSla: number
    completedOutsideSla: number
    breachRate: number | null
  }

  acknowledgement: {
    count: number
    averageSeconds: number | null
    medianSeconds: number | null
  }

  resolution: {
    count: number
    averageSeconds: number | null
    medianSeconds: number | null
  }
}
```

Os nomes finais podem seguir as convenções já existentes do projeto.

Não retornar `0` quando semanticamente o valor é desconhecido ou não aplicável.

Exemplo:

```ts
averageSeconds: null
```

quando não existem incidentes suficientes.

---

# 5. SLA compliance

Para incidentes encerrados no período:

```text
closedAt <= deadlineAt
    → within SLA

closedAt > deadlineAt
    → outside SLA
```

O status visual corrente `completed` da v4.1 não elimina o fato histórico de SLA.

Portanto:

```text
completedWithinSla
completedOutsideSla
```

devem ser derivados comparando o fechamento real com o deadline.

Não usar apenas `sla.status`.

O `breachRate` deve ser calculado sobre incidentes encerrados que possuem SLA válido:

```text
completedOutsideSla
/
(completedWithinSla + completedOutsideSla)
```

Se o denominador for zero:

```text
breachRate = null
```

Não retornar `NaN`, `Infinity` ou `0` arbitrário.

---

# 6. Acknowledgement time

Calcular:

```text
acknowledgementSeconds =
acknowledgedAt - detectedAt
```

Usar o timestamp real da primeira transição:

```text
unreviewed → acknowledged
```

já estabelecido na v4.1.

Incident sem acknowledgement:

* não entra em média/mediana de acknowledgement;
* pode aparecer em um contador separado caso isso seja útil e simples.

Não inferir acknowledgement a partir do estado atual.

---

# 7. Resolution time

Para incidentes encerrados:

```text
resolutionSeconds =
closedAt - detectedAt
```

Considerar `resolved` e `dismissed`.

Entretanto, se a arquitetura atual distinguir semanticamente resolução de dismiss para analytics, avaliar durante a descoberta.

Não inventar essa separação antes de verificar os contratos existentes.

---

# 8. Média e mediana

Implementar:

* média;
* mediana.

A mediana é obrigatória porque incidentes operacionais podem ter distribuições com outliers e a média isolada pode ser enganosa.

As funções de agregação devem ser:

* puras quando possível;
* determinísticas;
* testáveis isoladamente.

Casos obrigatórios:

```text
[]
→ null

[10]
→ 10

[10, 20]
→ 15

[10, 20, 30]
→ 20
```

Não usar arredondamento silencioso se o contrato utilizar segundos inteiros.

---

# 9. Breakdown por severidade

Produzir os principais indicadores por:

```text
info
warning
critical
```

Exemplo conceitual:

```ts
bySeverity: {
  info: ...
  warning: ...
  critical: ...
}
```

Cada severidade deve apresentar pelo menos:

* detected;
* closed;
* within SLA;
* outside SLA;
* breach rate.

Se for simples e sem duplicação excessiva, incluir também:

* acknowledgement average/median;
* resolution average/median.

Usar exclusivamente `OPERATIONAL_SEVERITIES`.

Não introduzir `high`, `medium`, `low` ou qualquer vocabulário inexistente no projeto.

---

# 10. Analytics por responsável

Adicionar visão de desempenho por responsável atual/histórico apenas se for possível fazê-la semanticamente correta com a persistência existente.

Antes de implementar, responder:

> O assignment atual da v3.8 representa quem efetivamente tratou o incidente historicamente?

Se NÃO representar, não atribuir retrospectivamente todo o desempenho ao owner atual.

Nesse caso, implementar apenas métricas cuja autoria seja inequívoca.

Não criar conclusões falsas a partir de estado corrente.

Se o histórico existente permitir identificar corretamente o responsável no momento do fechamento, poderá existir algo equivalente a:

```ts
interface OperationalSlaAssigneeAnalytics {
  userId: string
  displayName: string | null

  closed: number
  withinSla: number
  outsideSla: number
  breachRate: number | null

  averageResolutionSeconds: number | null
  medianResolutionSeconds: number | null
}
```

Não transformar essa visão em score de pessoas.

---

# 11. Proibição de ranking automático

Não criar:

* employee score;
* operator score;
* performance score;
* ranking de melhor/pior pessoa;
* leaderboard;
* classificação automática;
* recomendação de reatribuição;
* sugestão automática de capacidade.

Analytics devem apresentar fatos e indicadores.

Não transformar os dados em decisão de gestão automatizada.

---

# 12. Série temporal

Implementar uma tendência temporal simples para volume e SLA.

Exemplo:

```ts
interface OperationalSlaTrendPoint {
  date: string
  detected: number
  closed: number
  withinSla: number
  outsideSla: number
}
```

Granularidade:

* para período curto, diária;
* não criar engine genérico de time series.

Uma granularidade diária fixa é suficiente nesta versão, salvo se a descoberta mostrar utilitário existente melhor.

Datas sem eventos podem ser:

* retornadas com zero;
* ou omitidas;

desde que o contrato seja explícito e o frontend não invente valores.

---

# 13. Incidentes ainda abertos e SLA

Além das métricas de encerramento, incluir uma fotografia atual dos incidentes ainda abertos:

```ts
openSla: {
  withinSla: number
  warning: number
  breached: number
}
```

Esses números representam o estado **no momento da consulta**.

Não misturar esses valores com breach rate histórico.

Distinção obrigatória:

```text
Historical SLA compliance
≠
Current open incident SLA state
```

A UI deve deixar isso claro.

---

# 14. Endpoint

Preferir um único endpoint agregado:

```http
GET /agents/operations/sla-analytics
```

Query:

```text
?from=...
&to=...
```

Se necessário:

```text
&severity=...
```

Evitar múltiplos endpoints que executem as mesmas leituras separadamente.

O endpoint deve exigir:

```text
agents.operations.read
```

GET deve ser 100% read-only.

Nenhum audit log de mutação deve ser criado por leitura de analytics.

---

# 15. Performance

Evitar:

```text
1 query por incidente
1 query por usuário
1 query por severidade
```

Preferir:

* queries agregadas;
* leitura em lote;
* reconstrução em memória quando o volume é razoável;
* `Promise.all` apenas quando semanticamente apropriado.

Criar teste que demonstre ausência de N+1.

Idealmente instrumentar novamente `db.select` ou equivalente, como já feito na v4.1.

O número de queries não deve crescer linearmente com o número de incidentes.

---

# 16. Frontend

Adicionar uma área de analytics em `/agents/operations`.

Não criar um dashboard novo fora do módulo se não houver necessidade.

Organização sugerida:

## SLA Performance

Cards:

* Incidentes detectados
* Incidentes encerrados
* Dentro do SLA
* Fora do SLA
* Breach rate

## Response Times

Cards:

* Tempo médio até acknowledgement
* Mediana até acknowledgement
* Tempo médio até resolução
* Mediana até resolução

## Current Open SLA

Exibir:

* Within SLA
* Warning
* Breached

## By Severity

Tabela:

| Severidade | Detectados | Encerrados | Dentro | Fora | Breach |
| ---------- | ---------: | ---------: | -----: | ---: | -----: |

## Trend

Visualização temporal simples.

Se o projeto ainda não possuir biblioteca de gráficos, não adicionar dependência pesada apenas para esta versão.

Uma tabela/série visual simples pode ser preferível.

---

# 17. Formatação

Reutilizar helpers existentes.

Criar helper apenas se necessário, por exemplo:

```ts
formatOperationalDuration(seconds)
formatOperationalPercentage(value)
```

Exemplos:

```text
45s
8m
1h 32m
2d 4h
```

Percentuais:

```text
0.0842 → 8.4%
```

Não inserir lógica de negócio nos componentes React.

---

# 18. Estados vazios

Todos os blocos devem funcionar corretamente quando:

* não existem incidentes no período;
* não existem fechamentos;
* não existem acknowledgements;
* não existem breaches;
* determinada severidade não possui dados.

Não apresentar:

```text
NaN%
Infinity%
0s
```

quando o correto é:

```text
—
Sem dados
N/A
```

seguir o padrão visual já existente no projeto.

---

# 19. Testes backend

Criar testes dedicados para, no mínimo:

### Agregação pura

* média sem valores;
* média;
* mediana ímpar;
* mediana par;
* breach rate sem denominador;
* breach rate válido.

### Integração

* dentro do SLA;
* fora do SLA;
* resolved;
* dismissed;
* acknowledgement correto;
* incidente sem acknowledgement;
* intervalo temporal;
* severidades;
* open SLA states;
* consistência com SLA v4.1;
* ausência de N+1;
* isolamento entre incidentes.

### Endpoint

* 403 sem permission;
* 200 com `agents.operations.read`;
* validação de `from`;
* validação de `to`;
* `from > to` → 400;
* GET não grava audit;
* retorno vazio válido.

---

# 20. Testes frontend

Testar qualquer lógica client-side adicionada.

No mínimo:

* duration formatter;
* percentage formatter;
* null;
* zero;
* valores grandes;
* status labels, se novos.

Não testar apenas componentes estáticos se não houver lógica relevante.

---

# 21. Segurança e RBAC

Analytics devem respeitar o mesmo escopo das operações existentes.

Não ampliar acesso a incidentes.

Não permitir que a nova rota contorne filtros ou autorização usados pelos endpoints atuais.

Permissão:

```text
agents.operations.read
```

é suficiente para leitura.

Não criar nova permission sem necessidade arquitetural comprovada.

---

# 22. Não fazer nesta versão

Expressamente fora de escopo:

* alertas;
* notificações;
* e-mail;
* Slack;
* webhook;
* scheduler;
* cron;
* breach event;
* auto-escalation;
* auto-follow-up;
* autoassignment;
* autoreassignment;
* workload balancing;
* previsão de breach;
* IA;
* classificação de operador;
* ranking;
* gamificação;
* metas individuais;
* SLO engine genérico;
* políticas configuráveis genéricas;
* materialized views sem evidência de necessidade.

---

# 23. Critérios de aceite

A v4.2 só está pronta quando:

1. a descoberta arquitetural estiver documentada;
2. nenhuma migration desnecessária tiver sido criada;
3. métricas forem derivadas de fontes canônicas;
4. SLA histórico usar fechamento real;
5. SLA corrente de abertos estiver separado do histórico;
6. média e mediana estiverem corretas;
7. breakdown por severidade funcionar;
8. série temporal funcionar;
9. período temporal estiver explícito;
10. endpoint for read-only;
11. RBAC estiver correto;
12. não houver N+1;
13. frontend mostrar os indicadores sem duplicar regra de negócio;
14. estados vazios forem tratados;
15. nenhuma automação/autonomia for adicionada;
16. `supervisor-guard.ts` permanecer intacto;
17. typecheck backend estiver limpo;
18. suíte backend completa estiver verde;
19. frontend typecheck estiver limpo;
20. lint frontend estiver limpo;
21. testes frontend estiverem verdes;
22. `next build` concluir com sucesso.

---

# 24. Relatório final obrigatório

Ao concluir, apresentar:

1. resultado da descoberta;
2. decisão sobre migration;
3. fontes canônicas utilizadas;
4. definição formal de cada métrica;
5. distinção entre SLA histórico e SLA corrente;
6. estratégia de intervalo temporal;
7. estratégia para média/mediana;
8. estratégia de severidade;
9. decisão sobre analytics por responsável;
10. estratégia anti-N+1;
11. endpoints;
12. contratos;
13. arquivos criados;
14. arquivos alterados;
15. testes novos;
16. baseline anterior descoberto;
17. total final de testes;
18. resultado de typecheck/lint/build;
19. confirmação de GET read-only;
20. confirmação de que nenhum estado derivado foi persistido;
21. confirmação de que nenhuma autonomia foi adicionada;
22. confirmação de que `supervisor-guard.ts` permaneceu intacto;
23. confirmação de que nenhum commit foi realizado.

Não fazer commit.

Deixar o working tree pronto para revisão do Diretor/COO.
