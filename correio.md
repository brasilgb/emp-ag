# Agentes v2.5.1 — Automatic Operational Supervision

## 1. Objetivo

Integrar o `Operational Supervisor` da v2.5 ao mecanismo de agendamento já existente da plataforma, permitindo supervisão recorrente e segura da operação sem criar:

* segundo scheduler;
* cron paralelo;
* `setInterval` solto;
* novo Executor;
* novo Circuit Breaker;
* nova Decision Queue;
* novo mecanismo de recovery.

A execução automática deve chamar exclusivamente o serviço existente:

```ts
runOperationalSupervision(...)
```

O objetivo é permitir que a agência fiscalize periodicamente a própria saúde operacional.

---

# 2. Princípio arquitetural

Fluxo obrigatório:

```text
Scheduler existente
      ↓
Operational Supervision Trigger
      ↓
runOperationalSupervision()
      ↓
Response Policy v2.5
      ↓
observe
safe_recovery
restrict_autonomy
manual_attention
already_handled
```

O scheduler não toma decisões operacionais.

Ele apenas dispara o serviço já existente.

Proibido:

```text
Scheduler
   ↓
interpreta sinais
   ↓
altera workflows diretamente
```

Toda classificação continua dentro da arquitetura da v2.5.

---

# 3. Revisão obrigatória antes de implementar

Antes de escrever código, revisar o scheduler real existente, principalmente:

```text
agents/jobs/scheduler.ts
agents/jobs/job-runner.ts
```

e qualquer serviço responsável por:

* inicialização do scheduler;
* timers;
* polling;
* graceful shutdown;
* execução concorrente;
* lifecycle da aplicação.

Documentar rapidamente no relatório:

* como o scheduler atual inicia;
* qual frequência utiliza;
* se existe um loop central;
* como evita sobreposição;
* como trata exceptions;
* como encerra no shutdown.

Não inferir a arquitetura apenas pelos nomes dos arquivos.

---

# 4. Não criar um Job normal

A supervisão operacional NÃO deve ser implementada como um Job comum criado pelo usuário.

Motivo:

Jobs pertencem ao domínio de objetivos dos agentes.

Operational Supervision é infraestrutura interna de segurança.

Portanto:

```text
Operational Supervisor != AgentJob
```

Mas deve reaproveitar o mesmo scheduler/lifecycle da infraestrutura quando tecnicamente apropriado.

---

# 5. Configuração

Criar somente configurações realmente necessárias.

Sugestão:

```text
AGENT_OPERATIONAL_SUPERVISION_ENABLED
AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS
```

Defaults conservadores sugeridos:

```text
enabled = false
interval = 300
```

ou outro intervalo tecnicamente justificado após revisar o scheduler real.

A ativação automática deve começar desabilitada por default.

Não queremos que simplesmente atualizar a aplicação faça o Supervisor começar a executar ações reais sem decisão administrativa explícita.

---

# 6. Limites do intervalo

O intervalo deve possuir:

* mínimo razoável;
* default conservador;
* validação centralizada;
* ausência de número mágico espalhado.

Sugestão mínima:

```text
60 segundos
```

Não permitir frequência excessiva.

---

# 7. Estado de ativação

Avaliar se o estado deve vir de:

1. env/config;
2. settings já existentes;
3. combinação dos dois.

Preferência:

Se o projeto já possui mecanismo apropriado de settings administrativos persistidos e auditáveis, utilizar esse mecanismo.

Ideal conceitual:

```text
env = capacidade/default de infraestrutura
setting = decisão operacional atual
```

Por exemplo:

```text
AGENT_OPERATIONAL_SUPERVISION_ENABLED=true
```

pode significar que o recurso está disponível, enquanto um setting persistido controla se ele está operacionalmente ativo.

Porém não criar complexidade artificial.

Revisar arquitetura existente antes de decidir.

---

# 8. Execução automática

Implementar uma função pequena, por exemplo:

```ts
runScheduledOperationalSupervision()
```

Ela deve:

1. verificar se supervisão automática está habilitada;
2. garantir que não exista execução anterior ainda ativa;
3. chamar `runOperationalSupervision({ dryRun: false })`;
4. registrar resultado;
5. capturar qualquer erro;
6. liberar o lock/guard em `finally`.

Não duplicar lógica da v2.5.

---

# 9. Proteção contra overlap

Obrigatório impedir duas execuções automáticas simultâneas no mesmo processo.

Exemplo conceitual:

```text
tick N
  ↓
supervisor ainda executando
  ↓
tick N+1
  ↓
skip
```

