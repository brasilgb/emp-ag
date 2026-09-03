import { and, count, desc, eq, like } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentDirectorDecisions, auditLogs } from '../../db/schema/index.js';
import { env } from '../../config/env.js';
import { audit } from '../../services/audit.js';

import { scanStaleWorkflows } from './detector.js';
import { RECOVERY_ADAPTERS } from './registry.js';
import type { RecoveryAdapter, RecoveryItemResult, StaleCandidate, WorkflowType } from './types.js';

const ADAPTER_BY_TYPE = new Map<WorkflowType, RecoveryAdapter>(RECOVERY_ADAPTERS.map((adapter) => [adapter.workflowType, adapter]));

export interface RunRecoveryOptions {
  dryRun?: boolean;
  actorUserId: number | null;
  thresholdSeconds?: number;
}

export interface RecoveryReport {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  thresholdSeconds: number;
  scanned: number;
  stale: number;
  recovered: number;
  reverted: number;
  manualAttention: number;
  skipped: number;
  items: RecoveryItemResult[];
  errors: { workflowType: string; message: string }[];
}

/**
 * Agentes v2.4 (correio.md seções 18/20/21) — único ponto de entrada
 * para rodar a reconciliação. Manual/administrativo nesta versão (seção
 * 18: "não criar daemon automaticamente de início") — chamado só por
 * `POST /agents/recovery/run`. `dryRun=true` NUNCA escreve no banco
 * (repassado a cada `adapter.reconcile`, que decide o resultado sem
 * tocar nada — seção 20: "garantir que dry-run não produza efeitos
 * colaterais").
 *
 * Best-effort por item (seção 21): uma falha ao reconciliar UMA
 * entidade nunca aborta o scan inteiro — é reportada como `errors` e o
 * relatório final continua completo para as demais.
 */
export async function runRecovery(options: RunRecoveryOptions): Promise<RecoveryReport> {
  const startedAt = new Date();
  const dryRun = options.dryRun ?? false;
  const thresholdSeconds = options.thresholdSeconds ?? env.AGENT_WORKFLOW_STALE_AFTER_SECONDS;

  await audit({
    userId: options.actorUserId,
    actorType: options.actorUserId ? 'user' : 'system',
    actorId: options.actorUserId ? String(options.actorUserId) : null,
    action: 'agents.recovery.scan.started',
    entityType: 'agent_recovery_scan',
    entityId: null,
    metadata: { dryRun, thresholdSeconds },
  });

  const { candidates, errors } = await scanStaleWorkflows(thresholdSeconds);

  // Seção 14: "não registrar evento para cada entidade saudável
  // examinada" — só os STALE encontrados são auditados individualmente.
  for (const candidate of candidates) {
    await audit({
      userId: options.actorUserId,
      actorType: options.actorUserId ? 'user' : 'system',
      actorId: options.actorUserId ? String(options.actorUserId) : null,
      action: 'agents.recovery.stale_detected',
      entityType: workflowEntityType(candidate.workflowType),
      entityId: String(candidate.entityId),
      metadata: { workflowType: candidate.workflowType, previousState: candidate.previousState, ageSeconds: candidate.ageSeconds, problem: candidate.problem, dryRun },
    });
  }

  const items: RecoveryItemResult[] = [];

  for (const candidate of candidates) {
    const adapter = ADAPTER_BY_TYPE.get(candidate.workflowType);
    if (!adapter) {
      errors.push({ workflowType: candidate.workflowType, message: `Nenhum adapter registrado para "${candidate.workflowType}".` });
      continue;
    }

    try {
      const result = await adapter.reconcile(candidate, { thresholdSeconds, dryRun, actorUserId: options.actorUserId });
      items.push(result);
    } catch (error) {
      errors.push({ workflowType: candidate.workflowType, message: error instanceof Error ? error.message : `Falha desconhecida ao reconciliar #${candidate.entityId}.` });
    }
  }

  const finishedAt = new Date();

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    dryRun,
    thresholdSeconds,
    scanned: candidates.length,
    stale: candidates.length,
    recovered: items.filter((item) => item.result === 'recovered').length,
    reverted: items.filter((item) => item.result === 'reverted').length,
    manualAttention: items.filter((item) => item.result === 'manual_attention').length,
    skipped: items.filter((item) => item.result === 'skipped').length,
    items,
    errors,
  };
}

