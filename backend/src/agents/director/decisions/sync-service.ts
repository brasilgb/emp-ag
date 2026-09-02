import { and, eq, inArray, notInArray } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorDecisions } from '../../../db/schema/index.js';
import { collectOperationalSignals } from '../operational-signals.js';
import type { OperationalSignal, SignalDomain } from '../types.js';

import { buildDeduplicationKey } from './dedup.js';
import { resolveImpact } from './impact.js';
import { computePriority, daysBetween } from './priority.js';
import { ESCALATION_THRESHOLDS } from './thresholds.js';
import { OPEN_DECISION_STATUSES, type DecisionSyncSummary } from './types.js';
import { resolveUrgency } from './urgency.js';

const DOMAINS: SignalDomain[] = ['crm', 'projects', 'finance', 'support', 'agents'];

function computeRequiresHumanAttention(params: {
  status: string;
  severity: OperationalSignal['severity'];
  agingDays: number;
  occurrenceCount: number;
}): boolean {
  if (params.status === 'awaiting_approval') return true;
  if (params.severity === 'critical' && params.agingDays >= ESCALATION_THRESHOLDS.criticalAgingDays) return true;
  if (params.occurrenceCount >= ESCALATION_THRESHOLDS.recurrenceCount) return true;
  return false;
}

/**
 * Upsert de um único sinal (correio.md seção 30 — concorrência real):
 * `INSERT ... ON CONFLICT (deduplication_key) DO NOTHING` é a tentativa
 * de criação, atômica por construção — nunca find-then-insert. Se outra
 * sincronização concorrente já criou a linha entre a tentativa e agora
 * (conflito), a transação com `SELECT ... FOR UPDATE` trava a linha real
 * antes de reler/recalcular, então duas sincronizações simultâneas para
 * o mesmo sinal nunca perdem um incremento de occurrence_count nem
 * gravam prioridades inconsistentes uma sobre a outra.
 */
async function upsertSignal(
  signal: OperationalSignal,
  now: Date,
): Promise<{ outcome: 'created' } | { outcome: 'updated' | 'unchanged' }> {
  const dedupKey = buildDeduplicationKey(signal);
  const impact = resolveImpact(signal);
  const urgency = resolveUrgency(signal);

  const factors = computePriority({ severity: signal.severity, impact, urgency, agingDays: 0, occurrenceCount: 1 });
  const requiresHumanAttention = computeRequiresHumanAttention({
    status: 'open',
    severity: signal.severity,
    agingDays: 0,
    occurrenceCount: 1,
  });

  const inserted = await db
    .insert(agentDirectorDecisions)
    .values({
      deduplicationKey: dedupKey,
      signalType: signal.type,
      domain: signal.domain,
      entityType: signal.entityType ?? null,
      entityId: signal.entityId ?? null,
      title: signal.title,
      description: signal.description,
      severity: signal.severity,
      impact,
      urgency,
      priorityScore: factors.total,
      priorityFactors: factors,
      status: 'open',
      requiresHumanAttention,
      firstDetectedAt: now,
      lastDetectedAt: now,
      occurrenceCount: 1,
      metadata: signal.metadata,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: agentDirectorDecisions.deduplicationKey })
    .returning({ id: agentDirectorDecisions.id });

  if (inserted.length > 0) {
    return { outcome: 'created' };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, dedupKey))
      .for('update');

    if (!existing) {
      // Corrida extrema: a linha existia no INSERT acima mas sumiu antes
      // do SELECT FOR UPDATE (nunca deveria acontecer — nada neste
      // módulo deleta linhas). Fail-safe: trata como nova criação em vez
      // de lançar.
      await tx
        .insert(agentDirectorDecisions)
        .values({
          deduplicationKey: dedupKey,
          signalType: signal.type,
          domain: signal.domain,
          entityType: signal.entityType ?? null,
          entityId: signal.entityId ?? null,
          title: signal.title,
          description: signal.description,
          severity: signal.severity,
          impact,
          urgency,
          priorityScore: factors.total,
          priorityFactors: factors,
          status: 'open',
          requiresHumanAttention,
          firstDetectedAt: now,
          lastDetectedAt: now,
          occurrenceCount: 1,
          metadata: signal.metadata,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: agentDirectorDecisions.deduplicationKey });
      return { outcome: 'created' as const };
    }

    const nextOccurrenceCount = existing.occurrenceCount + 1;
    const agingDays = daysBetween(existing.firstDetectedAt, now);
    const reoccurrenceFactors = computePriority({
      severity: signal.severity,
      impact,
      urgency,
      agingDays,
      occurrenceCount: nextOccurrenceCount,
    });

    // Reabertura (correio.md seções 6/17): 'resolved' e 'dismissed' são
    // os dois únicos estados que a reocorrência reabre — o mesmo
    // problema voltou a acontecer, então "dispensar uma ocorrência
    // específica" não pode silenciar permanentemente uma condição real
    // recorrente. Os demais estados não-terminais mantêm seu status —
    // ainda é trabalho em andamento, a reocorrência só atualiza
    // detecção/prioridade.
    const shouldReopen = existing.status === 'resolved' || existing.status === 'dismissed';
    const nextStatus = shouldReopen ? 'open' : existing.status;

    const nextRequiresHumanAttention = computeRequiresHumanAttention({
      status: nextStatus,
      severity: signal.severity,
      agingDays,
      occurrenceCount: nextOccurrenceCount,
    });

    const changed =
      existing.priorityScore !== reoccurrenceFactors.total ||
      existing.status !== nextStatus ||
      existing.requiresHumanAttention !== nextRequiresHumanAttention;

    await tx
      .update(agentDirectorDecisions)
      .set({
        lastDetectedAt: now,
        occurrenceCount: nextOccurrenceCount,
        title: signal.title,
        description: signal.description,
        severity: signal.severity,
        impact,
        urgency,
        priorityScore: reoccurrenceFactors.total,
        priorityFactors: reoccurrenceFactors,
        status: nextStatus,
        requiresHumanAttention: nextRequiresHumanAttention,
        metadata: signal.metadata,
        ...(shouldReopen
          ? { resolvedAt: null, resolvedBy: null, dismissedAt: null, dismissedBy: null, dismissReason: null }
          : {}),
        updatedAt: now,
      })
      .where(eq(agentDirectorDecisions.id, existing.id));

    return { outcome: (changed ? 'updated' : 'unchanged') as 'updated' | 'unchanged' };
  });
}

