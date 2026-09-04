import { and, count, desc, eq, gte, lte } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalSupervisionRuns } from '../../db/schema/index.js';
import type { OperationalSupervisionReport } from './health-types.js';
import { runGuardedOperationalSupervision, SupervisionAlreadyRunningError } from './supervisor-guard.js';
import type { RunOperationalSupervisionOptions } from './supervisor-service.js';
import { runOperationalSupervision } from './supervisor-service.js';

/**
 * Agentes v3.4 (correio.md "Operational Supervision Observability & Run
 * History") — histórico persistente e consultável de TENTATIVAS de
 * supervisão, tanto automáticas (scheduler, v3.1) quanto manuais
 * (`POST /operations/supervise`, v1.6). Puramente observacional (seção
 * 2): NUNCA decide nada — não cria incidentes, não altera severity, não
 * muda responses, não toca Action Plans/Planner/Policy Evaluator/
 * Executor/permissions, e sobretudo NUNCA interfere no advisory lock
 * (v3.3/v3.3.1, `supervisor-guard.ts` — intocado por este arquivo além
 * de chamá-lo exatamente como já era chamado antes).
 *
 * `runObservedOperationalSupervision` é a ÚNICA função nova que os
 * chamadores reais (scheduler.ts e a rota manual) passam a usar — ela
 * envolve `runGuardedOperationalSupervision` (a cadeia inteira já
 * existente: guard → advisory lock → runOperationalSupervision)
 * DE FORA, como uma caixa-preta: nunca modifica `supervisor-guard.ts`
 * (recém-endurecido pela v3.3.1 — "nenhum enfraquecimento do locking")
 * nem a lógica decisória de `supervisor-service.ts` além da extensão
 * aditiva de contagem já documentada em `health-types.ts`. Os erros que
 * já propagavam antes (`SupervisionAlreadyRunningError`, falhas
 * estruturais) continuam propagando exatamente igual — o histórico só
 * OBSERVA o que já ia acontecer, nunca muda o que acontece.
 */

export type SupervisionRunTriggerSource = 'scheduler' | 'manual';

export const SUPERVISION_RUN_STATUSES = ['running', 'succeeded', 'completed_with_failures', 'failed', 'skipped_already_running'] as const;
export type SupervisionRunStatus = (typeof SUPERVISION_RUN_STATUSES)[number];

export type SupervisionRunRow = typeof agentOperationalSupervisionRuns.$inferSelect;

async function createSupervisionRun(triggerSource: SupervisionRunTriggerSource, actorUserId: number | null): Promise<SupervisionRunRow> {
  const [row] = await db
    .insert(agentOperationalSupervisionRuns)
    .values({ triggerSource, actorUserId, status: 'running' })
    .returning();
  return row!;
}

