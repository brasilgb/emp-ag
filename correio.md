Agentes v3.5 — Operational Supervision Insights & Incident Review

Objetivo:
Transformar o histórico operacional já existente em uma camada clara de análise e revisão de incidentes, permitindo entender recorrência, severidade, respostas aplicadas e resultados do Operational Supervisor.

Regras:
- Não aumentar autonomia dos agentes.
- Não criar novo supervisor.
- Não criar novo Circuit Breaker.
- Não alterar Planner, Policy Evaluator ou Executor salvo necessidade estritamente de leitura/integração já existente.
- Reutilizar supervisor runs, findings, incidents, responses, escalations e auditoria existentes.
- Manter segurança, isolamento e fail-closed.
- Não duplicar dados que já tenham fonte oficial.
- Toda mudança estrutural deve ser justificada antes de migration.

Escopo funcional:

1. Operational Supervision Overview
Criar visão consolidada para análise dos runs de supervisão:
- total de runs;
- runs concluídos/falhos;
- incidentes encontrados;
- distribuição por severidade;
- responses aplicadas;
- recuperações automáticas;
- restrições de autonomia;
- escalonamentos para atenção manual;
- incidentes recorrentes.

2. Histórico pesquisável
Permitir consulta do histórico com filtros por:
- período;
- status do run;
- severidade;
- tipo/categoria do finding ou incidente;
- response aplicada;
- presença de escalonamento;
- agente/job quando houver relacionamento disponível.

3. Incident Review
Criar detalhe operacional de um incidente/finding mostrando, quando existentes:
- origem;
- run de supervisão;
- timestamp;
- severidade;
- evidências/contexto persistido;
- decisão tomada;
- response aplicada;
- resultado;
- escalation relacionada;
- referências de auditoria;
- agente/job/run relacionado.

4. Recorrência
Identificar incidentes recorrentes usando os dados existentes.
Não introduzir classificação por IA.
A regra deve ser determinística e auditável.
Caso o modelo atual não possua chave adequada para agrupamento, documentar a limitação antes de propor schema novo.

5. Métricas
Disponibilizar métricas agregadas via backend, evitando cálculo inconsistente no frontend.
Preferir queries/read models sobre a fonte oficial existente.
Não persistir agregados se puderem ser derivados com custo razoável.

6. Frontend
Adicionar ou evoluir a área do Control Center/Agents com:
- dashboard de supervisão;
- filtros;
- tabela de histórico;
- detalhe de incidente;
- indicadores operacionais simples e legíveis.
Evitar gráficos decorativos sem valor operacional.

7. Segurança
- respeitar autenticação e autorização existentes;
- não expor payloads sensíveis, secrets, tokens ou credenciais;
- manter autorização server-side;
- nenhum acesso direto do frontend ao banco;
- revisar campos de evidência/contexto antes de exposição pela API.

8. Testes obrigatórios
Cobrir:
- filtros;
- agregações;
- isolamento/autorização;
- vínculo run → incident/finding → response → escalation;
- recorrência;
- ausência de dados sensíveis;
- comportamento com histórico vazio;
- regressão do histórico v3.4.

Gate de fechamento:
- npx tsc --noEmit limpo;
- suíte completa do backend verde;
- testes novos determinísticos;
- frontend lint/typecheck/build limpos conforme scripts existentes;
- git diff --check limpo;
- nenhuma alteração fora do escopo sem justificativa;
- relatório final com arquivos, migrations, endpoints, testes e git status;
- não fazer commit até aprovação.