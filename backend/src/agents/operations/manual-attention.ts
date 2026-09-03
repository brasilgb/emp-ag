import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentDirectorDecisions } from '../../db/schema/index.js';
import { computePriority } from '../director/decisions/priority.js';

import type { OperationalIncident } from './health-types.js';

export type DecisionRow = typeof agentDirectorDecisions.$inferSelect;

/**
 * Agentes v2.5 (correio.md seção 12) — "reutilizar a Director Decision
 * Queue. Não criar incident inbox separada." Mesmo padrão de
 * `recovery/manual-attention.ts` (v2.4) — deliberadamente NÃO
 * importado/reaproveitado como função (o tipo do parâmetro lá é
 * `WorkflowType`, específico do domínio de Recovery; aqui é
 * `OperationalIncidentType`, mais amplo) — mas o MECANISMO de escrita
 * (mesma tabela, mesmo padrão de dedup) é idêntico, nunca uma segunda
 * tabela.
 *
 * `signalType='agents.operations.<tipo>'` (seção 12), `domain='agents'`,
 * `deduplicationKey` estável por incidente
 * (`agents.operations.<tipo>::<entityType>::<entityId>`) — dois scans
 * do mesmo incidente NUNCA criam uma segunda decisão (seção 12: "o mesmo
 * incidente não pode criar uma nova decisão a cada scan").
 */
export async function escalateIncidentToManualAttention(incident: OperationalIncident, now: Date = new Date()): Promise<DecisionRow> {
  const dedupKey = `agents.operations.${incident.type}::${incident.entityType}::${incident.entityId}`;

  const factors = computePriority({
    severity: incident.severity === 'critical' ? 'critical' : 'warning',
    impact: 'high',
    urgency: incident.severity === 'critical' ? 'immediate' : 'soon',
    agingDays: 0,
    occurrenceCount: 1,
  });

  const inserted = await db
    .insert(agentDirectorDecisions)
    .values({
      deduplicationKey: dedupKey,
      signalType: `agents.operations.${incident.type}`,
      domain: 'agents',
      entityType: incident.entityType,
      entityId: Number.isFinite(Number(incident.entityId)) ? Number(incident.entityId) : null,
      title: `Supervisão operacional: ${incident.type} (${incident.entityType} #${incident.entityId})`,
      description: `O Operational Supervisor (Agentes v2.5) detectou uma condição que não pode ser reconciliada automaticamente com segurança: ${incident.problem}`,
      severity: incident.severity === 'critical' ? 'critical' : 'warning',
      impact: 'high',
      urgency: incident.severity === 'critical' ? 'immediate' : 'soon',
      priorityScore: factors.total,
      priorityFactors: factors,
      status: 'open',
      requiresHumanAttention: true,
      firstDetectedAt: now,
      lastDetectedAt: now,
      occurrenceCount: 1,
      metadata: { incidentType: incident.type, entityType: incident.entityType, entityId: incident.entityId, problem: incident.problem },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: agentDirectorDecisions.deduplicationKey })
    .returning();

  if (inserted.length > 0) return inserted[0]!;

  const [existing] = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.deduplicationKey, dedupKey)).limit(1);
  if (!existing) throw new Error('Falha ao localizar Decision Item de manual_attention após conflito de criação.');
  return existing;
}
