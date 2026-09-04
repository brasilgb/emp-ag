import { index, integer, pgTable, serial, timestamp, unique } from 'drizzle-orm/pg-core';

import { auditLogs } from './audit-logs.js';
import { users } from './users.js';

/**
 * Agentes v3.8 (correio.md "Operational Incident Ownership & Assignment",
 * seção 1/3) — estado CORRENTE de responsável humano por um incidente já
 * detectado pelo Operational Supervisor.
 *
 * Descoberta feita ANTES de desenhar isto (correio.md seção 1): revisados
 * `agent_operational_incident_reviews` (v3.6), a fila `Needs Attention`
 * (v3.7), Escalations (v2.6) e FollowUps (v2.7).
 * - `agent_operational_incident_reviews` representa REVIEW (acknowledged/
 *   resolved/dismissed) — um conceito ortogonal a "quem é responsável".
 *   Reaproveitar essa tabela para assignment misturaria duas
 *   responsabilidades distintas (correio.md seção 3: "Assignment e review
 *   são conceitos distintos... não transformar `agent_operational_incident_reviews`
 *   em um registro genérico de workflow").
 * - `agent_operational_escalations.targetUserId`/`agent_operational_follow_ups.assignedUserId`
 *   só existem quando `escalateSupervisorFinding` (v2.6) resolve uma
 *   Responsibility com domínio inequívoco — a maioria dos incidentes
 *   nunca tem uma Escalation/FollowUp correspondente (mesma lacuna já
 *   documentada no docblock de `agent-operational-incident-reviews.ts`
 *   para review). Usar esses campos como "responsável pelo incidente"
 *   deixaria a maioria dos incidentes sem nenhuma forma de ownership.
 * Migration nova, portanto, justificada — nenhuma estrutura existente
 * representa "responsável corrente por incidente" sem ambiguidade.
 *
 * Identidade canônica preservada (correio.md seção 2): o incidente
 * continua sendo exclusivamente o audit `agents.operations.incident.detected`
 * — esta tabela nunca cria uma segunda identidade concorrente, só
 * referencia `incidentAuditLogId` via FK real (`onDelete: 'restrict'`).
 * Integridade "é realmente um incidente" é validada em código
 * (`isValidIncidentAuditLog`, reexportada de `incident-review-service.ts`
 * e reutilizada aqui — a MESMA função dos dois lados, nunca uma segunda
 * definição de "o que é um incidente válido").
 *
 * `unique(incidentAuditLogId)` — "um estado corrente por incidente" é
 * imposto pelo próprio banco; é também a chave usada pelo UPSERT atômico
 * que resolve concorrência de assign/reassign (correio.md seção 10,
 * `incident-assignment-service.ts`), mesmo padrão de
 * `agent_operational_incident_reviews`.
 *
 * `assigneeUserId` NOT NULL — diferente de review (onde só o status
 * varia), aqui "não atribuído" é sempre a AUSÊNCIA da linha, nunca uma
 * linha com assignee nulo. `unassignIncident` remove a linha (DELETE),
 * simetricamente a como ela nunca é pré-criada para incidentes ainda não
 * atribuídos. Isso mantém a MESMA semântica de "estado sintetizado pela
 * ausência de linha" já usada por `unreviewed` em `agent_operational_incident_reviews`
 * — nenhum segundo idioma de "estado vazio" inventado nesta versão. O
 * histórico de QUEM foi atribuído antes (mesmo depois de desatribuído)
 * vive exclusivamente em `audit_logs` (append-only,
 * `agents.operations.incident.assigned`/`.reassigned`/`.unassigned`) —
 * esta tabela representa só o presente, nunca o histórico.
 */
export const agentOperationalIncidentAssignments = pgTable(
  'agent_operational_incident_assignments',
  {
    id: serial('id').primaryKey(),

    incidentAuditLogId: integer('incident_audit_log_id')
      .notNull()
      .references(() => auditLogs.id, { onDelete: 'restrict' }),

    assigneeUserId: integer('assignee_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    assignedBy: integer('assigned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('agent_operational_incident_assignments_incident_audit_log_id_key').on(table.incidentAuditLogId),
    index('agent_operational_incident_assignments_assignee_user_id_idx').on(table.assigneeUserId),
  ],
);
