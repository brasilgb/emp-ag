# Saneamento final — Agentes v2.0

A arquitetura e implementação da v2.0 foram aprovadas conceitualmente pelo Diretor.

NÃO redesenhar a versão e NÃO adicionar novas funcionalidades.

Antes do commit, sane somente os pontos abaixo.

## 1. Reconciliar números de testes

O relatório afirma:

* v1.9 backend: 363 testes
* v2.0: 60 testes novos
* resultado v2.0: 403/403

Esses números não são compatíveis.

Além disso, a enumeração dos novos testes apresentada no relatório soma 47, não 60.

No frontend:

* v1.9: 22 testes
* v2.0: 15 novos
* resultado: 29/29

Também é incompatível.

Levantar os números reais diretamente do runner e corrigir o relatório.

Não estimar.

Informar:

* testes backend existentes antes da v2.0;
* testes backend adicionados pela v2.0;
* total real;
* testes frontend existentes;
* novos;
* total real.

Executar novamente as suítes completas.

---

## 2. Validar migration chain

Investigar por que migrations 0013/0014 estavam fisicamente aplicadas mas ausentes de `drizzle.__drizzle_migrations`.

Não tratar simples inserção manual de hashes como solução operacional padrão.

Validar dois cenários:

### A — banco limpo

Criar banco/schema limpo e executar exclusivamente:

npm run db:migrate

Confirmar aplicação correta de toda cadeia até 0015.

### B — banco legado atual

Confirmar que o tracking reconciliado representa exatamente as migrations realmente aplicadas.

Verificar:

* hashes;
* ordem;
* timestamps/metadata usados pelo Drizzle;
* schema resultante.

Documentar procedimento seguro de reconciliação caso outro ambiente tenha o mesmo drift.

Não executar migration destrutiva.

---

## 3. Explicar e testar ON CONFLICT

Revisar a descrição do bug envolvendo:

onConflictDoNothing
índice parcial
where / targetWhere

O relatório atual diz simultaneamente que o INSERT não conflitava e que também não duplicava.

Isso precisa ficar tecnicamente inequívoco.

Adicionar ao relatório:

* SQL relevante gerado;
* comportamento antes da correção;
* comportamento depois da correção;
* constraint/index responsável;
* resultado do teste concorrente.

Manter teste com chamadas simultâneas.

---

## 4. Validar semântica de crm.clients_won

Confirmar se:

crm.clients_won

realmente representa clientes conquistados no modelo atual.

O evaluator informado atualmente conta:

clients.createdAt >= goal.startDate

Se isso significa "novo cliente conquistado" no domínio atual, documentar.

Se `won` possuir outro significado de negócio, corrigir o nome da métrica ou seu evaluator.

Não criar novo módulo CRM nesta tarefa.

---

## 5. Definir reincidência de recommendations

Para:

recommendationKey = goal-health:<goalId>:<health>

definir explicitamente o comportamento:

at_risk
→ on_track
→ at_risk novamente.

Decidir e documentar se:

* reutiliza a Initiative anterior; ou
* permite uma nova recomendação após recuperação/reincidência.

Adicionar pelo menos um teste cobrindo essa regra.

Não criar mecanismo complexo de escalation.

---

## 6. Validação final

Depois dos ajustes:

* backend typecheck;
* backend suíte completa;
* frontend typecheck;
* frontend testes completos;
* frontend build;
* migration em banco limpo;
* teste de concorrência/deduplicação.

Entregar somente o relatório de saneamento com:

1. causa de cada inconsistência;
2. alterações realizadas;
3. resultado real dos testes;
4. validação das migrations;
5. SQL/comportamento do ON CONFLICT;
6. decisão sobre crm.clients_won;
7. regra de reincidência;
8. git diff --stat;
9. git status.

NÃO fazer commit.

Aguardar autorização final do Diretor/CEO.