interface FinalizeTerminalParams {
  status: Exclude<SupervisionRunStatus, 'running'>;
  finishedAt: Date;
  durationMs: number;
  report?: OperationalSupervisionReport;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/**
 * Transição ÚNICA suportada (correio.md seção 10, "append-only na
 * prática"): `running` → um dos 4 estados terminais, exatamente uma vez
 * por linha. Nenhum endpoint/CRUD genérico de edição existe.
 */
async function finalizeSupervisionRun(id: number, params: FinalizeTerminalParams): Promise<void> {
  await db
    .update(agentOperationalSupervisionRuns)
    .set({
      status: params.status,
      finishedAt: params.finishedAt,
      durationMs: params.durationMs,
      findingsCount: params.report?.incidentsDetected ?? null,
      responsesAttempted: params.report ? params.report.results.length : null,
      responsesSucceeded: params.report ? params.report.results.length - params.report.failed : null,
      responsesFailed: params.report?.failed ?? null,
      escalationsAttempted: params.report?.escalationsAttempted ?? null,
      escalationsSucceeded: params.report?.escalationsSucceeded ?? null,
      escalationsFailed: params.report?.escalationsFailed ?? null,
      failedCount: params.report?.failed ?? null,
      // correio.md seção 17 — sanitização: só `error.message`, NUNCA
      // stack trace bruto. Mesma convenção já usada em todo o resto do
      // módulo (`agents.escalation.creation_failed`,
      // `agents.operations.incident.failed`,
      // `agents.operations.scheduler.failed`) — nenhuma sanitização nova
      // inventada, só reaproveitada aqui.
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
    })
    .where(eq(agentOperationalSupervisionRuns.id, id));
}

/** `error.name` quando disponível (ex.: "Error", "TypeError") — nunca `.stack`, nunca o texto completo do erro (isso vai em `errorMessage`, já sanitizado para mensagem apenas). */
function errorCodeOf(error: unknown): string | null {
  return error instanceof Error ? error.name : null;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha desconhecida na supervisão operacional.';
}

/**
 * Wrapper observacional em volta de `runGuardedOperationalSupervision`
 * (correio.md seção 2: "acrescenta somente observabilidade ao redor
 * dessa cadeia"). `runner` continua injetável só para teste (mesmo
 * padrão já usado em toda a cadeia — `supervisor-guard.ts`/
 * `supervisor-service.ts`), threading até o fundo sem interceptar nada.
 *
 * Lifecycle (correio.md seção 8): cria o registro `running` ANTES de
 * sequer tentar o advisory lock (nenhuma dependência circular entre o
 * histórico e a aquisição do lock — o registro nasce, só DEPOIS o guard
 * decide o resto). Se `pg_try_advisory_lock` estava ocupado
 * (`SupervisionAlreadyRunningError`), finaliza como
 * `skipped_already_running`. Qualquer outra exceção (falha estrutural,
 * incluindo falha de infraestrutura ao adquirir o lock) finaliza como
 * `failed`. Sucesso finaliza `succeeded` ou `completed_with_failures`
 * conforme `report.failed > 0` (v3.2, reaproveitado — seção 9: "não
 * recalcular com lógica alternativa se a informação já existe na fonte
 * oficial"). Em TODOS os casos, o erro original (se houver) continua
 * propagando para o chamador exatamente como antes — o histórico nunca
 * engole nem transforma um erro existente.
 */
export async function runObservedOperationalSupervision(
  params: RunOperationalSupervisionOptions,
  runner: (options: RunOperationalSupervisionOptions) => Promise<OperationalSupervisionReport> = runOperationalSupervision,
): Promise<OperationalSupervisionReport> {
  const triggerSource: SupervisionRunTriggerSource = params.triggeredBy === 'scheduler' ? 'scheduler' : 'manual';
  const run = await createSupervisionRun(triggerSource, params.actorUserId);
  const startedAtMs = Date.now();

  try {
    const report = await runGuardedOperationalSupervision(params, runner);
    const finishedAt = new Date();
    await finalizeSupervisionRun(run.id, {
      status: report.failed > 0 ? 'completed_with_failures' : 'succeeded',
      finishedAt,
      durationMs: finishedAt.getTime() - startedAtMs,
      report,
    });
    return report;
  } catch (error) {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAtMs;

    if (error instanceof SupervisionAlreadyRunningError) {
      // correio.md seção 6 — lock ocupado é observabilidade, não erro:
      // registrado como `skipped_already_running`, mas o CONTRATO externo
      // (a exceção propagando para scheduler.ts/rota manual, exatamente
      // como já acontecia) permanece intacto — `throw error` abaixo,
      // fora deste `if`, cobre isso para todos os casos.
      await finalizeSupervisionRun(run.id, { status: 'skipped_already_running', finishedAt, durationMs });
    } else {
      // correio.md seção 7 — inclui falha de infraestrutura ao ADQUIRIR o
      // lock (nunca vira `skipped_already_running`, seção 5 do
      // correio.md da v3.3: só `acquired === false` gera
      // `SupervisionAlreadyRunningError`) e falha estrutural de
      // `runOperationalSupervision`. Best-effort: se o PRÓPRIO Postgres
      // estiver indisponível, este UPDATE também falharia — deixamos essa
      // falha secundária propagar por cima do erro original só se ela
      // realmente acontecer (nunca escondemos silenciosamente, mas também
      // nunca fingimos ter persistido o que não persistiu); na prática,
      // se o Postgres caiu, a MESMA falha já teria impedido
      // `pg_try_advisory_lock` de rodar, então este UPDATE já não
      // aconteceria de qualquer forma — não é um caminho alcançável na
      // prática, só documentado por completude.
      await finalizeSupervisionRun(run.id, { status: 'failed', finishedAt, durationMs, errorCode: errorCodeOf(error), errorMessage: errorMessageOf(error) });
    }

    throw error;
  }
}

export interface ListSupervisionRunsParams {
  page: number;
  limit: number;
  status?: SupervisionRunStatus;
  triggerSource?: SupervisionRunTriggerSource;
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * correio.md seção 11 — API mínima: listagem ordenada por
 * `started_at DESC` (default), filtros de status/origem/período,
 * paginação. Nenhuma busca textual.
 */
export async function listSupervisionRuns(params: ListSupervisionRunsParams): Promise<{ rows: SupervisionRunRow[]; total: number }> {
  const conditions = [
    params.status ? eq(agentOperationalSupervisionRuns.status, params.status) : undefined,
    params.triggerSource ? eq(agentOperationalSupervisionRuns.triggerSource, params.triggerSource) : undefined,
    params.dateFrom ? gte(agentOperationalSupervisionRuns.startedAt, params.dateFrom) : undefined,
    params.dateTo ? lte(agentOperationalSupervisionRuns.startedAt, params.dateTo) : undefined,
  ].filter((condition) => condition !== undefined);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentOperationalSupervisionRuns)
      .where(where)
      .orderBy(desc(agentOperationalSupervisionRuns.startedAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db.select({ total: count() }).from(agentOperationalSupervisionRuns).where(where),
  ]);

  return { rows, total: Number(total) };
}

export async function getSupervisionRunById(id: number): Promise<SupervisionRunRow | null> {
  const [row] = await db.select().from(agentOperationalSupervisionRuns).where(eq(agentOperationalSupervisionRuns.id, id)).limit(1);
  return row ?? null;
}