O segundo tick NÃO deve iniciar nova supervisão.

Implementar usando o mecanismo mais simples compatível com a arquitetura real.

Se houver possibilidade de múltiplas instâncias do backend em produção, avaliar também proteção distribuída.

Não inventar Redis lock se a aplicação atualmente roda somente em uma instância e não houver necessidade real, mas documentar a implicação.

---

# 10. Multi-instance safety

Revisar o modelo real de deploy.

Se a arquitetura permite múltiplos containers/backend replicas simultâneos, a supervisão recorrente não pode rodar independentemente em todas as réplicas produzindo efeitos redundantes.

Nesse caso, utilizar mecanismo distribuído já existente, se houver:

* Redis lock;
* advisory lock;
* scheduler leader;
* outro mecanismo oficial.

Se atualmente existe uma única instância, pode ser usado guard local nesta versão, desde que a limitação seja explicitamente documentada.

Não construir um sistema complexo de eleição de líder sem necessidade comprovada.

---

# 11. Falha do Supervisor

Regra obrigatória:

> Uma falha do Operational Supervisor jamais deve derrubar o scheduler principal.

Toda chamada automática deve ser isolada:

```ts
try {
  await runOperationalSupervision(...)
} catch (error) {
  // audit/log
}
```

O erro não pode escapar ao ponto de:

* parar loop do scheduler;
* impedir Jobs futuros;
* encerrar processo;
* interromper Event Engine.

---

# 12. Failure isolation

Testar explicitamente:

```text
Supervisor lança exception
        ↓
scheduler permanece funcional
        ↓
próximo ciclo continua ocorrendo
        ↓
Jobs normais continuam podendo executar
```

Este é um critério bloqueante de aprovação.

---

# 13. Circuit breaker

A supervisão automática nunca deve:

* fechar circuit breaker;
* alterar `circuit_state` para estado menos restritivo;
* religar Job;
* reativar autonomia global.

Ela continua obedecendo exatamente à política da v2.5.

---

# 14. Auto-recovery permitido

Quando executado automaticamente, `safe_recovery` continua permitido porque a v2.5 já restringe essa ação aos mecanismos de Recovery v2.4 considerados seguros.

Nenhuma diferença de política deve existir entre:

```text
manual supervision
```

e

```text
scheduled supervision
```

A única diferença é o `trigger source`.

---

# 15. Trigger source

Adicionar contexto à execução para auditabilidade.

Conceitualmente:

```ts
runOperationalSupervision({
  dryRun: false,
  triggeredBy: 'scheduler'
})
```

e manual:

```text
triggeredBy = user/admin
```

Ajustar contrato apenas se realmente necessário.

Evitar alterar dezenas de funções apenas por isso.

Se já existir metadata/contexto de auditoria equivalente, reutilizar.

---

# 16. Auditoria da automação

Adicionar eventos somente quando úteis.

Sugestões:

```text
agents.operations.scheduler.started
agents.operations.scheduler.skipped
agents.operations.scheduler.failed
```

Não duplicar todos os eventos já emitidos por `runOperationalSupervision()`.

O scan já produz:

```text
agents.operations.scan.started
agents.operations.scan.completed
```

Portanto não criar ruído redundante.

`skipped` deve ser usado somente para situações operacionais relevantes, como overlap, não a cada tick em que o recurso está desabilitado.

---

# 17. Observabilidade do scheduler

Adicionar status ao Operational Health ou endpoint apropriado.

Informações úteis:

```ts
type OperationalSupervisionSchedulerStatus = {
  enabled: boolean;
  running: boolean;
  intervalSeconds: number;

  lastStartedAt?: Date;
  lastCompletedAt?: Date;
  lastFailedAt?: Date;

  lastDurationMs?: number;
  lastResult?: 'success' | 'failed' | 'skipped';

  nextRunAt?: Date;
};
```

Não é obrigatório persistir tudo.

Avaliar o que pode ser derivado de:

* audit logs;
* config;
* estado em memória.

---

# 18. Persistência

Evitar nova tabela.

Preferência:

* configuração via mecanismo existente;
* timestamps históricos derivados de audit logs;
* `running` e próximo tick em memória quando aplicável.

Criar persistência somente se necessária para funcionamento correto e justificar.

---

# 19. Restart behavior

Após restart do backend:

* scheduler deve reiniciar normalmente;
* não deve tentar “compensar” todos os ticks perdidos;
* não deve disparar múltiplas supervisões acumuladas.

Princípio:

```text
missed supervision tick != queued work
```

A supervisão observa estado atual, portanto basta executar no próximo ciclo normal.

