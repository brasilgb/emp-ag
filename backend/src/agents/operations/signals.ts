import { and, eq, inArray, lt } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentApprovals, agentDirectorDecisions, agentJobRuns, agentJobs } from '../../db/schema/index.js';
import { env } from '../../config/env.js';
import { isAutonomousExecutionEnabled } from '../jobs/global-switch.js';
import { listIncidents } from '../incidents/service.js';
import { scanStaleWorkflows } from '../recovery/detector.js';

import type { OperationalSignal } from './health-types.js';

// Run "preso" = status não-terminal antigo. Não existe `updated_at` em
// agent_job_runs (schema real, confirmado antes de implementar — seção
// 31) — `created_at` é o único timestamp disponível para medir idade.
const NON_TERMINAL_RUN_STATUSES = ['queued', 'planning', 'running', 'waiting_approval'] as const;

// Janela de leitura para deliveries falhas — nunca todo o histórico
// (ruído sem fim), mas também não é um "threshold de classificação"
// (por isso não vira env var, seção 14 pede configurável só para
// thresholds que decidem severidade/incidente, não para uma janela de
// varredura). 24h é uma escolha operacional simples e documentada.
const DELIVERY_FAILURE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Agentes v2.5 (correio.md seção 3/31) — coleta pura de sinais, SEM
 * mutação nenhuma. Reaproveita fontes já existentes, nunca reimplementa
 * detecção já feita por outro módulo:
 *
 * - `workflow_stale`: `recovery/detector.ts:scanStaleWorkflows` (v2.4) —
 *   mesmo threshold (`AGENT_WORKFLOW_STALE_AFTER_SECONDS`).
 * - `job_repeated_failure`/`delivery_failure`: `incidents/service.ts:listIncidents`
 *   (v1.6) — mesmo `circuit.failureThreshold` já usado pelo Circuit
 *   Breaker real, nunca um segundo threshold divergente.
 * - `run_stuck`: NOVO nesta versão — não havia detector equivalente no
 *   código real (revisado antes de implementar, seção 31).
 * - `autonomy_circuit_open`: leitura DIRETA de `agent_jobs.circuit_state`
 *   (estado atual, mais preciso que a projeção histórica de
 *   `agent_autonomy_blocks` usada pelo Incident Center).
 * - `approval_bottleneck`: NOVO nesta versão — `agent_approvals`
 *   pendentes há muito tempo.
 * - `manual_attention_pending`: Decision Queue (`agent_director_decisions`,
 *   v1.9/v2.4) — itens abertos com `requires_human_attention=true`.
 * - `autonomy_disabled_globally`: `agents/jobs/global-switch.ts` (v1.3) —
 *   mesmo mecanismo do kill switch, nunca uma segunda leitura de estado.
 */
