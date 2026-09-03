import { audit } from '../../services/audit.js';
import { escalateSupervisorFinding } from '../escalations/supervisor-integration.js';
import { applySafeRecovery, restrictJobAutonomy } from './safe-actions.js';
import { escalateIncidentToManualAttention } from './manual-attention.js';
import { classifyIncidents } from './incidents.js';
import { collectOperationalSignals } from './signals.js';
import { buildRecommendations } from './health-service.js';
import type { OperationalIncident, OperationalIncidentResult, OperationalRecommendation, OperationalSupervisionReport } from './health-types.js';
import type { WorkflowType } from '../recovery/types.js';

const WORKFLOW_ENTITY_TYPES: readonly string[] = ['initiative', 'executive_review', 'strategic_memory'] as const satisfies readonly WorkflowType[];

function isWorkflowType(value: string): value is WorkflowType {
  return (WORKFLOW_ENTITY_TYPES as readonly string[]).includes(value);
}

export interface RunOperationalSupervisionOptions {
  dryRun?: boolean;
  actorUserId: number | null;
  // Agentes v2.5.1 (correio.md seção 15) — contexto de auditabilidade,
  // única mudança de contrato desta versão sobre a função da v2.5
  // ("ajustar contrato apenas se realmente necessário"). Nunca cria uma
  // segunda diferença de comportamento entre origem manual/automática
  // (seção 14) — só viaja até o metadata de auditoria.
  triggeredBy?: 'scheduler' | 'manual';
}

/**
 * Agentes v2.5 (correio.md seção 15) — único ponto de entrada da
 * supervisão. Fluxo exatamente como pedido: collect → classify →
 * evaluate → apply (se `!dryRun`) → audit → report estruturado.
 *
 * "Aplicar respostas permitidas" (seção 15) é SEMPRE uma chamada a um
 * mecanismo oficial já existente (`applySafeRecovery` → Recovery v2.4,
 * `restrictJobAutonomy` → mesmo kill switch por Job da v1.5,
 * `escalateIncidentToManualAttention` → Director Decision Queue v1.9) —
 * este serviço NUNCA toca uma tabela de negócio diretamente.
 *
 * Concorrência (v2.5.1 seção 29): esta função continua SEM guard próprio
 * — de propósito, para permanecer testável isoladamente (mesmo padrão
 * dos testes da v2.5). O guard central único vive em
 * `supervisor-guard.ts`, chamado por TODOS os callers reais (rota HTTP
 * manual e scheduler automático), nunca por esta função diretamente.
 */
export async function runOperationalSupervision(params: RunOperationalSupervisionOptions): Promise<OperationalSupervisionReport> {
  const startedAt = new Date();
  const dryRun = params.dryRun ?? false;
  const triggeredBy = params.triggeredBy ?? 'manual';

  await audit({
    userId: params.actorUserId,
    actorType: params.actorUserId ? 'user' : 'system',
    actorId: params.actorUserId ? String(params.actorUserId) : null,
    action: 'agents.operations.scan.started',
    entityType: 'agent_operational_supervision',
    entityId: null,
    metadata: { dryRun, triggeredBy },
  });

  const signals = await collectOperationalSignals(startedAt);
  const incidents = classifyIncidents(signals);
  const recommendations = await buildRecommendations(incidents);
  const recommendationByIncidentId = new Map(recommendations.map((recommendation) => [recommendation.incidentId, recommendation]));

  const results: OperationalIncidentResult[] = [];

  for (const incident of incidents) {
    const recommendation = recommendationByIncidentId.get(incident.id);
    if (!recommendation) continue;

    const result = await applyResponse(incident, recommendation, dryRun, params.actorUserId);
    results.push(result);

    // Agentes v2.6 (correio.md seções 13/14/33 item 25) — integração com
    // Responsibility/Escalation, SEMPRE best-effort e ORTOGONAL à
    // Response Policy acima (uma escalation formal para o dono do
    // domínio é uma notificação organizacional, independente de qual
    // ação técnica — safe_recovery/observe/etc. — já foi aplicada).
    // NUNCA em dry-run (zero side effects, seção 16 da v2.5 mantida). Uma
    // falha aqui NUNCA derruba o scan — auditada e o loop continua.
    if (!dryRun) {
      try {
        await escalateSupervisorFinding(incident);
      } catch (error) {
        await audit({
          userId: params.actorUserId,
          actorType: params.actorUserId ? 'user' : 'system',
          actorId: params.actorUserId ? String(params.actorUserId) : null,
          action: 'agents.escalation.creation_failed',
          entityType: incident.entityType,
          entityId: incident.entityId,
          metadata: { incidentType: incident.type, message: error instanceof Error ? error.message : 'Falha desconhecida ao criar escalation.' },
        });
      }
    }
  }

  const finishedAt = new Date();

  await audit({
    userId: params.actorUserId,
    actorType: params.actorUserId ? 'user' : 'system',
    actorId: params.actorUserId ? String(params.actorUserId) : null,
    action: 'agents.operations.scan.completed',
    entityType: 'agent_operational_supervision',
    entityId: null,
    metadata: { dryRun, triggeredBy, signalsDetected: signals.length, incidentsDetected: incidents.length },
  });

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    dryRun,
    signalsDetected: signals.length,
    incidentsDetected: incidents.length,
    observed: results.filter((result) => result.outcome === 'observed' || result.outcome === 'would_observe' || result.outcome === 'already_handled' || result.outcome === 'skipped').length,
    recovered: results.filter((result) => result.outcome === 'recovered' || result.outcome === 'would_recover').length,
    autonomyRestricted: results.filter((result) => result.outcome === 'autonomy_restricted' || result.outcome === 'would_restrict_autonomy').length,
    escalated: results.filter((result) => result.outcome === 'escalated' || result.outcome === 'would_escalate').length,
    results,
  };
}

