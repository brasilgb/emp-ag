# Agentes v3.1 — Automatic Operational Supervision

## Diretriz geral

A v3.0 entregou observabilidade operacional real:

```text
Responsibility
  → Supervisor
  → Escalation
  → FollowUp
  → Operational Action Proposal
  → Action Plan
  → Approval
  → Executor
```

e adicionou:

* Control Center;
* filas operacionais determinísticas;
* métricas;
* SLA derivado;
* timeline baseada no audit log;
* drill-down para as entidades reais.

A v3.1 deve transformar o **Operational Supervisor já existente** em um mecanismo de supervisão automática periódica, controlada e fail-safe.

O objetivo NÃO é criar autonomia nova.

O objetivo é permitir que o sistema execute automaticamente o mesmo ciclo de supervisão operacional que hoje já pode ser executado manualmente, usando exclusivamente as estruturas existentes.

---

# 1. PRINCÍPIOS BLOQUEANTES

Antes de escrever código, releia integralmente o código envolvido.

Não inferir arquitetura por nome de arquivo.

Esta versão NÃO pode:

1. criar segundo Planner;
2. criar segundo Policy Evaluator;
3. criar segundo Executor;
4. criar segundo mecanismo de Approval;
5. criar segundo Operational Supervisor;
6. criar scheduler paralelo se já houver infraestrutura reutilizável;
7. conceder permissões especiais ao Supervisor;
8. permitir que LLM autorize ações;
9. permitir que Supervisor execute diretamente Action Plans;
10. alterar automaticamente FollowUps para `completed` ou `dismissed`;
11. criar Operational Action Proposal automaticamente apenas porque existe um problema;
12. modificar ownership estabelecido pelas versões anteriores;
13. criar polling frontend para substituir processamento backend;
14. criar estado derivado persistido sem necessidade estrutural comprovada;
15. reescrever migrations antigas;
16. transformar falhas do scheduler em falhas fatais da aplicação;
17. permitir execução concorrente do mesmo ciclo de supervisão;
18. introduzir mecanismo oculto de autonomia fora das permissions, Policy e Approval existentes.

Segurança, menor privilégio, auditabilidade e determinismo continuam sendo requisitos de arquitetura.

---

# 2. REVISÃO ARQUITETURAL OBRIGATÓRIA

Antes de implementar, mapear e documentar:

* implementação atual do Operational Supervisor;
* função que hoje dispara uma supervisão manual;
* responsabilidades avaliadas;
* criação de Escalations;
* criação/gestão de FollowUps;
* deduplicação existente;
* eventuais locks/guards existentes;
* Jobs/Scheduler já existentes;
* boot da aplicação em `server.ts`;
* Settings;
* audit log;
* Control Center v3.0;
* permissões relacionadas a Operations/Supervisor;
* comportamento em caso de erro parcial;
* comportamento quando nenhuma Responsibility precisa de intervenção.

Localizar especialmente se já existe infraestrutura genérica de scheduler que possa ser reutilizada.

Não criar scheduler novo antes de comprovar que o existente não é semanticamente adequado.

---

# 3. OBJETIVO FUNCIONAL

Criar um ciclo automático:

```text
server boot
    ↓
startOperationalSupervisionScheduler(...)
    ↓
intervalo configurado
    ↓
runScheduledOperationalSupervision()
    ↓
Operational Supervisor existente
    ↓
Responsibilities elegíveis
    ↓
Escalations / FollowUps existentes
    ↓
Control Center reflete o novo estado
```

O scheduler apenas DISPARA o Supervisor existente.

Ele nunca implementa as regras do Supervisor dentro de si.

---

# 4. FEATURE FLAG DE AMBIENTE

Adicionar configuração explícita:

```text
AGENT_OPERATIONAL_SUPERVISION_ENABLED
```

Default:

```text
false
```

Também:

```text
AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS
```

Default:

```text
300
```

Valor mínimo:

```text
60 segundos
```

Valores inválidos devem cair de forma segura para o default ou ser rejeitados conforme o padrão já utilizado pelo projeto.

Nunca permitir intervalo agressivo acidental.

---

# 5. CONTROLE ADMINISTRATIVO PERSISTIDO

Além da configuração de ambiente, avaliar e implementar um controle persistido equivalente ao padrão já usado para autonomia/global switches, se semanticamente adequado.

O estado persistido deve nascer:

