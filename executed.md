# Executado — Saneamento técnico pós-v3.4

Escopo estritamente limitado: correção das 2 falhas pré-existentes
identificadas no fechamento da v3.4. Nenhuma funcionalidade nova, nenhuma
alteração em `supervisor-guard.ts`, nenhuma migration, nenhum
rebuild/deploy, nenhum commit.

## 1. Causa raiz — ambas as falhas têm a mesma origem

As duas falhas eram sintomas do **mesmo problema de isolamento de teste**,
não bugs de implementação: `AGENT_LLM_ENABLED` é um flag com default
`false` (`config/env.ts`), documentado como "com AGENT_LLM_ENABLED=false
(default), nenhuma chamada de LLM acontece". Todo teste do projeto que
depende desse comportamento determinístico — exceto estes dois — isola
explicitamente essa dependência mutando `process.env.AGENT_LLM_ENABLED`
diretamente (confirmado: `job-runner.autonomy.test.ts`, `jobs.test.ts`,
`action-plans.test.ts`, entre outros 15 arquivos). Estes dois arquivos
nunca fizeram isso — confiavam implicitamente no default do processo.

O `.env` real usado para rodar a suíte neste ambiente tem
`AGENT_LLM_ENABLED=true` com `AGENT_LLM_PROVIDER=openai` e uma
`OPENAI_API_KEY` real configurada (necessário para outras funcionalidades
do sistema em produção). Isso nunca foi um problema para os ~720 outros
testes porque cada um isola sua própria dependência — só estes dois não
isolavam, e por isso "vazavam" o estado real do ambiente:

- **`job-runs.test.ts:112`** — o comentário original já dizia
  "Run manual sem LLM: falha determinística llm_unavailable" — mas com
  `AGENT_LLM_ENABLED=true` real, `create-action-plan.ts` chamava a API da
  OpenAI de verdade, criando um Action Plan real (texto do `summary`
  gerado pelo modelo, por isso diferente a cada execução) em vez de falhar
  com `llm_unavailable` como o teste esperava.
- **`settings.test.ts:386`** — o comentário original dizia "Com
  AGENT_LLM_ENABLED desligado (default do describe)" — mesma causa: com o
  LLM real ativo, o Run de teste terminava `'completed'` em vez de
  `'failed'`, então o circuit breaker nunca via uma falha e nunca abria.

**Não é um bug em `circuit.ts`, `create-action-plan.ts` ou no propagador de
overrides de settings** — todos os três se comportam exatamente como
desenhado. `circuit.failureThreshold=1` de fato abre o circuito na 1ª
falha real (confirmado com o LLM isolado); `planEvaluateAndPersistActionPlan`
de fato retorna `llm_unavailable` quando `AGENT_LLM_ENABLED=false`
(confirmado). O bug real era exclusivamente a ausência de isolamento nos
dois arquivos de teste.

## 2. Correção aplicada

Em ambos os arquivos, mesma técnica já estabelecida no projeto: capturar
`process.env.AGENT_LLM_ENABLED` antes, forçar `'false'`, e restaurar o
valor original depois (nunca um `delete` cego — preserva o valor prévio
exato, seja ele `undefined` ou qualquer string).

- **`job-runs.test.ts`**: o override foi movido para o `before()`/`after()`
  do describe inteiro — nenhum teste deste arquivo jamais precisa do LLM
  ligado, então isolar uma vez para todo o arquivo é suficiente e mais
  simples que repetir por teste.
- **`settings.test.ts`**: o override foi aplicado só dentro do único
  teste afetado (`'Integracao real de runtime'`), envolvido em
  `try/finally` — os outros testes do arquivo não usam `runAgentJob` e não
  precisam de isolamento. Como bônus, a limpeza do override GLOBAL de
  `circuit.failureThreshold` (já existente, crítica para não vazar entre
  arquivos) foi movida para dentro do `finally`, então agora roda mesmo se
  uma assertion falhar no meio do teste — mais robusto que antes, sem
  mudar o que é testado.

Nenhuma assertion foi relaxada; nenhuma chamada real de LLM foi introduzida
(pelo contrário — as que aconteciam de forma acidental foram eliminadas);
nenhum segundo mecanismo de Circuit Breaker foi criado; nenhum bypass
específico de teste foi adicionado ao código de produção (a mudança é
100% dentro dos arquivos `.test.ts`).

## 3. Por que a correção não mascara regressões

- O comportamento real de `create-action-plan.ts` e `circuit.ts` **não foi
  tocado** — só os dois arquivos de teste. Se algum dia esses módulos
  regredirem, os testes continuam sensíveis a isso: o teste de
  `settings.test.ts` ainda EXIGE `circuitState === 'open'` e
  `circuitFailureCount === 1` após uma falha real; o de `job-runs.test.ts`
  ainda EXIGE `actionPlan === null` após uma falha real de LLM. Nenhuma
  assertion foi enfraquecida ou removida.
- O isolamento de `AGENT_LLM_ENABLED` não esconde nenhum comportamento —
  só garante que o teste testa exatamente o cenário que seu próprio nome e
  comentário sempre disseram testar ("sem LLM"/"LLM desligado"), em vez de
  depender de um acidente de configuração do ambiente.
- Rodado o arquivo isoladamente **7 vezes** (2 interativas + 5 em loop),
  todas 16/16 passando, sem nenhuma variação — prova de determinismo real,
  não sorte.

## 4. Validação obrigatória

| Item | Resultado |
|---|---|
| `npx tsc --noEmit` | limpo |
| Testes isolados repetidos (7x, `job-runs.test.ts` + `settings.test.ts` juntos) | **16/16 em todas as 7 execuções**, 0 falhas |
| Suíte completa do backend (`--test-concurrency=1`) | **738/738** — meta batida exatamente |
| `git diff --check` | limpo |
| Migrations criadas | **nenhuma** |
| `supervisor-guard.ts` | `git diff` vazio — confirmado sem nenhuma alteração |
| Containers permanentes | nenhum rebuild/deploy |

## 5. `git status`

```
 M backend/src/routes/agents/job-runs.test.ts
 M backend/src/routes/agents/settings.test.ts
 M correio.md
```

(`correio.md` reflete só a reescrita externa do próprio correio pelo
Diretor/CEO — nenhuma edição minha.)

## 6. `git diff --stat`

```
 backend/src/routes/agents/job-runs.test.ts | 26 ++++++++++
 backend/src/routes/agents/settings.test.ts | 80 ++++++++++++++++++++----------
 2 files changed, 80 insertions(+), 26 deletions(-)
```

## 7. Confirmação final

**Nenhum commit foi feito.** Nenhum container foi reconstruído ou
reiniciado. Nenhuma funcionalidade da v3.4 foi alterada. Nenhuma nova
versão funcional dos Agentes foi iniciada. Relatório pronto para
aprovação.
