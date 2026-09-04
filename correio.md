# Agentes v3.3 — Distributed Operational Supervision Locking

## Contexto

A v3.2 foi aprovada, testada e commitada.

Ela introduziu isolamento por incidente dentro do `Operational Supervisor`, garantindo que uma falha individual em `applyResponse` não interrompa os demais incidentes do mesmo scan.

A limitação arquitetural explicitamente mantida na v3.2 foi:

> A guarda de concorrência do Operational Supervisor ainda é local ao processo e não distribuída.

Enquanto existir apenas uma instância do backend, essa proteção é suficiente. Porém, em produção/horizontal scaling, dois ou mais processos podem executar simultaneamente o mesmo ciclo de supervisão.

A v3.3 deve resolver exclusivamente esse problema.

---

# Objetivo da v3.3

Implementar **exclusão mútua distribuída para a execução do Operational Supervisor**, de forma que, independentemente do número de processos/containers/backend instances:

```text
para um mesmo domínio global de supervisão
→ no máximo uma execução de Operational Supervision pode estar ativa
→ por vez
```

A solução deve funcionar tanto para:

* execução acionada pelo scheduler;
* execução manual via API;
* múltiplas instâncias do backend;
* múltiplos processos concorrentes.

A implementação deve continuar usando exatamente o pipeline existente:

```text
Scheduler / Manual Trigger
        ↓
runGuardedOperationalSupervision
        ↓
runOperationalSupervision
        ↓
collectOperationalSignals
        ↓
incidents
        ↓
responses
        ↓
escalations / follow-ups
```

Não criar um segundo Supervisor.

Não criar outro scheduler.

Não criar outro pipeline.

Não duplicar lógica operacional.

---

# 1. Estratégia preferencial

A preferência arquitetural desta rodada é usar **PostgreSQL advisory lock**, porque:

* PostgreSQL já é infraestrutura obrigatória do sistema;
* evita introduzir Redis lock ou outro mecanismo distribuído apenas para este caso;
* advisory locks são adequados para exclusão mútua entre processos conectados ao mesmo PostgreSQL;
* não exige migration;
* pode ser liberado automaticamente quando a conexão encerra;
* mantém a solução simples e auditável.

Avaliar a implementação correta antes de codificar.

Preferência:

```sql
pg_try_advisory_lock(...)
```

ou equivalente compatível com o driver/pool utilizado pelo projeto.

A aquisição deve ser **não bloqueante**.

Não queremos uma segunda execução esperando indefinidamente a primeira terminar.

Comportamento esperado:

```text
Processo A:
acquire lock → sucesso
executa supervisor
release lock

Processo B durante a execução:
acquire lock → false
não executa supervisor
retorna estado "skipped/already_running"
```

---

# 2. ATENÇÃO — conexão do advisory lock

Este ponto é crítico.

PostgreSQL advisory locks de sessão pertencem à **conexão**, não ao pool abstrato.

Portanto NÃO implementar algo como:

```text
pool.query(pg_try_advisory_lock)
...
pool.query(pg_advisory_unlock)
```

se essas chamadas puderem utilizar conexões diferentes.

A aquisição, execução supervisionada e liberação precisam usar corretamente uma conexão dedicada/pinned ao lifecycle do lock.

Fluxo conceitual:

```text
obter conexão dedicada
        ↓
pg_try_advisory_lock
        ↓
se false:
    liberar conexão ao pool
    retornar skipped
        ↓
se true:
    executar supervisor
        ↓
finally:
    pg_advisory_unlock
    liberar conexão
```

Verificar como isso deve ser feito com a infraestrutura atual do projeto e o driver PostgreSQL utilizado.

Não presumir.

---

# 3. Chave do lock

Criar uma chave estável e determinística especificamente para:

```text
agents.operational-supervision
```

Não usar valor aleatório.

Não usar timestamp.

Não gerar nova chave por execução.

Pode utilizar:

* um bigint constante documentado;
* duas chaves integer;
* ou hashing determinístico apropriado.

A escolha deve ser simples, explícita e testável.

Evitar magic number sem explicação.

Se houver helper para isso, mantê-lo restrito ao módulo de operations/supervision.

---

# 4. Guard atual

Antes de alterar, inspecionar:

```text
backend/src/agents/operations/supervisor-guard.ts
```

e todos os seus call sites.

