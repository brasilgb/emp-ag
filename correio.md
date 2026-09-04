# Agentes v3.7 — Operational Incident Review Queue & Attention Management

## Objetivo

Implementar uma fila operacional humana para revisão de incidentes, construída exclusivamente sobre as estruturas já existentes da v3.5 e v3.6.

A v3.7 NÃO deve aumentar a autonomia do sistema, NÃO deve alterar a lógica de decisão do Operational Supervisor e NÃO deve introduzir novos mecanismos automáticos de resposta.

## Descoberta obrigatória antes de qualquer migration

Antes de criar ou alterar schema, revisar:

* `audit_logs`;
* `agent_operational_incident_reviews`;
* `supervision-insights-service.ts`;
* `supervisor-service.ts`;
* Supervision Run History v3.4;
* Incident Review v3.5;
* Incident Review Workflow v3.6;
* Escalations v2.6;
* FollowUps v2.7;
* frontend atual de `/agents/operations`.

A primeira hipótese arquitetural é:

`audit_logs + agent_operational_incident_reviews + dados já derivados pela v3.5`

devem ser suficientes para implementar a fila.

Somente criar migration se for demonstrado, antes da implementação, que existe estado novo, mutável e não derivável que realmente precise ser persistido.

Não criar tabela para cachear prioridade, aging, recorrência, quantidade de incidentes, bucket temporal ou qualquer informação derivável.

## Escopo funcional

Criar uma visão operacional de **Needs Attention**.

A fila deve contemplar, no mínimo:

* incidentes `unreviewed`;
* incidentes `acknowledged` ainda não encerrados;
* incidentes recorrentes;
* incidentes antigos sem revisão;
* incidentes de maior severidade.

Estados `resolved` e `dismissed` não devem aparecer por padrão em Needs Attention, mas podem continuar acessíveis através dos filtros/histórico quando aplicável.

## Prioridade operacional

A ordenação deve ser:

* determinística;
* explicável;
* reproduzível;
* baseada exclusivamente em regras de domínio.

Não usar LLM, IA, embeddings ou classificação probabilística.

A prioridade pode considerar, conforme os dados já existentes:

* severidade;
* `reviewStatus`;
* recorrência;
* idade do incidente;
* outcome operacional;
* finding/type.

Evitar criar um "score mágico" difícil de explicar. Se um score interno for realmente útil, sua fórmula deve ser explícita e testável.

Preferir regras lexicográficas/determinísticas quando possível, por exemplo:

1. severidade;
2. recorrência;
3. review pendente;
4. aging;
5. timestamp/id como desempate estável.

A ordem final escolhida deve ser documentada.

## Aging

Calcular aging em tempo de leitura.

Não persistir contador, cronômetro nem timestamp artificial para aging.

Usar os timestamps canônicos já existentes.

Expor buckets operacionais, preferencialmente:

* `< 1h`;
* `1h–4h`;
* `4h–24h`;
* `> 24h`.

Se houver `acknowledged`, pode ser útil expor separadamente:

* idade total do incidente;
* tempo desde o último review/acknowledgement.

Não inventar SLA ainda. A v3.7 deve mostrar aging; não criar automaticamente obrigação contratual/SLA.

## Filtros

Suportar combinação dos filtros úteis já presentes ou deriváveis:

* review status;
* severidade;
* finding/type;
* outcome;
* recorrência;
* período;
* aging/bucket, se adequado à arquitetura atual.

Os filtros devem funcionar conjuntamente.

Evitar duplicar dois mecanismos diferentes de filtro entre histórico e fila se a mesma infraestrutura puder ser reutilizada.

## Backend

Reutilizar os serviços da v3.5/v3.6 sempre que possível.

Não criar outro conceito de incidente.

A identidade canônica continua sendo exclusivamente:

`audit_logs` com action `agents.operations.incident.detected`.

A fila é uma projeção desses incidentes e respectivos reviews.

Evitar N+1.

Uma página com N incidentes deve ser enriquecida com reviews/recorrência/outcomes através de consultas em lote ou queries agregadas adequadas, nunca uma query por incidente.

Se for criado endpoint dedicado, manter namespace coerente com:

`/agents/operations/supervision-insights/...`

Avaliar primeiro se é melhor:

* estender o endpoint existente de incidentes;
* ou criar endpoint específico para Needs Attention.

Escolher a opção que preserve responsabilidade clara e evite duplicação de regra.

## Autorização