```text
disabled
```

A supervisão automática só pode rodar se TODAS as guardas necessárias estiverem habilitadas.

Conceitualmente:

```text
env enabled
AND
persistent operational supervision enabled
→ scheduler pode executar

caso contrário
→ scheduler não executa supervisão
```

Se uma estrutura de Settings já existente puder representar isso sem migration, reutilizá-la.

Não criar tabela nova.

---

# 6. BOOT DA APLICAÇÃO

Integrar ao lifecycle real da aplicação.

Esperado conceitualmente:

```text
server.ts
   ↓
startOperationalSupervisionScheduler(...)
```

O boot da API NÃO pode falhar porque:

* Supervisor falhou;
* Postgres ficou momentaneamente indisponível durante uma rodada;
* Redis ficou momentaneamente indisponível;
* audit falhou durante uma rodada;
* uma Responsibility específica falhou.

O scheduler deve ser fail-safe.

Falha numa rodada:

```text
log/audit
→ rodada termina
→ aplicação continua viva
→ próxima rodada continua possível
```

---

# 7. EXECUÇÃO IMEDIATA NO BOOT

Não executar automaticamente uma rodada pesada imediatamente no boot sem avaliar o impacto.

Preferência:

```text
boot
→ scheduler inicializado
→ primeira execução no intervalo configurado
```

Se o padrão existente de scheduler do projeto já determinar outra estratégia, reutilizá-lo e documentar a decisão.

Evitar tempestade de processamento em restart de containers.

---

# 8. GUARDA DE CONCORRÊNCIA

É obrigatório impedir duas supervisões simultâneas.

Cenários:

* execução anterior demorou mais que o intervalo;
* duas chamadas do scheduler quase simultâneas;
* múltiplos gatilhos internos;
* chamada manual coincidindo com scheduler, caso ambos usem o mesmo ciclo operacional.

Deve existir no máximo:

```text
1 ciclo de supervisão ativo
```

por instância/processo.

Antes de criar lock distribuído, verificar a arquitetura atual.

Se o deploy atual possui somente uma instância do backend e não existe necessidade comprovada de coordenação distribuída, uma guarda de processo pode ser suficiente nesta versão.

Documentar explicitamente a limitação.

Não introduzir Redis lock/distributed lease sem necessidade comprovada.

---

# 9. COMPORTAMENTO EM CONCORRÊNCIA

Se uma nova rodada for disparada enquanto outra está ativa:

```text
não esperar
não criar fila paralela
não executar novamente
```

Resultado esperado:

```text
scheduler.skipped
reason = supervision_already_running
```

A rodada existente continua normalmente.

---

# 10. AUDITORIA DO SCHEDULER

Usar o audit log existente.

Eventos mínimos:

```text
agents.operational_supervision.scheduler.started
agents.operational_supervision.scheduler.completed
agents.operational_supervision.scheduler.skipped
agents.operational_supervision.scheduler.failed
```

Avaliar se `started/completed` em TODA rodada geraria ruído excessivo.

Se o audit existente já diferencia logs operacionais de auditoria de negócio, escolher a camada correta e documentar.

Obrigatório registrar pelo menos eventos relevantes como:

```text
skipped
failed
```

sem duplicar auditorias que o próprio Supervisor já gera sobre Escalations/FollowUps.

Nunca criar segunda tabela de logs.

---

# 11. RESULTADO DA RODADA

`runScheduledOperationalSupervision()` deve devolver um resumo estruturado usando dados reais do Supervisor.

Exemplo conceitual:

```ts
{
  evaluated: number
  escalationsCreated: number
  escalationsUpdated: number
  followUpsCreated: number
  followUpsUpdated: number
  skipped: number
  failed: number
}
```

Não inventar métricas que o Supervisor atual não consegue produzir de forma confiável.

Adequar o shape às estruturas reais encontradas.

---

# 12. NÃO CRIAR NOVA AUTONOMIA

O scheduler NÃO pode:

```text
FollowUp
→ Proposal automática
→ Action Plan automático
```

apenas porque detectou um problema.

A cadeia continua:

```text
Supervisor
→ Escalation
→ FollowUp
```

Depois disso, qualquer ação concreta continua dependendo do fluxo governado existente:

```text
Operational Action Proposal
→ Planner
→ Policy
→ Action Plan
→ Approval
→ Executor
```