/**
 * Agentes v2.4 (correio.md seção 15) — reconciliação manual de UMA
 * entidade específica (seção 16: "somente se houver necessidade clara").
 * Reaproveita o MESMO adapter/predicados de `runRecovery` — nunca uma
 * segunda lógica de reconciliação para o caso "um item só".
 */
export async function reconcileOne(params: {
  workflowType: WorkflowType;
  entityId: number;
  dryRun?: boolean;
  actorUserId: number | null;
  thresholdSeconds?: number;
}): Promise<RecoveryItemResult | null> {
  const adapter = ADAPTER_BY_TYPE.get(params.workflowType);
  if (!adapter) return null;

  const thresholdSeconds = params.thresholdSeconds ?? env.AGENT_WORKFLOW_STALE_AFTER_SECONDS;
  const candidates = await adapter.detectStale(thresholdSeconds);
  const candidate = candidates.find((item) => item.entityId === params.entityId);
  if (!candidate) return null;

  return adapter.reconcile(candidate, { thresholdSeconds, dryRun: params.dryRun ?? false, actorUserId: params.actorUserId });
}

function workflowEntityType(workflowType: WorkflowType): string {
  return workflowType === 'initiative' ? 'agent_director_initiative' : workflowType === 'executive_review' ? 'agent_executive_review' : 'agent_strategic_memory';
}

export interface RecoveryStatus {
  staleTotal: number;
  byType: Record<WorkflowType, number>;
  oldest: StaleCandidate | null;
  manualAttentionPending: number;
  lastScanAt: string | null;
  lastReconciledAt: string | null;
}

/**
 * Agentes v2.4 (correio.md seção 15) — "pode ser calculado sob demanda
 * nesta versão": nenhum estado novo é persistido só para isto.
 * `lastScanAt`/`lastReconciledAt` são derivados da trilha de auditoria
 * JÁ existente (`audit_logs`, eventos `agents.recovery.scan.started`/
 * `.reconciled`) — reaproveitamento total, nenhuma tabela nova.
 */
export async function getRecoveryStatus(thresholdSeconds?: number): Promise<RecoveryStatus> {
  const effectiveThreshold = thresholdSeconds ?? env.AGENT_WORKFLOW_STALE_AFTER_SECONDS;
  const { candidates } = await scanStaleWorkflows(effectiveThreshold);

  const byType: Record<WorkflowType, number> = { initiative: 0, executive_review: 0, strategic_memory: 0 };
  let oldest: StaleCandidate | null = null;

  for (const candidate of candidates) {
    byType[candidate.workflowType] += 1;
    if (!oldest || candidate.ageSeconds > oldest.ageSeconds) oldest = candidate;
  }

  const [lastScan] = await db.select({ createdAt: auditLogs.createdAt }).from(auditLogs).where(eq(auditLogs.action, 'agents.recovery.scan.started')).orderBy(desc(auditLogs.createdAt)).limit(1);

  const [lastReconciled] = await db
    .select({ createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(eq(auditLogs.action, 'agents.recovery.reconciled'))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  // "manual attention pendente" (seção 15) — Decision Items abertos
  // criados especificamente pelo recovery (seção 13: diferenciados de
  // uma decisão estratégica normal por `signalType` prefixado
  // `agents.recovery.`), nunca a fila inteira do Diretor.
  const [manualAttentionRow] = await db
    .select({ total: count() })
    .from(agentDirectorDecisions)
    .where(and(like(agentDirectorDecisions.signalType, 'agents.recovery.%'), eq(agentDirectorDecisions.status, 'open')));

  return {
    staleTotal: candidates.length,
    byType,
    oldest,
    manualAttentionPending: Number(manualAttentionRow?.total ?? 0),
    lastScanAt: lastScan?.createdAt.toISOString() ?? null,
    lastReconciledAt: lastReconciled?.createdAt.toISOString() ?? null,
  };
}