A v3.3 deve **evoluir o guard existente**, não criar outro mecanismo concorrente.

Se atualmente existir algo semelhante a:

```ts
let running = false
```

a proteção local pode:

### Opção preferencial

continuar existindo como fast-path local, acrescida do lock distribuído:

```text
local guard
    +
PostgreSQL advisory lock
```

Nesse caso:

* local guard evita chamadas desnecessárias ao banco no mesmo processo;
* advisory lock fornece proteção cross-process.

OU, se a análise mostrar que manter ambos cria complexidade ou inconsistência desnecessária, o guard pode ser racionalizado.

Mas a decisão precisa ser documentada.

Nunca deixar duas fontes de verdade conflitantes.

---

# 5. Semântica da execução concorrente

Quando outra execução já estiver ativa, isso NÃO é erro.

É um estado operacional esperado.

Não retornar HTTP 500.

Não lançar exceção estrutural.

Não criar incidente.

Não criar escalation.

Não criar follow-up.

Não executar `runOperationalSupervision`.

Deve resultar em algo semanticamente equivalente a:

```ts
{
  executed: false,
  reason: 'already_running'
}
```

ou utilizar o contrato equivalente já existente no `supervisor-guard`.

Evitar criar um contrato paralelo se já houver representação de skipped/running.

---

# 6. Scheduler

O scheduler deve continuar usando:

```text
runGuardedOperationalSupervision
```

Não acessar advisory lock diretamente.

Não criar lógica especial no scheduler.

Se duas instâncias de backend tiverem scheduler ativo simultaneamente:

```text
Backend A scheduler ─┐
                     ├─ distributed guard → somente um executa
Backend B scheduler ─┘
```

Isso é o principal cenário que deve ser provado.

---

# 7. Execução manual

A execução manual deve passar pela MESMA guarda.

Não permitir que:

```text
scheduler executando
+
manual trigger
```

cause duas supervisões simultâneas.

Igualmente:

```text
manual A
+
manual B
```

de processos diferentes deve executar apenas uma.

Nenhum branch especial para scheduler/manual.

---

# 8. Liberação obrigatória

O advisory lock deve ser liberado em `finally`.

Cobrir obrigatoriamente:

```text
sucesso
falha individual
falha estrutural
throw inesperado
```

Exemplo conceitual:

```ts
try {
  ...
  return await runOperationalSupervision(...)
} finally {
  await releaseLock(...)
}
```

O lock jamais pode permanecer retido por erro normal da aplicação.

Além disso, confirmar/documentar a propriedade do PostgreSQL de liberar lock de sessão se a conexão morrer.

Não depender dessa propriedade como fluxo normal; é apenas proteção adicional.

---

# 9. Falha ao adquirir/verificar lock por infraestrutura

Separar:

### Lock ocupado

```text
pg_try_advisory_lock → false
```

Resultado:

```text
already_running
```

Isso NÃO é erro.

### Banco indisponível / query falhou

Resultado:

```text
erro estrutural
```

Deve propagar conforme os boundaries existentes.

Nunca transformar indisponibilidade do banco em:

```text
already_running
```

ou sucesso.

---

# 10. Falha ao liberar o lock

Avaliar cuidadosamente.

O `finally` deve tentar liberar explicitamente.

Uma falha de `pg_advisory_unlock` não pode ser silenciosamente confundida com sucesso completo.

Ao mesmo tempo, evitar mascarar uma exceção estrutural original com outra exceção secundária de cleanup sem análise.

Implementar comportamento robusto e documentar a decisão.

Considerar que a conexão dedicada será devolvida/encerrada segundo as garantias do driver/pool.

Não inventar mecanismo complexo de recuperação nesta versão.

---

# 11. Timeout

NÃO criar lock blocking com timeout.

Preferimos:

```text
try lock
```

e saída imediata se ocupado.

Não usar:

```text
pg_advisory_lock
```

bloqueante esperando outra execução terminar, salvo se houver razão técnica extremamente forte e documentada — o que não é esperado.

---

# 12. Redis

Não introduzir Redis distributed lock nesta versão se PostgreSQL advisory lock resolver adequadamente.

Não adicionar:

* Redlock;
* SET NX;
* TTL;
* heartbeat;
* lease renew;
* lock service genérico.

Isso seria complexidade desnecessária neste momento.

---

# 13. Migration