export async function collectOperationalSignals(now: Date = new Date()): Promise<OperationalSignal[]> {
  const signals: OperationalSignal[] = [];

  // --- workflow_stale (Recovery v2.4) ---
  const { candidates: staleWorkflows } = await scanStaleWorkflows(env.AGENT_WORKFLOW_STALE_AFTER_SECONDS);
  for (const candidate of staleWorkflows) {
    signals.push({
      type: 'workflow_stale',
      severity: 'warning',
      source: 'recovery_v2_4',
      entityType: candidate.workflowType,
      entityId: String(candidate.entityId),
      detectedAt: now.toISOString(),
      reason: candidate.problem,
      metadata: { previousState: candidate.previousState, ageSeconds: candidate.ageSeconds },
    });
  }

  // --- job_repeated_failure (Incident Center v1.6) ---
  const { data: repeatedFailures } = await listIncidents({ page: 1, limit: 100, type: 'job_repeated_failure' });
  for (const incident of repeatedFailures) {
    if (!incident.jobId) continue;
    signals.push({
      type: 'job_repeated_failure',
      severity: 'critical',
      source: 'incident_center',
      entityType: 'agent_job',
      entityId: String(incident.jobId),
      detectedAt: incident.occurredAt,
      reason: incident.summary,
    });
  }

  // --- delivery_failure (Incident Center v1.6, janela recente) ---
  const { data: deliveryFailures } = await listIncidents({
    page: 1,
    limit: 200,
    type: 'event_delivery_failed',
    from: new Date(now.getTime() - DELIVERY_FAILURE_LOOKBACK_MS),
    to: now,
  });
  for (const incident of deliveryFailures) {
    signals.push({
      type: 'delivery_failure',
      severity: 'warning',
      source: 'incident_center',
      entityType: incident.ruleId ? 'agent_event_rule' : 'agent_event_delivery',
      entityId: String(incident.ruleId ?? incident.id),
      detectedAt: incident.occurredAt,
      reason: incident.summary,
      metadata: { jobId: incident.jobId, eventId: incident.eventId },
    });
  }

  // --- run_stuck (novo) ---
  const stuckBefore = new Date(now.getTime() - env.AGENT_OPERATIONAL_STUCK_AFTER_SECONDS * 1000);
  const stuckRuns = await db
    .select()
    .from(agentJobRuns)
    .where(and(inArray(agentJobRuns.status, [...NON_TERMINAL_RUN_STATUSES]), lt(agentJobRuns.createdAt, stuckBefore)));
  for (const run of stuckRuns) {
    signals.push({
      type: 'run_stuck',
      severity: 'warning',
      source: 'job_runs',
      entityType: 'agent_job_run',
      entityId: String(run.id),
      detectedAt: now.toISOString(),
      reason: `Run #${run.id} (Job #${run.jobId}) está "${run.status}" há mais de ${env.AGENT_OPERATIONAL_STUCK_AFTER_SECONDS}s.`,
      metadata: { jobId: run.jobId, status: run.status },
    });
  }

  // --- autonomy_circuit_open (leitura direta do estado atual) ---
  const openCircuitJobs = await db.select().from(agentJobs).where(eq(agentJobs.circuitState, 'open'));
  for (const job of openCircuitJobs) {
    signals.push({
      type: 'autonomy_circuit_open',
      severity: 'critical',
      source: 'agent_jobs',
      entityType: 'agent_job',
      entityId: String(job.id),
      detectedAt: (job.circuitOpenedAt ?? now).toISOString(),
      reason: `Circuit Breaker do Job "${job.name}" (#${job.id}) está aberto.`,
      metadata: { failureCount: job.circuitFailureCount },
    });
  }

  // --- approval_bottleneck (novo) ---
  const approvalStaleBefore = new Date(now.getTime() - env.AGENT_OPERATIONAL_APPROVAL_WARNING_AFTER_SECONDS * 1000);
  const staleApprovals = await db
    .select()
    .from(agentApprovals)
    .where(and(eq(agentApprovals.status, 'pending'), lt(agentApprovals.createdAt, approvalStaleBefore)));
  // Seção 3: "a existência de approval pendente não deve automaticamente
  // representar incidente" — só vira sinal quando VELHA o bastante. Um
  // único sinal agregado (não um por approval) evita ruído.
  if (staleApprovals.length > 0) {
    signals.push({
      type: 'approval_bottleneck',
      severity: 'warning',
      source: 'agent_approvals',
      entityType: 'agent_approvals_backlog',
      entityId: 'global',
      detectedAt: now.toISOString(),
      reason: `${staleApprovals.length} approval(ns) pendente(s) há mais de ${env.AGENT_OPERATIONAL_APPROVAL_WARNING_AFTER_SECONDS}s.`,
      metadata: { count: staleApprovals.length },
    });
  }

  // --- manual_attention_pending (Decision Queue) ---
  const pendingAttention = await db
    .select()
    .from(agentDirectorDecisions)
    .where(and(eq(agentDirectorDecisions.domain, 'agents'), eq(agentDirectorDecisions.requiresHumanAttention, true), eq(agentDirectorDecisions.status, 'open')));
  for (const decision of pendingAttention) {
    signals.push({
      type: 'manual_attention_pending',
      severity: decision.severity === 'critical' ? 'critical' : 'warning',
      source: 'decision_queue',
      entityType: 'agent_director_decision',
      entityId: String(decision.id),
      detectedAt: decision.firstDetectedAt.toISOString(),
      reason: decision.title,
      metadata: { signalType: decision.signalType },
    });
  }

  // --- autonomy_disabled_globally (kill switch v1.3) ---
  const autonomyEnabled = await isAutonomousExecutionEnabled();
  if (!autonomyEnabled) {
    signals.push({
      type: 'autonomy_disabled_globally',
      severity: 'warning',
      source: 'global_switch',
      entityType: 'agent_global_autonomy',
      entityId: 'global',
      detectedAt: now.toISOString(),
      reason: 'Execução autônoma global está desabilitada (kill switch).',
    });
  }

  return signals;
}
