# Agentes v3.8 — Operational Incident Ownership & Assignment

## Objetivo

Implementar uma camada explícita de **ownership humano para incidentes operacionais**, permitindo que incidentes já detectados pelo Operational Supervisor e exibidos na fila `Needs Attention` sejam:

* atribuídos a um responsável;
* reatribuídos;
* liberados/desatribuídos;
* consultados por responsável;
* acompanhados no histórico de review;
* exibidos claramente na fila operacional.

A v3.8 deve fechar o fluxo:

```text
Detection
  ↓
Needs Attention
  ↓
Acknowledgement
  ↓
Assignment
  ↓
Human Review
  ↓
Resolution / Dismissal
```

A atribuição é exclusivamente uma ferramenta de **coordenação humana**.

Ela NÃO concede autonomia adicional ao Supervisor, NÃO inicia resolução automática e NÃO altera a política de resposta operacional.

---

# 1. Descoberta obrigatória antes de qualquer implementação

Antes de criar migration, tabela, endpoint ou serviço, revisar obrigatoriamente:

* `audit_logs`;
* `agent_operational_incident_reviews` da v3.6;
* implementação da fila `Needs Attention` da v3.7;
* `supervision-insights-service.ts`;
* `supervisor-service.ts`;
* usuários/identidades existentes no sistema;
* RBAC/permissions existentes;
* memberships, roles ou equivalente;
* auditoria já utilizada pelas operações;
* frontend atual de `/agents/operations`;
* `SupervisionIncidentDetailDialog`;
* hooks React Query envolvidos;
* escalation/follow-up existentes.

Responder explicitamente no relatório:

1. se existe estrutura persistente que possa representar ownership de incidente sem ambiguidade;
2. se `agent_operational_incident_reviews` pode ou não receber essa responsabilidade sem misturar conceitos;
3. se assignment precisa de nova persistência;
4. por que a decisão tomada não cria uma segunda identidade de incidente.

**Não criar migration antes dessa análise.**

---

# 2. Identidade canônica do incidente

A identidade canônica continua obrigatoriamente sendo:

```text
audit_logs
action = agents.operations.incident.detected
auditLogId = identidade do incidente
```

A v3.8 NÃO pode criar:

* `incident_id` paralelo;
* tabela duplicando incidentes;
* cache materializado da fila;
* entidade operacional concorrente com `audit_logs`.

Qualquer estrutura de assignment deve referenciar exclusivamente o incidente canônico já existente.

---

# 3. Persistência esperada

Se a descoberta confirmar que não existe estrutura adequada, criar uma estrutura mínima dedicada a ownership.

Preferência arquitetural:

```text
agent_operational_incident_assignments
```

Ela deve representar apenas o **estado corrente de assignment**.

Campos esperados conceitualmente:

```text
audit_log_id
assignee_user_id
assigned_by_user_id
assigned_at
updated_at
```

Opcionalmente, caso a arquitetura existente exija:

```text
tenant_id / workspace_id / organization_id
```

somente se isso for necessário para integridade e isolamento conforme os padrões existentes do projeto.

Não adicionar campos especulativos como:

```text
priority
due_date
sla
estimated_resolution
status
team_id
department_id
auto_assign
```

a menos que já exista contrato inequívoco no sistema que justifique o reuso.

Assignment e review são conceitos distintos.

Não transformar `agent_operational_incident_reviews` em um registro genérico de workflow se isso misturar responsabilidades.

---

# 4. Histórico e auditoria

O estado corrente pode ser mutável, mas toda alteração deve produzir evento append-only em `audit_logs`.

Registrar pelo menos:

```text
agents.operations.incident.assigned
agents.operations.incident.reassigned
agents.operations.incident.unassigned
```

Metadata suficiente para reconstruir:

```text
incidentAuditLogId
previousAssigneeUserId
assigneeUserId
performedByUserId
```

Não persistir cópias de nome/e-mail do usuário quando a identidade puder ser resolvida pela fonte oficial.

---

# 5. Regras de assignment

Implementar regras determinísticas.

### Assign

Incidente sem responsável:

```text
unassigned → assigned
```

### Reassign

Incidente já atribuído:

```text
assigned(A) → assigned(B)
```

Registrar auditoria específica de reatribuição.

### Unassign

```text
assigned → unassigned
```

### Mesmo responsável

Atribuir novamente o mesmo usuário deve ser:

* idempotente, ou
* rejeitado de forma explícita e determinística.

Escolher uma única semântica, documentar e testar.

Preferência: **idempotência**.

---

# 6. Resolução e dismissal

Assignment NÃO deve alterar automaticamente o estado de review.

Portanto:

```text
assign ≠ acknowledge
assign ≠ resolve
assign ≠ dismiss
```

Da mesma forma:

```text
acknowledge ≠ assign
```

Quando um incidente for `resolved` ou `dismissed`, não realizar nenhuma ação automática destrutiva sobre assignment sem justificativa arquitetural.

Preferência:

* manter assignment persistido para contexto histórico;
* a fila `Needs Attention` já removerá o incidente naturalmente por causa do `reviewStatus`.