Não criar permission nova sem justificativa real.

Leitura deve reutilizar:

`agents.operations.read`

As ações de acknowledgment/resolution/dismissal continuam exclusivamente pela API de review da v3.6 e exigem:

`agents.operations.manage`

A fila em si não deve introduzir nova ação mutável.

## Frontend

Integrar em `/agents/operations`.

Criar uma seção clara de **Needs Attention**.

Ela deve permitir ao operador entender rapidamente:

* o que precisa de atenção;
* por que aquele incidente aparece acima de outro;
* há quanto tempo ocorreu;
* se é recorrente;
* qual é o estado do review;
* qual foi o outcome operacional.

Fornecer acesso direto ao Incident Review já existente.

As ações:

* acknowledge;
* resolve;
* dismiss

devem continuar utilizando exclusivamente o workflow/API da v3.6.

Não criar segunda implementação de review no frontend.

Evitar cards redundantes se a mesma informação já estiver presente no overview. Priorizar utilidade operacional.

## Fronteiras arquiteturais obrigatórias

Não alterar:

* `supervisor-guard.ts`;
* lógica de `applyResponse`;
* decisão do Supervisor;
* detecção de incidentes;
* mecanismo de Escalation;
* mecanismo de FollowUp;
* Circuit Breakers;
* autonomia;
* planner/policy/executor;
* scheduler, salvo leitura necessária e sem mudança comportamental.

Não criar:

* novo Supervisor;
* segunda identidade de incidente;
* nova fila persistida;
* Redis queue para este workflow;
* lock distribuído;
* worker novo apenas para calcular atenção;
* classificação por LLM.

A v3.7 organiza trabalho humano. Ela não torna o sistema mais autônomo.

## Concorrência

A v3.7 deve ser majoritariamente leitura.

Toda mutação continua delegada ao review workflow atômico da v3.6.

Não adicionar estado concorrente desnecessário.

## Testes obrigatórios

Adicionar testes cobrindo pelo menos:

1. incidente `unreviewed` aparece em Needs Attention;
2. incidente `acknowledged` aparece quando ainda aplicável;
3. `resolved` e `dismissed` ficam fora da fila padrão;
4. severidade influencia corretamente a ordenação;
5. recorrência influencia corretamente a ordenação;
6. aging `<1h`;
7. aging exatamente no limite de 1h;
8. aging exatamente no limite de 4h;
9. aging exatamente no limite de 24h;
10. aging `>24h`;
11. desempate determinístico;
12. filtros combinados;
13. filtro por review status;
14. filtro por recorrência;
15. filtro por outcome;
16. paginação preserva ordenação determinística;
17. ausência de N+1;
18. usuário apenas com `agents.operations.read` consegue consultar a fila;
19. usuário sem permission de leitura recebe 403;
20. manipular review através da v3.6 atualiza a projeção da fila;
21. alterar review NÃO altera o outcome operacional;
22. nenhuma alteração indireta na decisão/resposta do Supervisor;
23. incidentes históricos sem review são sintetizados corretamente como `unreviewed`.

Preferir relógio controlável/injetável nos testes de aging em vez de sleeps reais.

## Validação final

Executar no fechamento:

* migration somente se realmente criada e previamente justificada;
* `npx tsc --noEmit`;
* testes específicos da v3.7;
* suíte completa do backend com a mesma política de isolamento já consolidada;
* lint/build do frontend conforme baseline atual;
* verificar regressões da v3.5 e v3.6;
* verificar que `supervisor-guard.ts` permaneceu intocado;
* verificar que nenhuma lógica autônoma foi adicionada;
* verificar que nenhum N+1 foi introduzido.

## Relatório de entrega

Ao finalizar, responder com relatório contendo:

1. análise de persistência e decisão sobre migration;
2. regra exata da fila Needs Attention;
3. regra exata de ordenação/prioridade;
4. definição de aging e limites dos buckets;
5. endpoints alterados/criados;
6. autorização utilizada;
7. integração com v3.5/v3.6;
8. estratégia usada para evitar N+1;
9. arquivos criados/alterados;
10. testes adicionados;
11. resultado completo da validação;
12. confirmação explícita de que:

* `supervisor-guard.ts` não foi alterado;
* não houve aumento de autonomia;
* não foi criado novo Circuit Breaker;
* não foi criada segunda identidade de incidente;
* nenhuma ação automática nova foi adicionada.

Não fazer commit.

Entregar tudo no working tree para revisão.
