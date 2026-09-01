# PRIORIDADE MÁXIMA — Corrigir definitivamente a infraestrutura de testes

Pare de repetir a suíte contra o banco de desenvolvimento atual.

Não quero mais reruns, diagnósticos repetidos ou tentativas de "ver se passa".

A partir de agora, execute a correção definitiva da infraestrutura de testes.

## Objetivo

Criar um ambiente backend de testes:

* isolado;
* descartável;
* reproduzível;
* seguro;
* independente do PostgreSQL/Redis de desenvolvimento;
* capaz de executar a suíte repetidamente sem acumular estado de execuções anteriores.

A aplicação de produção/dev não deve sofrer alterações funcionais por causa disso.

---

# 1. PostgreSQL dedicado para testes

Criar PostgreSQL exclusivo para testes.

Preferência:

* container `agencia-postgres-test`;
* database `agencia_test`;
* usuário próprio de teste, se apropriado;
* volume descartável ou estratégia segura de reset.

A suíte backend deve usar explicitamente algo como:

`DATABASE_URL_TEST`

Nunca utilizar silenciosamente `DATABASE_URL` de desenvolvimento durante `npm test`.

Se `DATABASE_URL_TEST` estiver ausente:

**falhar imediatamente.**

Não fazer fallback.

---

# 2. Proteção obrigatória contra destruição do banco errado

Antes de qualquer:

* DROP;
* TRUNCATE;
* reset;
* cleanup global;
* recriação de schema;

implementar guard de segurança.

O reset só pode ocorrer se:

* `NODE_ENV === 'test'`;
* a URL utilizada for a URL explicitamente de teste;
* o nome do database for reconhecido como database de teste, por exemplo `agencia_test`.

Se qualquer condição não for satisfeita:

**abortar com erro.**

Nunca permitir que script de testes limpe automaticamente o banco `agencia` de desenvolvimento.

Adicionar teste para esse guard.

---

# 3. Redis separado

Mapear os testes que utilizam Redis.

Criar isolamento real para testes:

* Redis de teste separado; OU
* database Redis reservado exclusivamente aos testes; OU
* prefixo forte por ambiente, se comprovadamente seguro.

Preferência: ambiente dedicado.

Cleanup/flush só pode atingir Redis identificado explicitamente como teste.

Nunca executar `FLUSHALL` no Redis de desenvolvimento.

---

# 4. Ciclo determinístico da suíte

Criar um fluxo único para a suíte:

1. verificar environment safety;
2. preparar PostgreSQL de teste;
3. aplicar migrations;
4. resetar somente o banco de teste;
5. preparar fixtures básicas;
6. executar testes;
7. finalizar de maneira previsível.

Cada execução completa deve começar do mesmo estado inicial.

Não carregar resíduos da execução anterior.

---

# 5. Não depender apenas do banco limpo

Mesmo com banco dedicado, corrigir o isolamento lógico dos testes.

Cada teste deve identificar os objetos que criou.

Exemplos:

* Job;
* Event Rule;
* Event;
* Delivery;
* Run;
* Approval;
* Action Plan;
* Audit entry.

Usar IDs das próprias fixtures nas assertions.

Evitar assertions baseadas em estado global quando existe forma de consultar somente os registros relacionados ao teste.

---

# 6. Corrigir `event-processor.test.ts`

Esse arquivo é atualmente o principal sintoma da contaminação.

Revisar especialmente:

`drainUntil(...)`

e qualquer helper que processe a fila global.

Precisamos garantir que um teste não dependa de:

* fila global vazia;
* ser o único produtor;
* ser o único consumidor;
* quantidade global de Runs;
* quantidade global de Deliveries.

Para idempotência:

não fazer apenas:

"o Job possui 1 Run".

Validar algo conceitualmente equivalente a:

* Event específico X;
* Rule específica Y;
* Delivery derivada de X/Y;
* número de Runs causados por essa delivery/event.

O teste precisa provar a relação causal, não a ausência de outros registros no banco.

---

# 7. Global autonomy switch

O singleton global de produção continuará singleton.

Não alterar essa arquitetura.

Mapear todos os testes que usam:

`setAutonomousExecutionEnabled(...)`

Esses testes não podem competir em paralelo modificando o mesmo singleton.

Solução desejada:

* serializar somente o grupo que realmente altera o switch global; OU
* separar teste de persistência real dos demais testes que apenas precisam controlar a dependência.

Manter pelo menos um teste real contra PostgreSQL comprovando que o global switch funciona.

Não mockar tudo.

---

# 8. Mapear outras fontes globais

Buscar na suíte inteira por potenciais recursos compartilhados:

* `settings`;
* `agent_events`;
* `agent_event_deliveries`;
* scheduler;
* consumers;
* global switches;
* Redis keys;
* filas;
* jobs agendados;
* cleanup de tabela inteira;
* contadores globais;
* `delete(...)` sem escopo de fixture;
* helpers que drenam filas;
* timers/workers que permanecem vivos após teste.

Corrigir agora qualquer fonte equivalente encontrada.

Não esperar uma nova flakiness aparecer daqui a algumas versões.

---

# 9. Concorrência

Depois do isolamento, manter paralelismo onde for seguro.

Não quero simplesmente colocar:

`--test-concurrency=1`

