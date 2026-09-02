import { and, count, eq, gte, ne } from 'drizzle-orm';

import { agentEvents, agentJobRuns, agentJobs } from '../../db/schema/index.js';
import type { Tx } from '../../routes/agents/helpers.js';
import type { RunTrigger } from '../jobs/job-runner.js';
import { effectiveValue, type SettingsSnapshot } from '../settings/resolver.js';
import { AUTONOMY_BLOCK_REASONS, type AutonomyBlockReason } from './reasons.js';

export type ResolvedCausation = {
  /** null = esta tentativa é raiz nova (self); resolvido de verdade só depois do insert do Run. */
  rootExecutionId: number | null;
  causationRunId: number | null;
  autonomyDepth: number;
};

export type GuardBlockedResult = {
  allowed: false;
  reason: AutonomyBlockReason;
  causation: ResolvedCausation;
  limit?: number;
  current?: number;
};

export type GuardAllowedResult = {
  allowed: true;
  causation: ResolvedCausation;
  /** true quando esta execução é o trial de um circuito half_open — o caller deve tratar falha/sucesso de forma especial (agents/autonomy/circuit.ts). */
  circuitTrial: boolean;
};

export type GuardResult = GuardAllowedResult | GuardBlockedResult;

/**
 * Resolução pura de causação/depth (correio.md seção 4) — sem I/O. Trigger
 * `manual` nunca chega aqui (job-runner.ts nunca chama o guard para
 * manual). `schedule` é sempre raiz nova (seção 12: um Job agendado
 * rodando amanhã não é continuação da cadeia de ontem). `internal_event`
 * só herda profundidade/raiz quando o evento causador foi ele mesmo
 * publicado por um Run (agent_events.caused_by_run_id) — um evento
 * publicado por ação direta de usuário também gera uma raiz nova, nunca
 * lineage falsa (seção 14).
 */
export function resolveCausation(trigger: RunTrigger, causingEvent: typeof agentEvents.$inferSelect | null): ResolvedCausation {
  if (trigger.type !== 'internal_event' || !causingEvent || causingEvent.causedByRunId == null) {
    return { rootExecutionId: null, causationRunId: null, autonomyDepth: 0 };
  }

  return {
    rootExecutionId: causingEvent.rootExecutionId ?? causingEvent.causedByRunId,
    causationRunId: causingEvent.causedByRunId,
    autonomyDepth: (causingEvent.autonomyDepth ?? 0) + 1,
  };
}

/**
 * Autonomy Guard (correio.md seção 11) — ponto central único de decisão
 * de governance autônoma. Só chamado por agents/jobs/job-runner.ts, dentro
 * da mesma transação que já trava a linha do Job (e, quando aplicável, a
 * linha do Run raiz — ver comentário de lock order em job-runner.ts) —
 * nunca duplicado no Event Processor/Scheduler. NUNCA executa Tool, NUNCA
 * decide policy/approval — só permite ou bloqueia o início do Run.
 *
 * Ordem de avaliação (documentada e coberta por teste —
 * agents/autonomy/guard.test.ts): global switch (checado por
 * agents/jobs/job-runner.ts ANTES de entrar aqui, comportamento v1.3/v1.4
 * intocado) → job autonomy switch → event rule enabled (já garantido
 * upstream por agents/events/event-processor.ts, que só busca regras
 * `enabled=true` — nunca duplicado aqui) → circuit breaker → depth →
 * cycle → chain budget → rate limit.
 *
 * Agentes v1.7 — `settings` é um `SettingsSnapshot` já resolvido pelo
 * chamador (job-runner.ts, uma vez por Run, mesmo lock da linha do Job —
 * correio.md "Importante: consistência temporal") via
 * agents/settings/resolver.ts. O guard nunca lê `config/env.ts` nem a
 * tabela de settings diretamente — só consome o snapshot já resolvido,
 * único ponto de leitura centralizado.
 */
