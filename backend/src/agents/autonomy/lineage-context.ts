import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Agentes v1.5 — Lineage propagation (correio.md seção 13). Contexto de
 * execução implícito via AsyncLocalStorage: `runAgentJob`
 * (agents/jobs/job-runner.ts) entra neste contexto antes de planejar e
 * executar um Run; `publishAgentEvent` (agents/events/publisher.ts) lê o
 * contexto atual (se houver) para carimbar o evento com sua causa real.
 *
 * Por que ALS em vez de threadear um parâmetro por toda a cadeia de
 * domínio (routes/{crm,projects,financial,support}/*.ts): o mesmo core
 * transacional (ex.: createInternalTask) é chamado tanto por uma rota HTTP
 * comum quanto por uma tool executada dentro de um Run — threadear
 * lineage por parâmetro exigiria mudar a assinatura de ~10 funções de
 * domínio só para carregar um dado de auditoria. ALS resolve isso sem
 * tocar nenhuma dessas assinaturas, e funciona para HTTP, scheduler e
 * Event Processor porque os três rodam no mesmo processo Node — a cadeia
 * inteira (runAgentJob → planEvaluateAndPersistActionPlan →
 * executeActionPlan → tool.run → domínio → publishAgentEvent) é uma única
 * árvore de promises dentro do mesmo `AsyncLocalStorage.run()`.
 *
 * Persistência continua obrigatória (seção 13): o contexto nunca é a
 * fonte de verdade por si — ele só popula colunas reais em agent_events no
 * momento do insert (agents/events/publisher.ts); depois disso o dado vive
 * no banco, não na memória do processo.
 *
 * Limitação documentada (débito técnico, ver relatório de entrega): se o
 * Event Processor/Scheduler algum dia virarem um processo separado (ex.:
 * worker n8n dedicado, mencionado em agents/jobs/scheduler.ts), ALS deixa
 * de propagar — a solução nesse cenário precisaria de metadata explícita
 * (ex.: no payload do job de fila), não deste módulo.
 */

export interface LineageExecutionContext {
  /** Sempre o id resolvido da raiz da cadeia (nunca null aqui — já resolvido antes de entrar no contexto). */
  rootExecutionId: number;
  /** Run atual, causador de qualquer evento publicado dentro deste contexto. */
  causationRunId: number;
  /** Profundidade do Run atual (não do próximo Run que ele possa causar). */
  autonomyDepth: number;
}

const storage = new AsyncLocalStorage<LineageExecutionContext>();

export function runWithLineage<T>(context: LineageExecutionContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function getLineageContext(): LineageExecutionContext | undefined {
  return storage.getStore();
}