/**
 * Agentes v1.9 (correio.md secao 20) - ponto unico de sincronizacao.
 * Reaproveita collectOperationalSignals (v1.8) sem duplicar coleta.
 * Resolucao (secao 7) so roda para dominios sem erro de coleta nesta
 * chamada - itens de dominios com falha ficam intocados, nunca
 * resolvidos por engano.
 */
export async function syncDirectorDecisionQueue(
  now: Date = new Date(),
  // Injeção só para teste (mesmo padrão de operations-service.ts na
  // v1.8) — permite testar dedup/recorrência/resolução/concorrência sem
  // depender de fixtures reais em 4 módulos de negócio diferentes.
  collectors?: Parameters<typeof collectOperationalSignals>[1],
): Promise<DecisionSyncSummary> {
  const { signals, errors } = await collectOperationalSignals(now, collectors);
  const failedDomains = new Set(errors.map((error) => error.domain));

  const summary: DecisionSyncSummary = { created: 0, updated: 0, resolved: 0, unchanged: 0, errors };
  const touchedKeysByDomain = new Map<SignalDomain, string[]>();
  for (const domain of DOMAINS) touchedKeysByDomain.set(domain, []);

  for (const signal of signals) {
    touchedKeysByDomain.get(signal.domain)?.push(buildDeduplicationKey(signal));
    const result = await upsertSignal(signal, now);
    summary[result.outcome] += 1;
  }

  // Resolução — só para domínios sem falha de coleta nesta chamada.
  for (const domain of DOMAINS) {
    if (failedDomains.has(domain)) continue;

    const touchedKeys = touchedKeysByDomain.get(domain) ?? [];

    const staleItems = await db
      .select({ id: agentDirectorDecisions.id })
      .from(agentDirectorDecisions)
      .where(
        and(
          eq(agentDirectorDecisions.domain, domain),
          inArray(agentDirectorDecisions.status, OPEN_DECISION_STATUSES as string[]),
          touchedKeys.length > 0 ? notInArray(agentDirectorDecisions.deduplicationKey, touchedKeys) : undefined,
        ),
      );

    if (staleItems.length === 0) continue;

    await db
      .update(agentDirectorDecisions)
      .set({ status: 'resolved', resolvedAt: now, resolvedBy: null, updatedAt: now })
      .where(
        inArray(
          agentDirectorDecisions.id,
          staleItems.map((item) => item.id),
        ),
      );

    summary.resolved += staleItems.length;
  }

  return summary;
}
