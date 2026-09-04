## Agentes v3.2 — Operational Supervision Resilience & Incident Isolation

### 1. Resumo

Corrigido o único ponto real de acoplamento entre incidentes que restava
no Operational Supervisor: `applyResponse` (a resposta operacional em si)
não tinha boundary de erro própria — uma exceção nela abortava o
restante dos incidentes daquele scan. `escalateSupervisorFinding` já
tinha esse isolamento desde a v2.6. Corrigido, testado (8 testes novos,
713→721), suíte completa 100% verde, nenhum mecanismo paralelo criado.

### 2. Causa exata da limitação

Em `supervisor-service.ts`, o `for` de `runOperationalSupervision`
chamava `await applyResponse(...)` direto, sem `try/catch` — uma exceção
ali (`applySafeRecovery`/`restrictJobAutonomy`/`escalateIncidentToManualAttention`
falhando por infra momentaneamente indisponível, por exemplo) propagava
para fora do `for`, abortando os incidentes SEGUINTES daquele scan. O
próximo scan continuava normal; só os incidentes restantes DAQUELE ciclo
eram perdidos.

### 3. Solução adotada

Nova função `applyResponseIsolated` envolve `applyResponse` num
`try/catch` — mesmo boundary por incidente que `escalateSupervisorFinding`
já tinha. Em caso de exceção: audita `agents.operations.incident.failed`
(novo evento, mesmo domínio `agents.operations.*` já existente) com
`incidentType`/`severity`/`attemptedResponse`/`message` (nunca stack
trace), devolve um `OperationalIncidentResult` com `outcome: 'failed'`
(nunca lança, nunca finge sucesso), e o `for` continua para o próximo
incidente. `OperationalSupervisionReport` ganhou o campo aditivo
`failed: number` — contrato existente preservado, nada quebrado.

### 4. Boundary de isolamento

Por incidente, dentro do `for` — não por scan inteiro, não uma
transaction global. Efeitos já confirmados antes da exceção (o audit de
`incident.detected`, sempre gravado ANTES do `switch` que pode falhar)
permanecem — nunca rollback.

### 5/6. Falha individual vs. estrutural

Falha individual (`applyResponse` de UM incidente lança): capturada,
auditada, `outcome: 'failed'`, scan continua e chega a `completed`
normalmente. Falha estrutural (ex.: `collectOperationalSignals` não
consegue ler o banco): continua propagando como exceção de
`runOperationalSupervision` inteira, capturada só no boundary já
existente (`scheduler.ts`/rota HTTP manual) — nunca mascarada como
sucesso parcial. As duas situações permanecem distintas, como pedido.

### 7. Scheduler / 8. Concorrência

Nenhuma mudança — `scheduler.ts`/`supervisor-guard.ts` intocados, ambos
continuam chamando exatamente `runGuardedOperationalSupervision` →
`runOperationalSupervision`. Isolamento vale igualmente para
`triggeredBy: 'manual'` e `'scheduler'` (mesma função, sem branch —
provado por teste).

### 9. Escalations / 10. FollowUps

Intocados — `escalateSupervisorFinding` já rodava (e continua rodando)
em seu próprio `try/catch`, chamado incondicionalmente após
`results.push(result)`, mesmo quando `outcome === 'failed'`. Provado por
teste: um incidente com sucesso continua gerando Escalation/FollowUp
reais mesmo quando outro incidente do MESMO scan falhou isoladamente.
Nenhuma mudança de lifecycle de FollowUp.

### 11/12. Proposal e Action Plan automáticos

Confirmado por `grep`: nenhuma chamada a `createActionProposal`/
`submitActionProposal`/`planEvaluateAndPersistActionPlan`/`executeActionPlan`
em `agents/operations/`. Nenhuma foi adicionada nesta rodada.

### 13. Control Center

Nenhuma tela nova. Teste novo confirma: depois de um scan parcialmente
falho, a Escalation/FollowUp do incidente que teve sucesso continuam
aparecendo normalmente no Control Center (overview e filas).

### 14. Permissions

Nenhuma nova — `agents.operations.read`/`agents.operations.manage`
inalteradas.

### 15. Migrations

Nenhuma.

### 16/17. Arquivos criados/alterados