async function applyResponse(
  incident: OperationalIncident,
  recommendation: OperationalRecommendation,
  dryRun: boolean,
  actorUserId: number | null,
): Promise<OperationalIncidentResult> {
  const timestamp = new Date().toISOString();
  const base = { incidentId: incident.id, incidentType: incident.type, entityType: incident.entityType, entityId: incident.entityId, response: recommendation.response, timestamp };

  // Seção 14: auditar o incidente detectado (nunca cada sinal bruto —
  // "evitar dezenas de audit logs por entidade saudável"; incidentes já
  // são a forma correlacionada/deduplicada).
  await audit({
    userId: actorUserId,
    actorType: actorUserId ? 'user' : 'system',
    actorId: actorUserId ? String(actorUserId) : null,
    action: 'agents.operations.incident.detected',
    entityType: incident.entityType,
    entityId: incident.entityId,
    metadata: { incidentType: incident.type, severity: incident.severity, response: recommendation.response, dryRun },
  });

  switch (recommendation.response) {
    case 'observe':
    case 'already_handled':
      return { ...base, outcome: dryRun ? 'would_observe' : 'observed', reason: recommendation.reason };

    case 'safe_recovery': {
      if (!isWorkflowType(incident.entityType)) {
        return { ...base, outcome: 'skipped', reason: `entityType "${incident.entityType}" não corresponde a um workflow recuperável pela v2.4.` };
      }

      const recoveryResult = await applySafeRecovery({ workflowType: incident.entityType, entityId: Number(incident.entityId), dryRun, actorUserId });
      if (!recoveryResult) return { ...base, outcome: 'skipped', reason: 'Entidade não está mais stale — nada a reconciliar.' };

      if (!dryRun) {
        await audit({
          userId: actorUserId,
          actorType: actorUserId ? 'user' : 'system',
          actorId: actorUserId ? String(actorUserId) : null,
          action: 'agents.operations.safe_recovery',
          entityType: incident.entityType,
          entityId: incident.entityId,
          metadata: { recoveryResult: recoveryResult.result, reason: recoveryResult.reason },
        });
      }

      if (recoveryResult.result === 'reverted' || recoveryResult.result === 'recovered') {
        return { ...base, outcome: dryRun ? 'would_recover' : 'recovered', reason: recoveryResult.reason };
      }
      if (recoveryResult.result === 'manual_attention') {
        return { ...base, outcome: dryRun ? 'would_escalate' : 'escalated', reason: recoveryResult.reason };
      }
      return { ...base, outcome: 'skipped', reason: recoveryResult.reason };
    }

    case 'restrict_autonomy': {
      const jobId = Number(incident.entityId);
      const restrictResult = await restrictJobAutonomy({ jobId, reason: recommendation.reason, dryRun });

      if (!restrictResult.applied) {
        return { ...base, outcome: dryRun ? 'would_observe' : 'observed', reason: restrictResult.reason };
      }

      if (!dryRun) {
        await audit({
          userId: actorUserId,
          actorType: actorUserId ? 'user' : 'system',
          actorId: actorUserId ? String(actorUserId) : null,
          action: 'agents.operations.autonomy_restricted',
          entityType: 'agent_job',
          entityId: incident.entityId,
          metadata: { reason: restrictResult.reason },
        });
      }

      return { ...base, outcome: dryRun ? 'would_restrict_autonomy' : 'autonomy_restricted', reason: restrictResult.reason };
    }

    case 'manual_attention': {
      if (dryRun) {
        return { ...base, outcome: 'would_escalate', reason: recommendation.reason };
      }

      const decision = await escalateIncidentToManualAttention(incident);

      await audit({
        userId: actorUserId,
        actorType: actorUserId ? 'user' : 'system',
        actorId: actorUserId ? String(actorUserId) : null,
        action: 'agents.operations.manual_attention',
        entityType: incident.entityType,
        entityId: incident.entityId,
        metadata: { decisionId: decision.id, reason: recommendation.reason },
      });

      return { ...base, outcome: 'escalated', reason: recommendation.reason };
    }

    default: {
      const exhaustive: never = recommendation.response;
      return { ...base, outcome: 'skipped', reason: `Resposta desconhecida: ${exhaustive}` };
    }
  }
}