Se necessário, permitir leitura do responsável também no histórico.

---

# 7. Quem pode ser responsável

O backend deve validar que o usuário escolhido é elegível dentro do mesmo contexto operacional/tenant/workspace aplicável.

Não aceitar um `userId` arbitrário somente porque existe no banco.

Reutilizar as estruturas existentes de:

```text
Identity
Membership
Role
Permission
Tenant/Workspace context
```

conforme arquitetura real encontrada.

Evitar regras hardcoded por nome de papel quando puder ser usada a estrutura atual de autorização.

---

# 8. Permissions

Não criar permission nova sem necessidade comprovada.

Avaliar primeiro se:

```text
agents.operations.read
agents.operations.manage
```

já cobrem corretamente a feature.

Semântica preferida:

```text
read
→ pode ver assignment

manage
→ pode assign/reassign/unassign
```

Se houver razão arquitetural real para permission dedicada, justificar antes de implementá-la.

---

# 9. Backend

Criar serviço dedicado ou incorporar ao serviço existente apenas se a separação de responsabilidade ficar clara.

Operações esperadas:

```text
getIncidentAssignment(auditLogId)

assignIncident(auditLogId, assigneeUserId, actor)

unassignIncident(auditLogId, actor)
```

Reassignment pode ser consequência natural de `assignIncident`.

Toda mutação deve ser transacional quando houver:

```text
alteração de estado + audit log
```

Não permitir situação em que o estado seja alterado sem a auditoria correspondente.

---

# 10. Concorrência

Tratar concorrência explicitamente.

Exemplo:

Dois supervisores humanos tentam atribuir o mesmo incidente quase simultaneamente.

A implementação deve produzir estado final consistente.

Pode usar:

* `INSERT ... ON CONFLICT`;
* `UPDATE` protegido;
* transação;
* lock apropriado;
* mecanismo equivalente já usado no projeto.

Não criar lock global do Operational Supervisor.

O assignment deve ser isolado por incidente.

Criar teste concorrente quando tecnicamente viável.

---

# 11. API

Manter namespace coerente com v3.5–v3.7.

Sugestão:

```text
PUT
/agents/operations/supervision-insights/incidents/:auditLogId/assignment
```

Body:

```json
{
  "assigneeUserId": "..."
}
```

Para remoção:

```text
DELETE
/agents/operations/supervision-insights/incidents/:auditLogId/assignment
```

ou outra semântica REST já usada pelo projeto.

Não criar múltiplos endpoints redundantes como:

```text
/assign
/reassign
/take
/claim
```

se uma única operação de atualização resolver corretamente.

---

# 12. Integração com Incident Review

O detalhe do incidente deve passar a retornar também:

```text
assignment
```

com dados suficientes para UI:

```text
assigneeUserId
assigneeName
assignedAt
assignedBy
```

conforme disponibilidade real das entidades existentes.

Não duplicar o diálogo.

Continuar reutilizando:

```text
SupervisionIncidentDetailDialog
```

da v3.5/v3.6/v3.7.

---

# 13. Integração com Needs Attention

Cada item de `Needs Attention` deve expor o assignment corrente.

Exemplo conceitual:

```text
assignment:
  null
```

ou:

```text
assignment:
  {
    assigneeUserId,
    assigneeName,
    assignedAt
  }
```

A fila deve permitir filtros opcionais:

```text
assigneeUserId
unassignedOnly
```

Evitar criar outro endpoint apenas para "My Incidents".

O mesmo endpoint da fila deve ser reutilizado.

---

# 14. Ordenação da fila

NÃO alterar silenciosamente a regra de prioridade da v3.7:

```text
severity
→ recurrence
→ reviewStatus
→ aging
→ auditLogId
```

Assignment não deve mudar prioridade operacional por default.

Não colocar automaticamente:

```text
unassigned > assigned
```

sem requisito explícito.

Se a UI precisar destacar não atribuídos, usar badge/filtro, não alterar a semântica central da fila.

---

# 15. Frontend — Needs Attention

Adicionar indicação visual clara de ownership.

Exemplos:

```text
Assigned to: João
Unassigned
```

Adicionar filtro:

```text
Assignee
```

e, se fizer sentido:

```text
Only unassigned
```

Não transformar a tela em Kanban.

Não implementar drag-and-drop nesta versão.

---

# 16. Frontend — Incident Detail

No mesmo diálogo existente, adicionar seção:

```text
Assignment
```

Permitindo para usuários com `agents.operations.manage`:

* selecionar responsável;
* trocar responsável;
* remover responsável.

Usuário apenas com `read`:

* visualiza;
* não altera.

Não duplicar lógica de autorização somente no frontend.

Backend continua sendo autoridade.

---

# 17. Seleção de usuários

Reutilizar endpoint/listagem de usuários existente.

Não criar cadastro paralelo.

O seletor deve exibir somente usuários elegíveis ao contexto atual.

Não carregar todos os usuários globais da plataforma se a aplicação for multitenant.

Evitar N+1 para resolver nomes de responsáveis na fila.