---

# 20. Startup behavior

Não executar imediatamente na inicialização sem avaliar consequências.

Preferência conservadora:

```text
startup
↓
scheduler inicia
↓
aguarda primeiro intervalo
↓
supervision
```

Se o scheduler existente possui padrão diferente, manter coerência com ele.

Documentar decisão.

---

# 21. Graceful shutdown

Se o processo iniciar shutdown enquanto supervisor está rodando:

* não iniciar nova execução;
* evitar corromper estado;
* permitir conclusão conforme política atual de shutdown, quando possível;
* não deixar timers novos vivos.

Reutilizar lifecycle existente.

Não criar handlers de SIGTERM duplicados caso já existam.

---

# 22. Administração

A execução automática deve poder ser habilitada/desabilitada administrativamente.

Antes de criar endpoint, verificar se existe sistema apropriado de settings.

Se necessário:

```http
GET   /agents/operations/scheduler
PATCH /agents/operations/scheduler
```

ou equivalente.

PATCH só pode aceitar campos previamente definidos, por exemplo:

```json
{
  "enabled": true
}
```

Talvez:

```json
{
  "enabled": true,
  "intervalSeconds": 300
}
```

somente se o intervalo for realmente administrável em runtime.

Nunca aceitar:

```json
{
  "command": "..."
}
```

---

# 23. Permissions

Leitura:

```text
agents.operations.read
```

Alteração da supervisão automática:

```text
agents.operations.manage
```

Reaproveitar permission da v2.5.

Não criar nova permission sem necessidade objetiva.

---

# 24. Frontend

Na página existente:

```text
/agents/operations
```

Adicionar seção pequena:

## Supervisão automática

Exibir:

* habilitada/desabilitada;
* intervalo;
* executando agora;
* último início;
* última conclusão;
* última falha;
* duração;
* próximo ciclo.

---

# 25. Controle de ativação

Usuário com `agents.operations.manage` pode:

```text
Habilitar supervisão automática
Desabilitar supervisão automática
```

Se alteração for persistente e operacional, usar confirmação apropriada.

Para habilitar, exibir mensagem:

```text
A supervisão operacional passará a executar automaticamente e poderá
realizar recoveries seguros, restringir autonomia em situações críticas
e escalar incidentes para atenção humana conforme as políticas atuais.
```

Nunca apresentar como:

```text
Permitir que a IA corrija o sistema sozinha
```

---

# 26. Intervalo

Se permitir edição via UI:

* validar backend;
* definir mínimo;
* não permitir frequência perigosa;
* mostrar unidade claramente;
* não aceitar zero ou negativo.

Caso não seja necessário editar em runtime, mostrar apenas o intervalo configurado.

Não adicionar edição apenas porque é fácil.

---

# 27. Manual supervision permanece

Os botões da v2.5:

```text
Simular supervisão
Executar supervisão
```

devem continuar funcionando mesmo com supervisão automática ativa.

Entretanto, evitar overlap entre:

```text
execução automática
```

e

```text
execução manual
```

Avaliar um guard compartilhado.

Uma operação manual enquanto outra está em andamento pode:

* retornar conflito;
* informar "supervisão já em execução";
* ou aguardar, se isso já for padrão no projeto.

Preferência: **não enfileirar**.

---

# 28. HTTP status para overlap

Se uma supervisão manual for solicitada enquanto outra já está rodando, considerar:

```text
409 Conflict
```

com mensagem clara.

Somente fazer isso se o guard puder ser centralizado no serviço e não apenas no scheduler.

---

# 29. Guard central

Preferência arquitetural:

```text
runOperationalSupervision()
```

ou wrapper oficial correspondente deve conhecer exclusão mútua.

Assim:

```text
scheduler → mesmo guard
API → mesmo guard
```

Não criar:

```text
schedulerGuard
apiGuard
```

independentes.

Dois guards separados não resolvem concorrência entre os dois caminhos.

---

# 30. Dry-run

Dry-run manual continua sem efeitos.

A execução automática nunca precisa usar dry-run.

Não criar scheduler em modo dry-run.

---

# 31. Segurança

Testes explícitos devem provar que execução automática:

1. não aumenta autonomia;
2. não fecha Circuit Breaker;
3. não modifica roles;
4. não modifica permissions;
5. não executa tool arbitrária;
6. não cria Action Plan diretamente;
7. não cria approval diretamente;
8. usa Recovery v2.4;
9. usa Decision Queue oficial;
10. reutiliza Response Policy da v2.5.

---

# 32. Testes obrigatórios — scheduler

