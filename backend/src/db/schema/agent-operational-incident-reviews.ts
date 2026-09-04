import { index, integer, pgTable, serial, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { auditLogs } from './audit-logs.js';
import { users } from './users.js';

/**
 * Agentes v3.6 (correio.md "Operational Incident Acknowledgement & Review
 * Workflow", seção 4) — estado humano de revisão sobre um incidente já
 * detectado pelo Operational Supervisor.
 *
 * Descoberta feita ANTES de desenhar isto (correio.md seção 1): nenhuma
 * estrutura existente representa, de forma inequívoca, "um estado
 * corrente (mutável) por incidente":
 * - `audit_logs` é append-only por convenção em todo o projeto — nunca
 *   editado, nunca representa "o estado atual" de nada, só o que
 *   aconteceu (correio.md pede exatamente o oposto: "um estado corrente
 *   por incidente").
 * - `agent_operational_escalations`/`agent_operational_follow_ups` (v2.6/
 *   v2.7) têm seu próprio ciclo de vida, mas SÓ existem quando
 *   `escalateSupervisorFinding` resolve um domínio inequívoco — a maioria
 *   dos incidentes (`observe`/`already_handled`/`skipped`, e qualquer
 *   incidente sem Responsibility configurada) NUNCA tem uma Escalation
 *   correspondente. Usar Escalation.status como "review humano" deixaria
 *   incidentes inteiros sem nenhuma forma de acompanhamento — inaceitável
 *   pelo objetivo desta versão.
 * Migration nova, portanto, justificada.
 *
 * Identidade canônica preservada (correio.md seção 3): o incidente
 * continua sendo exclusivamente o audit `agents.operations.incident.detected`
 * (mesma fonte oficial usada por `supervision-insights-service.ts` desde
 * a v3.5) — esta tabela nunca cria uma segunda identidade concorrente,
 * só referencia `auditLogId` via FK real (`onDelete: 'restrict'` —
 * `audit_logs` nunca é apagado neste projeto, mas a garantia fica
 * explícita no schema mesmo assim). Integridade de "é realmente um
 * incidente" (não qualquer audit log) é validada em código, no boundary
 * de escrita (`incident-review-service.ts`) — Postgres não suporta CHECK
 * contra outra tabela, então a validação real fica ali, nunca só
 * "confiada" ao FK.
 *
 * `unique(incidentAuditLogId)` — "um estado corrente por incidente"
 * (seção 4) é imposto pelo próprio banco, nunca só pela aplicação; é
 * também a chave usada pelo UPSERT atômico que resolve concorrência
 * (seção 10, `incident-review-service.ts`).
 *
 * Nenhuma linha é pré-criada para incidentes ainda não revisados
 * (`unreviewed` é o estado SINTETIZADO pela ausência de linha, nunca
 * persistido) — evita ter que popular uma linha para cada um dos
 * milhares de incidentes históricos só para representar "nada aconteceu
 * ainda", e mantém "nenhuma exclusão física necessária para o workflow
 * normal" (seção 4) trivialmente verdadeiro (a linha só passa a existir
 * quando alguém efetivamente revisa).
 */
export const agentOperationalIncidentReviews = pgTable(
  'agent_operational_incident_reviews',
  {
    id: serial('id').primaryKey(),

    incidentAuditLogId: integer('incident_audit_log_id')
      .notNull()
      .references(() => auditLogs.id, { onDelete: 'restrict' }),

    // acknowledged | resolved | dismissed — nunca 'unreviewed' persistido
    // (ver docblock acima: ausência de linha JÁ significa 'unreviewed').
    status: varchar('status', { length: 20 }).notNull(),

    reviewedBy: integer('reviewed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),

    // Limitado em tamanho na borda de validação (Zod, incident-review-schemas.ts)
    // — `text` aqui só pelo mesmo motivo de `agent_operational_escalations.reason`
    // (coluna sem limite físico, limite é uma decisão de produto/API, não
    // de armazenamento). Nunca informação sensível (seção 4 do correio —
    // nota é texto livre digitado por um humano, tratada como tal).
    note: text('note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('agent_operational_incident_reviews_incident_audit_log_id_key').on(table.incidentAuditLogId),
    index('agent_operational_incident_reviews_status_idx').on(table.status),
  ],
);