na suíte inteira e considerar o problema resolvido.

Pode haver serialização localizada quando o recurso realmente for global.

Exemplo válido:

testes específicos do singleton global de autonomia.

O restante deve continuar paralelizável quando tecnicamente possível.

---

# 10. Não tocar no banco de desenvolvimento

É proibido como solução deste problema executar no ambiente atual:

`docker compose down -v`

da stack de desenvolvimento;

`DROP DATABASE agencia`;

`TRUNCATE` generalizado no banco de dev;

remoção dos milhares de Runs/Events/Blocks existentes.

Esses dados não precisam ser usados pelos testes novos.

A correção é isolamento, não destruição do ambiente existente.

---

# 11. Jobs antigos 1546/1547

Tratar separadamente do ambiente de testes.

Cancelar:

* 1546;
* 1547.

Desabilitar Event Rules pertencentes exclusivamente ao antigo smoke test.

Usar mecanismos oficiais da aplicação.

Não apagar histórico.

Preservar:

* Runs;
* Events;
* Deliveries;
* Autonomy Blocks;
* Audit Logs.

Confirmar que um Event Processor iniciado posteriormente não reativa essa cadeia.

---

# 12. Scripts npm

Criar comandos claros, se necessário, por exemplo conceitualmente:

`npm run test:setup`
`npm test`
`npm run test:reset`

ou um comando único:

`npm run test:integration`

Prefira que o comando oficial já faça o setup seguro necessário.

O desenvolvedor não deve precisar lembrar manualmente de limpar banco antes de testar.

---

# 13. Docker Compose

Se apropriado, adicionar serviços de teste separados.

Não prejudicar:

`docker compose up -d`

normal da aplicação.

O banco/Redis de testes podem usar:

* profile específico;
* compose override;
* compose separado;

escolha o que ficar mais simples e sustentável no repositório existente.

Não introduzir complexidade desnecessária.

---

# 14. `.env.example`

Documentar apenas valores de exemplo.

Nunca commit:

* API keys reais;
* tokens;
* passwords reais;
* secrets do ambiente.

A suíte de testes também não deve fazer chamadas LLM reais.

Desabilitar provider externo durante testes, salvo testes explícitos e controlados para provider.

---

# 15. Migrations

O banco de teste deve usar as migrations reais do projeto.

Não criar schema paralelo simplificado.

Precisamos continuar validando a aplicação sobre:

* PostgreSQL real;
* FKs reais;
* constraints;
* índices;
* transactions;
* `SELECT ... FOR UPDATE`;
* locks;
* Drizzle/migrations reais.

---

# 16. Validação final — apenas depois da correção

Não rode a suíte completa repetidamente durante a investigação.

Primeiro implemente a infraestrutura.

Quando considerar corrigido:

## Backend

Executar:

`npx tsc --noEmit`

Depois executar a suíte completa 3 vezes.

Cada execução deve começar de estado conhecido/limpo.

Quero relatório separado:

### Execução 1

* total;
* pass;
* fail;
* cancelled.

### Execução 2

* total;
* pass;
* fail;
* cancelled.

### Execução 3

* total;
* pass;
* fail;
* cancelled.

Não fazer rerun isolado para transformar falha em sucesso.

Se qualquer uma falhar, investigar antes de continuar.

---

# 17. Frontend

Quando backend estiver estabilizado:

`npm test`

`npm run build`

---

# 18. Critério para considerarmos resolvido

Só declarar resolvido quando tivermos:

* PostgreSQL de teste independente;
* Redis isolado;
* proteção contra cleanup do ambiente errado;
* execução começando de estado conhecido;
* `event-processor.test.ts` sem depender da fila global de outros testes;
* global autonomy switch sem race cross-file;
* três suítes completas consecutivas verdes;
* nenhum rerun;
* nenhum flaky conhecido;
* typecheck limpo;
* frontend verde.

---

# 19. Depois disso: Git

Se tudo passar:

revisar:

`git status`

`git diff --stat`

`git diff`

Verificar ausência de:

* `.env`;
* secrets;
* API keys;
* dumps;
* logs;
* `node_modules`;
* `.next`;
* artefatos temporários.

Então criar o checkpoint:

`feat(agents): complete autonomous agent architecture through v1.5`

Não executar push.

Não fazer deploy.

---

# 20. Relatório final

Quero somente um relatório consolidado ao final contendo:

1. causa raiz;
2. arquitetura do ambiente de testes criado;
3. PostgreSQL de teste utilizado;
4. Redis de teste utilizado;
5. proteção contra banco errado;
6. mudanças em `event-processor.test.ts`;
7. mudanças relativas ao global autonomy switch;
8. outras fontes globais encontradas;
9. arquivos criados;
10. arquivos alterados;
11. estado dos Jobs 1546/1547;
12. resultado da suíte #1;
13. resultado da suíte #2;
14. resultado da suíte #3;
15. backend typecheck;
16. frontend tests;
17. frontend build;
18. confirmação de que banco de dev não foi apagado/alterado destrutivamente;
19. `git status`;
20. hash do commit;
21. débitos restantes.

Não iniciar v1.6.

Não continuar repetindo testes antes de corrigir a infraestrutura.

A prioridade agora é:

**resolver definitivamente o isolamento da suíte e encerrar a v1.5.**
