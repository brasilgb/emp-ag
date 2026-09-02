# CORREÇÃO IMEDIATA — encerrar a flakiness da v1.5

Pare de repetir a suíte.

Já foram 13 rodadas e a causa está identificada. Agora quero CORREÇÃO, não nova tentativa.

## Objetivo

Eliminar definitivamente as falhas intermitentes da suíte relacionadas a:

1. `event-processor.test.ts`
2. estado global de `settings`
3. fila compartilhada `agent_events`
4. Jobs órfãos `1546` e `1547`

Não altere a lógica funcional da v1.5 sem evidência de bug de produção.

---

# 1. Primeiro: eliminar os Jobs órfãos

Cancelar imediatamente pelos mecanismos da aplicação:

* Job 1546
* Job 1547

Confirmar:

* `status != active`
* nenhuma Event Rule antiga desses smoke tests continua habilitada
* nenhum container auxiliar de smoke test permanece rodando
* nenhum novo Run desses Jobs aparece após o cancelamento

Se o sandbox impedir novamente, documentar exatamente o comando/API que precisa ser executado externamente, mas continuar com as correções dos testes.

---

# 2. Corrigir `event-processor.test.ts`

Este é o principal problema.

A fila global `agent_events` não pode mais ser utilizada pelos testes como se fosse exclusiva.

Cada teste deve possuir e identificar explicitamente:

* seu `eventId`
* seus `ruleIds`
* seus `jobIds`
* suas `deliveryIds`
* seus `runIds`

Todas as verificações devem ser filtradas pelos IDs da própria fixture.

## Proibido nos testes

Não utilizar lógica baseada em:

* último evento global;
* primeira delivery disponível;
* quantidade global de Runs;
* fila global estar vazia;
* consumir indiscriminadamente eventos pendentes;
* esperar que outro arquivo não esteja usando o banco.

## Corrigir `drainUntil`

`drainUntil` deve esperar somente pelo evento/delivery pertencente à fixture atual.

Ele não deve considerar atividade de outros testes como progresso.

Se o Event Processor atual somente consegue consumir a fila global, crie no teste um mecanismo controlado para acompanhar exclusivamente o `eventId` criado pela fixture.

Não mudar o comportamento de produção apenas para facilitar o teste, salvo se a mudança representar melhoria arquitetural legítima.

---

# 3. Corrigir o global autonomy switch

Encontrar todos os testes que chamam:

`setAutonomousExecutionEnabled(false)`
`setAutonomousExecutionEnabled(true)`

Eles não podem competir pela mesma linha global de `settings`.

Quero isolamento real.

Ordem de preferência:

1. injeção/mock/stub da configuração global dentro dos testes;
2. fixture isolada;
3. mecanismo de exclusão mútua especificamente para os testes que alteram configuração global;
4. serialização somente desse grupo de testes, se as opções anteriores forem desproporcionalmente complexas.

Não serializar toda a suíte como primeira solução.

Garantir restauração do estado em `finally`/`afterEach`.

---

# 4. Cleanup determinístico

Cada teste deverá remover exclusivamente os artefatos que criou.

Revisar cleanup de:

* `agent_events`
* `agent_event_deliveries`
* `agent_job_runs`
* `agent_autonomy_blocks`
* Event Rules
* Jobs
* alterações temporárias de `settings`

Usar prefixo/identificador único de fixture quando ajudar.

Não executar `TRUNCATE` global durante execução concorrente da suíte.

---

# 5. Banco de teste

A suíte de integração não deve continuar utilizando o mesmo banco de desenvolvimento poluído por smoke tests e execuções anteriores.

Criar/configurar banco de teste dedicado se ainda não existir.

Exemplo conceitual:

`agencia_test`

A suíte deve:

1. apontar explicitamente para o banco de teste;
2. aplicar migrations;
3. criar fixtures;
4. executar;
5. limpar somente seus artefatos.

Não destruir o banco normal de desenvolvimento.

---

# 6. Agora corrija o código

Não quero novo relatório de diagnóstico antes da correção.

Faça as alterações necessárias nos testes/fixtures/helpers.

Depois mostre os arquivos modificados e explique resumidamente a causa corrigida.

---

# 7. Validação — limite rígido

Depois da correção:

## Rodada A — somente os arquivos problemáticos

Rodar:

* `event-processor.test.ts`
* `job-runner.autonomy.test.ts`

Resultado obrigatório: 100%.

Se falhar:

PARE.

Investigue e corrija.

Não rode de novo cegamente.

---

## Rodada B — suíte completa

Somente quando A estiver verde:

rodar backend completo UMA VEZ.

Se falhar:

PARE → investigar → corrigir.

Não iniciar segunda tentativa sem mudança concreta.

---

## Rodadas C e D — estabilidade

Quando a suíte completa passar:

rodar mais DUAS vezes.

Portanto, após a correção, máximo de:

**3 execuções completas verdes**

Isso é suficiente para comprovar que removemos a flakiness.

Não faça rodada 4, 5, 10 ou 20.

---

# 8. Gates finais

Executar uma única vez:

* backend `tsc --noEmit`
* frontend `npm test`
* frontend `next build`

Todos verdes.

---

# 9. Git

Depois:

`git status`

Separar:

* alterações reais da v1.5;
* correções de testes;
* migrations;
* arquivos temporários;
* qualquer arquivo não relacionado.

Confirmar que nenhum secret será commitado.

---

# 10. Resultado esperado

Sua próxima resposta deve conter SOMENTE:

1. `ROOT CAUSE 1` — event processor
2. `ROOT CAUSE 2` — global settings
3. `CORREÇÃO IMPLEMENTADA`
4. arquivos alterados
5. status dos Jobs `1546/1547`
6. testes isolados: X/X
7. suíte completa rodada 1: X/X
8. suíte completa rodada 2: X/X
9. suíte completa rodada 3: X/X
10. typecheck
11. frontend tests
12. frontend build
13. git status resumido
14. decisão final:

`APROVAR v1.5 PARA COMMIT`

ou

`NÃO APROVAR v1.5 PARA COMMIT`

Não faça mais análise repetitiva.

Não rode novamente esperando que o acaso faça o teste passar.

**Falhou = corrigir. Passou após correção = validar estabilidade e encerrar.**