Nenhum arquivo criado. Alterados:
`backend/src/agents/operations/supervisor-service.ts` (a correção),
`backend/src/agents/operations/health-types.ts` (`outcome: 'failed'` +
`failed: number`, aditivo), `frontend/types/agents.ts` (mesmo campo,
aditivo), `frontend/components/agents/operations/operations-supervisor-dashboard.tsx`
(toast distingue sucesso pleno de falha parcial) — e os testes:
`supervisor-service.test.ts` (+8, describe novo "v3.2 — isolamento por
incidente"), `control-center-service.test.ts` (+1), mais `failed: 0`
adicionado a 3 mocks de report já existentes (`scheduler.test.ts`,
`scheduler-status.test.ts`, `supervisor-guard.test.ts`) só para
continuarem compilando contra o tipo estendido.

### 18. Testes adicionados (8 novos)

Cobrem os itens 1-10, 19-20 e 23 da lista mínima do correio.md
diretamente (3 incidentes válidos processados; meio/primeiro/último
falham isoladamente; múltiplas falhas independentes; auditoria com
contexto e sem stack trace; scan chega a completed com falha parcial;
summary distingue `failed`; Escalation antes/depois de uma falha
continua sendo criada; isolamento idêntico manual vs. scheduler; Control
Center coerente após scan parcial). Itens 11-18/21/22/24-26 não exigiram
teste novo: comportamento inalterado (dedup, FollowUp lifecycle,
ausência de Proposal/Action Plan/Planner/Executor, permissions) ou já
coberto por suítes existentes (falha estrutural isolada no scheduler:
`scheduler.test.ts` item 8/9/28, já existente; Jobs/Director/Action
Plans: suíte completa).

**Achado durante a escrita dos testes** (não um bug de produção): as
primeiras versões de 3 testes falharam porque reusavam os mesmos Jobs
fixture entre iterações/testes sem limpar imediatamente — um Job
realmente restringido por uma iteração mudava o contexto
(`jobAutonomyEnabled`) da iteração seguinte, fazendo `restrict_autonomy`
virar `manual_attention` inesperadamente. Corrigido limpando cada fixture
imediatamente após uso, em vez de só no `after()` final do arquivo.

### 19. Números exatos das suítes

```
Backend:  tests 721 / pass 721 / fail 0 / suites 123
Frontend: tests 119 / pass 119 / fail 0 / suites 47
```

### 20. Reconciliação do baseline

713 (baseline) + 8 (testes novos) = 721 — bate exatamente com o medido.
Frontend: 119 (sem testes novos — mudança de UI é só um toast, sem
componente novo).

### 21. Typecheck/lint/build

Backend typecheck: 0 erros. Frontend typecheck: 0 erros. Frontend lint: 0
erros. Backend build: sucesso. Frontend build: sucesso.

### 22. Bugs encontrados

Nenhum de produção. Ver item 18 ("achado durante a escrita dos testes")
— bug nos meus próprios testes, corrigido antes de prosseguir.

### 23. Limitações reais

Guarda de concorrência continua de processo (não distribuída) — fora de
escopo desta versão, como o correio.md pediu explicitamente para manter.

### 24. Débitos técnicos

Nenhum novo.

### 25. Decisões interpretativas

- Nome do evento de audit: `agents.operations.incident.failed` (sugestão
  literal do correio.md), dentro do domínio `agents.operations.*` já
  existente.
- `failed` como outcome adicional (não um summary paralelo) — mantém
  `results[]` como única fonte de verdade por incidente.
- Toast do frontend usa `toast.warning` (não usado antes no projeto, mas
  já suportado pela lib `sonner` já instalada) para diferenciar "sucesso
  pleno" de "sucesso com falha parcial" — sem criar componente novo.

### 26/27. `git diff --stat` / `git status`

```
 backend/src/agents/operations/control-center-service.test.ts | +81
 backend/src/agents/operations/health-types.ts                | +17/-x
 backend/src/agents/operations/scheduler-status.test.ts       | +1
 backend/src/agents/operations/scheduler.test.ts              | +1
 backend/src/agents/operations/supervisor-guard.test.ts       | +1
 backend/src/agents/operations/supervisor-service.test.ts     | +234
 backend/src/agents/operations/supervisor-service.ts          | +98
 frontend/components/.../operations-supervisor-dashboard.tsx  | +11/-x
 frontend/types/agents.ts                                     | +3
 correio.md                                                   | (reescrito pelo Diretor/CEO)
```

Nenhum arquivo de produção fora de `agents/operations/*` (backend) e
`operations-supervisor-dashboard.tsx`/`types/agents.ts` (frontend) foi
tocado. Nenhum arquivo criado.

### 28. Estado dos containers/deploy

**Não redeployado nesta rodada** — código só testado no working tree.
Os containers atuais (`agencia-backend`/`agencia-frontend`) NÃO incluem
esta correção ainda (rodam o código de antes da v3.2). Rebuild/deploy
pendente de aprovação, conforme pedido explícito do correio.md desta
rodada ("Não faça commit" + relatar estado real sem presumir).

### 29. Confirmação — nenhum mecanismo paralelo foi criado

Confirmado por inspeção: 0 arquivos novos; nenhum segundo Supervisor,
scheduler, Planner, Policy Evaluator, Executor, Approval Workflow,
mecanismo de Escalation/FollowUp ou deduplicação. A única mudança real é
um `try/catch` a mais em volta de uma chamada já existente, seguindo o
mesmo padrão já usado 20 linhas abaixo no mesmo arquivo desde a v2.6.

---

Aguardando aprovação do Diretor/CEO. Nenhum commit foi feito nesta rodada.