A expectativa é:

```text
ZERO migrations
```

Advisory locks não exigem schema.

Se surgir necessidade de migration, PARAR e relatar antes de implementar, porque provavelmente houve expansão indevida do escopo.

---

# 14. Auditoria

Avaliar se o sistema atual já audita scans iniciados/skipped.

Não criar spam de audit para cada tick do scheduler.

Apenas adicionar evento se houver valor operacional real e alinhamento ao padrão existente.

Se adicionar evento para lock ocupado, utilizar namespace existente:

```text
agents.operations.*
```

Exemplo possível:

```text
agents.operations.supervision.skipped
```

Mas somente se fizer sentido no padrão atual.

Não considerar auditoria adicional requisito obrigatório caso ela não agregue valor ou cause volume excessivo.

Documentar a decisão.

---

# 15. Observabilidade

O estado "already running" deve continuar distinguível de:

```text
executado com sucesso
executado com falhas parciais
falha estrutural
```

Não misturar:

```text
failed > 0
```

da v3.2 com concorrência.

`failed` continua representando incidentes cuja resposta falhou durante um scan QUE EFETIVAMENTE EXECUTOU.

Um scan não iniciado por lock ocupado não deve produzir:

```text
failed: 1
```

nem um fake `OperationalSupervisionReport`.

---

# 16. Control Center

Não criar nova tela.

Avaliar apenas se algum contrato consumido pelo Control Center depende do retorno do guard.

Se não depender, não tocar.

Não adicionar indicadores, cards ou dashboards só por causa desta versão.

Mudança frontend deve ser ZERO salvo necessidade contratual real comprovada.

---

# 17. Permissions

Nenhuma permission nova.

Continuam:

```text
agents.operations.read
agents.operations.manage
```

A execução manual continua respeitando a authorization já existente.

O lock não é mecanismo de autorização.

---

# 18. Segurança

A solução deve obedecer aos princípios permanentes do projeto:

* menor privilégio;
* autorização server-side;
* nenhuma credencial exposta;
* nenhuma entrada do usuário controlando arbitrariamente a chave do advisory lock;
* nenhuma SQL injection na criação da chave;
* nenhum LLM decidindo locking;
* nenhuma dependência de frontend para segurança;
* nenhuma informação sensível em logs.

A chave do lock deve ser controlada pelo código.

---

# 19. Testes mínimos obrigatórios

Adicionar testes específicos da v3.3.

No mínimo provar:

### 1.

Primeira execução adquire o lock e executa `runOperationalSupervision`.

### 2.

Segunda execução concorrente não executa `runOperationalSupervision`.

### 3.

Segunda execução retorna estado equivalente a:

```text
already_running
```

sem erro.

### 4.

Após a primeira execução terminar, uma nova execução consegue adquirir o lock.

### 5.

Lock é liberado após sucesso.

### 6.

Lock é liberado após falha estrutural de `runOperationalSupervision`.

### 7.

Uma exceção dentro da supervisão não deixa o sistema permanentemente bloqueado.

### 8.

Falha de infraestrutura ao tentar adquirir lock propaga como erro estrutural.

### 9.

`false` de `pg_try_advisory_lock` NÃO é tratado como erro de banco.

### 10.

Scheduler usa o mesmo distributed guard.

### 11.

Execução manual usa o mesmo distributed guard.

### 12.

Scheduler + manual concorrentes resultam em apenas uma execução.

### 13.

Duas chamadas simulando processos distintos resultam em apenas uma execução.

IMPORTANTE:

Um teste que apenas chama duas Promises no mesmo módulo com uma variável global local NÃO prova locking distribuído.

A prova deve exercitar de fato o boundary de PostgreSQL ou uma abstração cujo comportamento cross-connection esteja adequadamente testado.

---

# 20. Teste de integração real PostgreSQL

Esta versão exige pelo menos um teste real contra PostgreSQL provando:

```text
connection A → pg_try_advisory_lock → true
connection B → pg_try_advisory_lock → false

connection A → unlock

connection B → pg_try_advisory_lock → true
```

Isso é fundamental.

Queremos provar a propriedade que motivou a versão.

Não aceitar somente mocks.

Pode haver unit tests adicionais com mocks, mas deve existir cobertura real do lock distribuído.

---

# 21. Conexões diferentes