Adicionar no mínimo:

1. supervisão automática desabilitada não executa;
2. habilitada executa supervisor;
3. utiliza intervalo configurado;
4. intervalo abaixo do mínimo é rejeitado;
5. segundo tick durante execução ativa é ignorado;
6. execução termina e guard é liberado;
7. exception também libera guard;
8. exception do supervisor não encerra scheduler;
9. próximo ciclo após exception continua possível;
10. scheduler não cria segundo mecanismo de supervisão.

---

# 33. Testes obrigatórios — concorrência

11. manual + automático simultâneos não produzem duas execuções reais;
12. duas chamadas automáticas simultâneas produzem no máximo uma execução;
13. guard retorna ao estado livre após sucesso;
14. guard retorna ao estado livre após erro.

Se houver lock distribuído:

15. segunda instância não adquire lock;
16. lock é liberado após conclusão;
17. lock possui proteção contra abandono/crash conforme mecanismo usado.

Executar somente os testes correspondentes à arquitetura realmente implementada.

---

# 34. Testes obrigatórios — configuração

18. default de supervisão automática é seguro;
19. configuração enabled é validada;
20. intervalo é validado;
21. valores inválidos não alteram setting;
22. alteração exige `agents.operations.manage`;
23. leitura usa `agents.operations.read`.

---

# 35. Testes obrigatórios — observabilidade

24. status mostra enabled corretamente;
25. status mostra running durante execução;
26. lastStartedAt atualizado;
27. lastCompletedAt atualizado;
28. lastFailedAt atualizado em erro;
29. duração calculada corretamente;
30. nextRunAt coerente com intervalo.

Adaptar caso alguns campos sejam derivados via audit logs em vez de memória.

---

# 36. Testes obrigatórios — restart/lifecycle

Quando testável de forma isolada:

31. inicialização não cria timers duplicados;
32. `start()` repetido é idempotente;
33. `stop()` limpa timer;
34. `stop()` repetido é seguro;
35. shutdown impede novos ticks.

Não criar testes artificiais impossíveis de representar com a arquitetura real.

---

# 37. Testes de regressão

Executar toda suíte backend.

Baseline v2.5:

```text
567 / 567
```

Confirmar:

```text
todos os 567 anteriores continuam passando
```

Executar suite frontend.

Baseline v2.5:

```text
92 / 92
```

Registrar incremento líquido de testes.

---

# 38. Typecheck/build

Backend:

```bash
npx tsc --noEmit
```

Frontend:

```bash
npx tsc --noEmit
npm run build
```

Lint somente se existir script/config real.

Não afirmar que lint passou quando lint não existe.

---

# 39. Migrations

Evitar migration.

Se precisar persistir setting e o sistema atual já possui tabela genérica de settings, reutilizar.

Não criar:

```text
agent_operational_supervision_settings
```

só para armazenar dois campos, se a infraestrutura de settings já resolver isso.

---

# 40. Critérios bloqueantes

A v2.5.1 NÃO será aprovada se:

* criar segundo scheduler;
* implementar supervisão como AgentJob;
* permitir execuções concorrentes desprotegidas;
* erro do supervisor puder parar scheduler;
* ativação automática ocorrer silenciosamente por default;
* supervisor automático puder aumentar autonomia;
* scheduler alterar workflows diretamente;
* política da execução automática divergir da execução manual;
* houver timers duplicados após restart/start repetido;
* permissões existirem apenas no frontend;
* lock puder ficar permanentemente preso após exception normal;
* testes anteriores regredirem.

---

# 41. Relatório final

Entregar relatório contendo:

1. resumo;
2. scheduler existente encontrado;
3. forma de integração adotada;
4. lifecycle;
5. configuração;
6. default de segurança;
7. intervalo;
8. trigger automático;
9. guard de concorrência;
10. concorrência manual × automática;
11. multi-instance;
12. tratamento de exception;
13. isolamento do scheduler;
14. graceful shutdown;
15. restart behavior;
16. auditoria;
17. observabilidade;
18. API;
19. permissions;
20. frontend;
21. migrations;
22. arquivos criados;
23. arquivos alterados;
24. testes adicionados;
25. testes de concorrência;
26. testes de lifecycle;
27. números backend;
28. números frontend;
29. typecheck/build;
30. git diff --stat;
31. git status;
32. bugs encontrados;
33. limitações reais;
34. débitos técnicos identificados.

## Regra final

**NÃO REALIZAR COMMIT.**

Todas as mudanças devem permanecer no working tree aguardando revisão e autorização do Diretor/CEO.