---

# 18. React Query

Adicionar query/mutation seguindo padrões existentes.

Após:

```text
assign
reassign
unassign
```

invalidar ao menos:

```text
attention queue
incident detail
incident history
```

somente nas chaves necessárias.

Não fazer `window.location.reload()`.

---

# 19. N+1

A inclusão do assignee não pode transformar:

```text
listAttentionQueue
```

em consulta por linha.

Assignments e identidades devem ser resolvidos em lote.

Esperado:

```text
WHERE audit_log_id IN (...)
```

e resolução batched dos usuários.

Manter custo de queries constante em relação à quantidade de incidentes dentro da página.

Adicionar teste específico de N+1 se a implementação introduzir consultas adicionais.

---

# 20. Segurança

Garantir:

* incidente existe;
* incidente pertence à identidade canônica correta;
* usuário selecionado existe;
* usuário é elegível no mesmo contexto;
* actor possui permissão;
* IDs inválidos resultam em erro previsível;
* nenhuma enumeração cross-tenant;
* nenhuma confiança em ownership enviado pelo frontend.

---

# 21. Testes obrigatórios

Cobrir pelo menos:

1. incidente começa sem responsável;
2. assign funciona;
3. assignment aparece no detalhe;
4. assignment aparece na fila;
5. reassign funciona;
6. histórico/audit registra responsável anterior e novo;
7. unassign funciona;
8. unassign é auditado;
9. usuário com somente `read` não pode atribuir;
10. usuário com `manage` pode atribuir;
11. usuário inexistente é rejeitado;
12. usuário fora do contexto é rejeitado;
13. incidente inexistente é rejeitado;
14. assignment não muda reviewStatus;
15. acknowledge não cria assignment;
16. resolve não cria/troca assignment;
17. dismiss não cria/troca assignment;
18. resolved deixa a fila default sem destruir assignment;
19. histórico ainda consegue mostrar assignment;
20. filtro `assigneeUserId` funciona;
21. filtro `unassignedOnly` funciona;
22. filtros combinam com severity/recurrence/aging/reviewStatus;
23. paginação continua determinística;
24. nenhuma regressão em v3.5;
25. nenhuma regressão em v3.6;
26. nenhuma regressão em v3.7;
27. ausência de N+1;
28. concorrência não produz estado inconsistente;
29. audit + mudança de estado são atômicos.

---

# 22. Supervisor

Não alterar:

```text
supervisor-guard.ts
```

salvo se surgir motivo crítico e previamente documentado.

A expectativa da v3.8 é:

```text
supervisor-guard.ts intocado
```

Também não alterar:

* Response Policy;
* Planner;
* Policy Evaluator;
* Executor;
* Circuit Breaker;
* scheduler;
* recovery;
* incident detection;
* escalation automática;
* follow-up automático.

---

# 23. Autonomia

É proibido nesta versão:

```text
auto-assignment
round-robin
AI choosing assignee
LLM classification
load balancing
auto escalation by owner
automatic reassignment
automatic deadlines
SLA enforcement
```

Tudo isso fica fora da v3.8.

O usuário humano decide explicitamente quem assume o incidente.

---

# 24. Migration

Caso seja necessária migration:

* criar nova migration incremental;
* não editar migrations antigas;
* usar FKs e índices consistentes;
* respeitar isolamento do domínio existente;
* explicar cada constraint relevante;
* testar migration em banco real.

Caso NÃO seja necessária:

* justificar detalhadamente por que a persistência existente representa assignment de forma inequívoca.

---

# 25. Validação final obrigatória

Executar:

```text
backend typecheck
backend testes específicos
backend suíte completa
frontend typecheck
frontend lint
frontend testes
frontend build
```

Comparar quantitativamente:

```text
baseline anterior
+
testes v3.8
=
novo total esperado
```

Se houver divergência, investigar e explicar.

---

# 26. Relatório final

Entregar relatório contendo:

1. análise prévia da persistência;
2. decisão de migration;
3. schema final, se houver;
4. regra exata de assignment;
5. regra de elegibilidade do assignee;
6. autorização;
7. atomicidade/auditoria;
8. estratégia de concorrência;
9. endpoints;
10. integração com v3.5/v3.6/v3.7;
11. estratégia anti-N+1;
12. arquivos criados;
13. arquivos alterados;
14. testes adicionados;
15. resultado completo da validação;
16. confirmação explícita de que `supervisor-guard.ts` permaneceu intacto;
17. confirmação de que não houve aumento de autonomia;
18. confirmação de que não foi criado novo Circuit Breaker;
19. confirmação de que não existe segunda identidade de incidente;
20. confirmação de que assignment não executa ações operacionais automaticamente.

---

# 27. Restrições finais

Não fazer commit.

Não iniciar v3.9.

Não fazer deploy.

Não reconstruir infraestrutura fora do necessário para validação local.

Não implementar funcionalidades "aproveitando a rodada".

Executar exclusivamente a **v3.8 — Operational Incident Ownership & Assignment** e entregar o relatório para revisão antes do commit.