O teste de integração precisa confirmar explicitamente que A e B são **sessões/conexões diferentes**.

Caso contrário, não prova exclusão cross-process.

Registrar isso no relatório.

---

# 22. Interação com a v3.2

Executar testes comprovando que o novo distributed guard não altera a semântica da v3.2.

Especialmente:

```text
scan adquiriu lock
↓
incidente A falha isoladamente
↓
incidente B continua
↓
scan completa
↓
lock é liberado
↓
novo scan pode executar
```

Não permitir regressão do isolamento por incidente.

---

# 23. Escalations / FollowUps

Nenhuma mudança de comportamento.

Uma supervisão que efetivamente executa continua podendo:

* detectar incidentes;
* aplicar respostas;
* gerar Escalations;
* gerar FollowUps.

Uma execução skipped por `already_running` não deve criar nenhum desses objetos.

---

# 24. Proposal / Action Plan / Planner / Executor

Não adicionar chamadas automáticas a:

```text
createActionProposal
submitActionProposal
planEvaluateAndPersistActionPlan
executeActionPlan
Planner
Policy Evaluator
Executor
Approval Workflow
```

Essa versão é somente locking/resilience.

Confirmar por inspeção/grep no relatório final se apropriado.

---

# 25. Jobs

Não mudar:

* Jobs;
* Runs;
* schedules de Jobs;
* autonomy;
* delegation;
* budgets;
* Event Engine.

Operational Supervisor continua sendo apenas consumidor/observador e executor de respostas já previstas pela arquitetura atual.

---

# 26. Scheduler global

Não implementar eleição de líder global.

Não criar:

```text
leader election
scheduler leader
cluster coordinator
distributed scheduler service
```

O advisory lock do ciclo de supervisão é suficiente para esta versão.

Ter schedulers concorrentes disparando ticks é aceitável desde que apenas um consiga executar o scan.

Leader election pode ser avaliada futuramente se houver motivo real.

---

# 27. Lock genérico

Evitar criar framework genérico de distributed locking se só há um consumidor real.

Preferir algo pequeno e explícito, por exemplo dentro de:

```text
agents/operations/
```

Se criar helper, ele deve ser simples o suficiente para não antecipar abstrações sem demanda.

Não construir "DistributedLockManager v1".

---

# 28. Arquitetura esperada

Algo conceitualmente próximo de:

```text
runGuardedOperationalSupervision
        │
        ├─ local in-process guard (se mantido)
        │
        └─ PostgreSQL advisory try-lock
                    │
              ┌─────┴─────┐
              │           │
            false        true
              │           │
        already_running   runOperationalSupervision
                          │
                          └─ finally → unlock
```

É apenas referência conceitual.

Adaptar à arquitetura real do repositório.

---

# 29. Arquivos

Esperamos alterações pequenas e concentradas.

Prováveis arquivos:

```text
backend/src/agents/operations/supervisor-guard.ts
backend/src/agents/operations/supervisor-guard.test.ts
```

Talvez um helper pequeno no mesmo domínio caso realmente necessário.

Pode haver ajustes de tipos/testes existentes.

Evitar tocar frontend se não houver necessidade.

Nenhuma migration esperada.

Não criar arquivos fora do módulo relacionado sem justificativa concreta.

---

# 30. Testes completos

Depois dos testes específicos da v3.3, rodar toda a suíte.

Baseline atual aprovado:

```text
Backend:
tests 721
pass 721
fail 0
suites 123

Frontend:
tests 119
pass 119
fail 0
suites 47
```

Relatar números finais EXATOS.

Se novos testes forem adicionados:

```text
721 + N = novo total esperado
```

Reconciliar matematicamente o baseline com o total observado.

Não dizer apenas "todos passaram".

---

# 31. Validações obrigatórias

Rodar:

```text
backend tests
frontend tests
backend typecheck
frontend typecheck
frontend lint
backend build
frontend build
```

Se existir lint backend configurado, rodá-lo também.

Relatar separadamente:

```text
tests
typecheck
lint
build
```

com resultado real.

---

# 32. Containers

Nesta rodada:

**NÃO fazer deploy/rebuild automaticamente antes da aprovação.**

Depois de implementar e testar, relatar claramente:

```text
working tree contém v3.3
containers atuais ainda executam versão anterior
```

se esse for o estado.

Não presumir que containers refletem o working tree.

---

# 33. Commit

