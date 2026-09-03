import { and, desc, eq, or } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { auditLogs } from '../../db/schema/index.js';

import { getSchedulerRuntimeState } from './scheduler.js';
import { isOperationalSupervisionEnabled } from './scheduler-settings.js';
import { isOperationalSupervisionRunning } from './supervisor-guard.js';

export type SchedulerLastResult = 'success' | 'failed' | 'skipped';

export interface OperationalSupervisionSchedulerStatus {
  enabled: boolean;
  running: boolean;
  intervalSeconds: number;
  active: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  lastDurationMs: number | null;
  lastResult: SchedulerLastResult | null;
  nextRunAt: string | null;
}

/**
 * Agentes v2.5.1 (correio.md seção 17/18) — "não é obrigatório persistir
 * tudo... avaliar o que pode ser derivado de audit logs/config/estado em
 * memória": `enabled` vem do setting persistido (v2.5.1),
 * `running`/`nextRunAt` vêm de estado em memória do próprio processo
 * (`supervisor-guard.ts`/`scheduler.ts` — nunca uma tabela nova só para
 * isto), e os 3 timestamps + duração + resultado são DERIVADOS da
 * trilha de auditoria já existente (`agent_operational_supervision`,
 * `agents.operations.scan.started/.scan.completed/.scheduler.failed`) —
 * nenhuma tabela nova.
 *
 * `lastDurationMs`/`lastResult` são best-effort (seção 17 não exige
 * precisão transacional): calculados a partir do par mais recente de
 * `scan.started`+`scan.completed` (ou `.scheduler.failed`, se a
 * supervisão nem chegou a terminar) — nunca uma correlação por ID
 * (esses eventos não compartilham um identificador de execução), só a
 * ordem temporal, suficiente para uma tela de observabilidade.
 */
export async function getOperationalSupervisionSchedulerStatus(): Promise<OperationalSupervisionSchedulerStatus> {
  const [enabled, runtimeState] = await Promise.all([isOperationalSupervisionEnabled(), Promise.resolve(getSchedulerRuntimeState())]);

  const relevantLogs = await db
    .select()
    .from(auditLogs)
    .where(
      or(
        eq(auditLogs.action, 'agents.operations.scan.started'),
        eq(auditLogs.action, 'agents.operations.scan.completed'),
        eq(auditLogs.action, 'agents.operations.scheduler.failed'),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(20);

  const lastStarted = relevantLogs.find((row) => row.action === 'agents.operations.scan.started');
  const lastCompleted = relevantLogs.find((row) => row.action === 'agents.operations.scan.completed');
  const lastFailed = relevantLogs.find((row) => row.action === 'agents.operations.scheduler.failed');

  let lastDurationMs: number | null = null;
  let lastResult: SchedulerLastResult | null = null;

  const mostRecentTerminal = [lastCompleted, lastFailed]
    .filter((row): row is (typeof relevantLogs)[number] => Boolean(row))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (mostRecentTerminal) {
    lastResult = mostRecentTerminal.action === 'agents.operations.scheduler.failed' ? 'failed' : 'success';
    // O `scan.started` correspondente é o mais recente ANTES deste
    // terminal (nunca depois — senão pertenceria a uma execução futura).
    const matchingStart = relevantLogs.find((row) => row.action === 'agents.operations.scan.started' && row.createdAt.getTime() <= mostRecentTerminal.createdAt.getTime());
    if (matchingStart) {
      lastDurationMs = mostRecentTerminal.createdAt.getTime() - matchingStart.createdAt.getTime();
    }
  }

  return {
    enabled,
    running: isOperationalSupervisionRunning(),
    intervalSeconds: runtimeState.intervalSeconds ?? 0,
    active: runtimeState.active,
    lastStartedAt: lastStarted?.createdAt.toISOString() ?? null,
    lastCompletedAt: lastCompleted?.createdAt.toISOString() ?? null,
    lastFailedAt: lastFailed?.createdAt.toISOString() ?? null,
    lastDurationMs,
    lastResult,
    nextRunAt: runtimeState.nextRunAt?.toISOString() ?? null,
  };
}