export async function evaluateAutonomousExecution(params: {
  tx: Tx;
  job: typeof agentJobs.$inferSelect;
  trigger: RunTrigger;
  causingEvent: typeof agentEvents.$inferSelect | null;
  settings: SettingsSnapshot;
}): Promise<GuardResult> {
  const { tx, job, trigger, causingEvent, settings } = params;
  const causation = resolveCausation(trigger, causingEvent);

  // 1) Job autonomy switch (seção 10).
  if (!job.autonomyEnabled) {
    return { allowed: false, reason: 'autonomy_job_disabled', causation };
  }

  // 2) Circuit breaker (seção 9) — estado lido da linha já travada por
  // quem chamou (job já veio de um SELECT ... FOR UPDATE). A transição
  // para half_open só é PERSISTIDA no final desta função, depois que TODOS
  // os demais checks (depth/cycle/budget/rate) também passarem — nunca
  // eager: se esta mesma tentativa fosse bloqueada por outro motivo logo
  // em seguida, um "half_open" gravado cedo demais deixaria o circuito
  // travado (nenhum Run real para depois fechá-lo ou reabri-lo).
  let circuitTrial = false;

  if (job.circuitState === 'open') {
    const cooldownMs = effectiveValue(settings, 'circuit.cooldownSeconds') * 1000;
    const openedAt = job.circuitOpenedAt?.getTime() ?? 0;

    if (Date.now() - openedAt < cooldownMs) {
      return { allowed: false, reason: 'autonomy_circuit_open', causation };
    }

    // Cooldown esgotado: esta tentativa é o trial controlado (seção 9:
    // "permitir tentativa controlada", singular). Concorrência: como toda
    // avaliação roda sob o mesmo lock de linha do Job, nenhuma outra
    // chamada pode intercalar entre esta leitura e o commit final.
    circuitTrial = true;
  } else if (job.circuitState === 'half_open') {
    // Já existe um trial em andamento — um segundo gatilho autônomo
    // concorrente é bloqueado, não empilhado.
    return { allowed: false, reason: 'autonomy_circuit_open', causation };
  }

  // 3) Depth (seção 5).
  const maxDepth = effectiveValue(settings, 'autonomy.maxDepth');
  if (causation.autonomyDepth > maxDepth) {
    return {
      allowed: false,
      reason: 'autonomy_depth_exceeded',
      causation,
      limit: maxDepth,
      current: causation.autonomyDepth,
    };
  }

  // 4) Cycle detection (seção 6) — chave root_execution_id + job_id, só
  // avaliada dentro de uma cadeia já iniciada (raiz nova nunca colide).
  if (causation.rootExecutionId !== null) {
    const [existing] = await tx
      .select({ id: agentJobRuns.id })
      .from(agentJobRuns)
      .where(and(eq(agentJobRuns.rootExecutionId, causation.rootExecutionId), eq(agentJobRuns.jobId, job.id)))
      .limit(1);

    if (existing) {
      return { allowed: false, reason: 'autonomous_cycle_detected', causation };
    }
  }

  // 5) Chain budget (seção 7) — contagem sob o lock da linha raiz (feito
  // por quem chamou antes desta função, ver job-runner.ts), atômica por
  // construção.
  if (causation.rootExecutionId !== null) {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(agentJobRuns)
      .where(eq(agentJobRuns.rootExecutionId, causation.rootExecutionId));

    // A própria raiz já conta: job-runner.ts aponta root_execution_id para
    // o próprio id logo após inserir o primeiro Run de uma cadeia nova
    // (nunca fica NULL depois de criado — NULL só existe entre o insert e
    // esse update, dentro da mesma transação), então esta contagem já
    // inclui a raiz, sem necessidade de +1.
    const maxRunsPerChain = effectiveValue(settings, 'chain.maxRunsPerAutonomyChain');
    if (total >= maxRunsPerChain) {
      return {
        allowed: false,
        reason: 'autonomy_chain_budget_exceeded',
        causation,
        limit: maxRunsPerChain,
        current: total,
      };
    }
  }

  // 6) Rate limit por Job (seção 8) — precedência job override (tabela
  // agent_operational_settings, com ponte de compatibilidade para a
  // coluna legada) → global → default, já resolvida por
  // agents/settings/resolver.ts. Coberto pelo lock da linha do Job (já
  // travada por quem chamou), sem lock adicional.
  const rateLimit = effectiveValue(settings, 'rate.autonomyLimit');
  const rateWindowSeconds = effectiveValue(settings, 'rate.autonomyWindowSeconds');
  const windowStart = new Date(Date.now() - rateWindowSeconds * 1000);

  const [{ total: autonomousRunsInWindow }] = await tx
    .select({ total: count() })
    .from(agentJobRuns)
    .where(
      and(eq(agentJobRuns.jobId, job.id), ne(agentJobRuns.triggerType, 'manual'), gte(agentJobRuns.createdAt, windowStart)),
    );

  if (autonomousRunsInWindow >= rateLimit) {
    return {
      allowed: false,
      reason: 'autonomous_rate_limit_exceeded',
      causation,
      limit: rateLimit,
      current: autonomousRunsInWindow,
    };
  }

  if (circuitTrial) {
    await tx.update(agentJobs).set({ circuitState: 'half_open' }).where(eq(agentJobs.id, job.id));
  }

  return { allowed: true, causation, circuitTrial };
}

// Reexportado só para consumo de teste/rota sem duplicar o import do enum.
export { AUTONOMY_BLOCK_REASONS };