Nenhum atalho.

---

# 13. INTERAÇÃO COM FOLLOWUPS

Preservar integralmente a v2.7/v2.9.

Scheduler/Supervisor nunca pode concluir acompanhamento porque:

* SLA voltou ao normal;
* Action Plan terminou;
* Proposal terminou;
* erro desapareceu;
* nova supervisão não encontrou o problema.

Histórico operacional deve permanecer explícito.

`completed` e `dismissed` continuam sendo transições humanas governadas pelo fluxo existente.

---

# 14. DEDUPLICAÇÃO

Reutilizar obrigatoriamente o mecanismo de deduplicação existente do Operational Supervisor.

Rodadas sucessivas não podem criar:

```text
Escalation duplicada
FollowUp duplicado
```

para a mesma condição operacional ainda ativa.

Não criar uma segunda estratégia de dedup dentro do scheduler.

Scheduler não conhece regras de negócio.

Ele apenas dispara o Supervisor.

---

# 15. CONTROL CENTER

A v3.0 deve refletir naturalmente o resultado da supervisão automática porque consulta o estado real das tabelas.

Não criar endpoint especial como:

```text
/automatic-supervision/control-center
```

Não duplicar métricas.

Após uma rodada automática:

```text
Escalation criada
FollowUp criado
```

deve aparecer no Control Center simplesmente porque os dados reais mudaram.

---

# 16. STATUS DO SCHEDULER NO CONTROL CENTER

Avaliar se é útil expor, usando informações já disponíveis:

```text
supervisão automática: ativa/inativa
última execução
último sucesso
última falha
próxima execução aproximada
```

Mas NÃO criar persistência apenas para isso nesta versão.

Se essas informações exigirem tabela/colunas novas, NÃO implementar agora.

É aceitável exibir somente:

```text
Automatic supervision: enabled/disabled
intervalo configurado
```

derivados das configurações disponíveis.

Priorizar ausência de estado redundante.

---

# 17. API ADMINISTRATIVA

Se o controle persistido exigir interface administrativa, reutilizar o padrão de Settings/global switches existente.

Não criar mecanismo próprio.

A permission deve ser administrativa já existente quando semanticamente adequada.

Antes de criar permission nova, verificar todas as permissions de:

```text
agents.operations.*
agents.settings.*
agents.autonomy.*
```

ou equivalentes reais encontradas no projeto.

Criar permission nova somente se nenhuma existente representar corretamente a operação.

---

# 18. FRONTEND

Na página:

```text
/agents/operations
```

adicionar uma pequena área de estado da supervisão automática, integrada ao Control Center.

Deve mostrar no mínimo, se disponível:

```text
Supervisão automática
Ativa / Inativa

Intervalo
5 minutos
```

Se houver switch administrativo persistido já reutilizável:

```text
Ativar
Desativar
```

respeitando permission no backend.

Frontend continua sendo apenas UX.

Toda validação real deve ocorrer no backend.

---

# 19. FAIL-SAFE

Casos que NÃO podem matar scheduler nem API:

* uma Responsibility inválida;
* uma avaliação falhar;
* uma query falhar temporariamente;
* audit falhar;
* Supervisor lançar exceção;
* nenhuma Responsibility ativa;
* nenhuma condição operacional detectada.

Sempre que possível, isolar falha de uma Responsibility das demais se o Supervisor atual já suporta isso.

Não reescrever o Supervisor para atingir esse objetivo sem necessidade.

---

# 20. SHUTDOWN

Verificar lifecycle da aplicação.

Se existe graceful shutdown:

```text
SIGTERM
SIGINT
```

o scheduler deve parar adequadamente.

Não deixar timers desnecessários impedindo o encerramento do Node.

Reutilizar o mecanismo já existente se houver.

---

# 21. TESTES MÍNIMOS

Adicionar testes suficientes para provar, no mínimo:

1. scheduler não inicia supervisão quando env flag está desabilitada;
2. scheduler não executa quando switch persistido está desabilitado;
3. scheduler executa quando todas as guardas estão habilitadas;
4. intervalo abaixo do mínimo não é aceito silenciosamente;
5. duas execuções concorrentes resultam em uma execução + uma `skipped`;
6. falha numa rodada não derruba scheduler;
7. próxima rodada continua possível após falha;
8. Supervisor existente é realmente reutilizado;
9. scheduler não cria diretamente Proposal;
10. scheduler não cria Action Plan;
11. scheduler não executa Planner;
12. scheduler não executa Executor;
13. scheduler não altera FollowUp terminal;
14. deduplicação existente continua funcionando entre rodadas;
15. Control Center reflete Escalation/FollowUp criados pelo ciclo normal;
16. nenhum usuário ganha permissions durante a execução;
17. autonomia global não é elevada;
18. scheduler desligado não altera banco;
19. `scheduler.skipped` é auditável/logado conforme arquitetura escolhida;
20. `scheduler.failed` é auditável/logado;
21. Action Plans independentes continuam funcionando;
22. Jobs existentes continuam funcionando;
23. Director flows existentes continuam funcionando;
24. boot da aplicação continua possível com scheduler desabilitado;
25. shutdown encerra o timer quando aplicável.

Não mockar o domínio inteiro para fazer os testes passarem.

Testar integração real quando possível.

---

# 22. BASELINE

Usar como baseline oficial da rodada:

```text
Backend: 712 testes
Frontend: 119 testes
```

Ao final:

```text
baseline
+ testes novos
= total medido
```

A reconciliação deve ser exata.

Se divergir, investigar.

Não apenas atualizar o número no relatório.

---

# 23. MIGRATIONS

Não criar migration por padrão.

Esta versão provavelmente pode reutilizar Settings existente.

Se uma migration realmente for necessária:

1. justificar tecnicamente;
2. gerar migration nova;
3. nunca editar migration antiga;
4. listar exatamente alterações;
5. aplicar e validar no banco real de desenvolvimento.

---

# 24. VERIFICAÇÃO FINAL

Executar, nesta ordem:

1. testes focados da nova supervisão;
2. testes do Operational Supervisor;
3. testes de Operations/Control Center;
4. testes de FollowUps/Escalations relacionados;
5. Jobs;
6. Director flows relevantes;
7. suíte completa backend;
8. suíte completa frontend;
9. backend typecheck;
10. frontend typecheck;
11. frontend lint;
12. backend build;
13. frontend build.

Se surgir falha:

classificar claramente como:

```text
bug de produção
bug introduzido nesta rodada
falha do próprio teste
resíduo de ambiente
problema de infraestrutura
```

Não mascarar falha.

---

# 25. DEPLOY

NÃO fazer commit.

Após aprovação do Diretor/CEO será feito o commit.

Também NÃO assumir que os containers usam automaticamente o working tree.

No relatório informe explicitamente:

```text
código testado no working tree
containers atuais estão ou não atualizados
rebuild necessário: sim/não
```

O rebuild/deploy real será realizado somente depois da aprovação, salvo instrução expressa em contrário.

---

# 26. RELATÓRIO FINAL

Entregar obrigatoriamente:

1. resumo;
2. arquitetura encontrada;
3. scheduler/recurso existente reutilizado;
4. lifecycle implementado;
5. configurações de ambiente;
6. controle persistido;
7. concorrência;
8. fail-safe;
9. auditoria;
10. relação com Operational Supervisor;
11. relação com FollowUps;
12. confirmação de ausência de Proposal automática;
13. confirmação de ausência de Action Plan automático;
14. Control Center;
15. permissions;
16. migrations;
17. arquivos criados;
18. arquivos alterados;
19. testes adicionados;
20. números exatos das suítes;
21. reconciliação do baseline;
22. typecheck/lint/build;
23. bugs encontrados;
24. limitações reais;
25. débitos técnicos;
26. decisões interpretativas;
27. `git diff --stat`;
28. `git status`;
29. estado real dos containers/deploy;
30. confirmação explícita de que nenhum Planner/Policy/Executor/Approval/Scheduler paralelo foi criado.

---

# 27. CRITÉRIO FINAL DE APROVAÇÃO

A v3.1 somente será aprovada se for possível afirmar:

> O sistema consegue executar periodicamente sua supervisão operacional existente sem intervenção humana, detectar situações que precisam de acompanhamento e materializá-las pelas estruturas já governadas de Escalation e FollowUp, mas o scheduler não recebe qualquer poder adicional para propor, autorizar ou executar ações.

E também:

> Automatizamos a observação e o acompanhamento operacional — não a autoridade.

Não fazer commit.

Ao terminar, entregar o relatório completo para revisão do Diretor/CEO.