**NÃO FAZER COMMIT.**

Ao terminar:

* deixar alterações no working tree;
* apresentar relatório completo;
* aguardar aprovação do Diretor/CEO.

---

# 34. Não alterar correio.md para esconder instruções

O `correio.md` pode ser atualizado/substituído conforme o fluxo operacional adotado no projeto, mas não deve ser contabilizado artificialmente como mudança funcional da v3.3.

No relatório, separar claramente:

```text
arquivos funcionais
testes
documentação/instrução operacional
```

---

# 35. Relatório final obrigatório

Entregar relatório contendo pelo menos:

## 1. Resumo

O que foi implementado.

## 2. Limitação anterior

Explicar por que a guarda local não protegia múltiplos processos.

## 3. Estratégia adotada

Explicar PostgreSQL advisory lock e por que foi escolhido.

## 4. Lifecycle da conexão

Detalhar como garantiu que acquire/unlock ocorreram na mesma sessão PostgreSQL.

## 5. Chave do lock

Qual chave foi usada e como é determinística.

## 6. Guard local

Dizer se foi preservado ou removido e por quê.

## 7. Lock ocupado

Contrato/retorno exato.

## 8. Falha de banco

Mostrar diferença entre lock ocupado e falha estrutural.

## 9. Release

Explicar `finally` e comportamento em exceções.

## 10. Scheduler

Confirmar que continua no mesmo pipeline.

## 11. Manual

Confirmar que utiliza o mesmo guard.

## 12. Cross-process

Descrever o teste real com duas conexões PostgreSQL.

## 13. Interação com v3.2

Confirmar isolamento por incidente + liberação posterior do lock.

## 14. Escalations/FollowUps

Confirmar comportamento inalterado.

## 15. Proposal/Action Plan

Confirmar que nenhum mecanismo automático foi introduzido.

## 16. Permissions

Confirmar que nenhuma nova permission foi criada.

## 17. Migrations

Esperado: zero.

## 18. Arquivos criados/alterados

Lista exata.

## 19. Testes adicionados

Quantidade e finalidade.

## 20. Números das suítes

Exatos.

## 21. Reconciliação do baseline

```text
721 + novos testes = total backend
119 + novos testes frontend = total frontend
```

## 22. Typecheck/lint/build

Resultados.

## 23. Bugs encontrados

Relatar qualquer um, mesmo corrigido.

## 24. Limitações reais

Somente limitações que permanecerem de fato.

## 25. Débitos técnicos

Somente reais.

## 26. Decisões interpretativas

Tudo que precisou ser decidido sem instrução literal.

## 27. git diff --stat

Completo.

## 28. git status

Completo.

## 29. Containers/deploy

Estado verdadeiro.

## 30. Confirmação final

Declarar explicitamente:

```text
nenhum segundo Supervisor foi criado
nenhum segundo scheduler foi criado
nenhum mecanismo de leader election foi criado
nenhum lock Redis/Redlock foi criado
nenhum Proposal/Action Plan automático foi criado
nenhum commit foi realizado
```

---

# Critério de aprovação da v3.3

A versão só estará pronta para aprovação quando estiver demonstrado que:

```text
Backend A ─┐
           ├─ tenta executar Operational Supervisor
Backend B ─┘

↓ PostgreSQL advisory lock

exatamente um executa
o outro recebe already_running

↓

execução termina ou falha

↓

lock é liberado

↓

uma nova execução consegue iniciar
```

E isso precisa ser comprovado com **sessões PostgreSQL distintas**, não apenas por variável local ou mock.

---

# Restrições finais

Não expandir esta rodada para:

* distributed scheduler;
* leader election;
* Redis locks;
* generic lock framework;
* retries;
* circuit breaker novo;
* novas telas;
* novos workflows;
* novos agentes;
* novas permissions;
* alterações de Jobs;
* alterações de Event Engine;
* Action Plans automáticos;
* Proposals automáticos;
* mudanças de Escalation lifecycle;
* mudanças de FollowUp lifecycle.

A v3.3 deve ser uma evolução pequena, segura e comprovável:

> substituir a garantia "uma supervisão por processo" pela garantia "uma supervisão por sistema/cluster", sem alterar o comportamento funcional do Operational Supervisor.

Execute, teste completamente, **não faça commit** e devolva o relatório para revisão do Diretor/CEO.
