/**
 * Agentes v2.1 (correio.md seção 6/7; saneamento seção 3) — cálculo
 * determinístico de progresso a partir dos Action Plan Items reais,
 * nunca um campo livre atualizado pelo LLM. Funções puras, sem
 * banco/HTTP — testáveis isoladamente.
 *
 * Partição exaustiva dos 9 valores reais de `execution_status`
 * (`agent_action_plan_items.ts`): todo item cai em exatamente um balde,
 * a soma dos 6 baldes é sempre igual a `totalItems`.
 *
 * - runningItems: pending | approved | executing — ainda "em voo", o
 *   loop do executor ainda pode pegar/já está processando.
 * - pendingApprovalItems: waiting_approval — aguardando decisão humana.
 * - completedItems: completed — sucesso real.
 * - failedItems: failed | rejected — não teve sucesso por decisão
 *   explícita (rejeitado) ou erro de execução (falhou).
 * - blockedItems: blocked — Policy Evaluator negou de verdade
 *   (impedimento estrutural real). `skipped` NUNCA entra aqui — ver
 *   `shadowedItems` abaixo.
 * - shadowedItems: skipped — investigado em código (saneamento seção
 *   3): o ÚNICO lugar que produz `execution_status='skipped'` em todo o
 *   backend é `orchestration/create-action-plan.ts`, como o status
 *   inicial de um item cuja decisão do Policy Evaluator
 *   (`action-policy-evaluator.ts`) foi `shadow`. `evaluateAction` tem
 *   EXATAMENTE duas causas reais para `decision:'shadow'` (nenhuma
 *   outra no código):
 *     1. `confidence` da ação (vinda do LLM) abaixo de
 *        `AGENT_LLM_MIN_CONFIDENCE` (padrão 0.8) — a ação não é
 *        descartada, mas não é confiável o bastante para autoexecutar
 *        nem para incomodar um aprovador humano às cegas.
 *     2. Shadow Mode global ativo + tool que muta dados
 *        (`mutatesData=true`) — tools read-only continuam executando
 *        normalmente mesmo com Shadow Mode ativo (já comprovado em
 *        `action-policy-evaluator.test.ts`).
 *   `action-plan-executor.ts` NUNCA escreve `skipped` em nenhum
 *   momento — nem no loop de execução, nem no fallback de dependência
 *   falha (esse caso vira `failed`, não `skipped`, já coberto por
 *   `action-plan-executor.test.ts`: "falha de dependência: item
 *   dependente nunca roda e fica failed"). Em ambas as causas reais,
 *   `skipped` significa "esta ação foi deliberadamente pulada por
 *   segurança/observabilidade, nunca por falta de permissão ou recurso
 *   indisponível" — uma conclusão terminal e NÃO problemática, nunca um
 *   impedimento. Por isso tem balde próprio e nunca aciona
 *   `Initiative.status='blocked'` (ver `deriveInitiativeExecutionState`;
 *   provado para as duas causas reais em
 *   `initiatives-execution-service.test.ts`).
 */
export interface InitiativeProgress {
  totalItems: number;
  completedItems: number;
  failedItems: number;
  blockedItems: number;
  pendingApprovalItems: number;
  runningItems: number;
  shadowedItems: number;
  progressPercent: number;
}

const RUNNING_STATUSES = new Set(['pending', 'approved', 'executing']);
const FAILED_STATUSES = new Set(['failed', 'rejected']);

export function computeInitiativeProgress(items: readonly { executionStatus: string }[]): InitiativeProgress {
  let completedItems = 0;
  let failedItems = 0;
  let blockedItems = 0;
  let pendingApprovalItems = 0;
  let runningItems = 0;
  let shadowedItems = 0;

  for (const item of items) {
    if (item.executionStatus === 'completed') completedItems += 1;
    else if (FAILED_STATUSES.has(item.executionStatus)) failedItems += 1;
    else if (item.executionStatus === 'blocked') blockedItems += 1;
    else if (item.executionStatus === 'skipped') shadowedItems += 1;
    else if (item.executionStatus === 'waiting_approval') pendingApprovalItems += 1;
    else if (RUNNING_STATUSES.has(item.executionStatus)) runningItems += 1;
    // Fail-safe: um execution_status desconhecido nunca desaparece da
    // contagem — cai em runningItems (nunca reportado como "concluído"
    // sem ter concluído de verdade).
    else runningItems += 1;
  }

  const totalItems = items.length;
  // Seção 6: "considerar item bloqueado ou aguardando approval como
  // concluído" é proibido — o numerador é sempre só completedItems
  // (itens `shadowed` também nunca inflam o numerador — nada realmente
  // executou).
  const progressPercent = totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100);

  return { totalItems, completedItems, failedItems, blockedItems, pendingApprovalItems, runningItems, shadowedItems, progressPercent };
}

export const INITIATIVE_EXECUTION_STATES = ['not_started', 'waiting_approval', 'running', 'blocked', 'failed', 'completed'] as const;
export type InitiativeExecutionState = (typeof INITIATIVE_EXECUTION_STATES)[number];

/**
 * Agentes v2.1 (correio.md seção 7; saneamento seção 3) — estado
 * derivado, nunca persistido como coluna própria (calculado a cada
 * leitura a partir do Action Plan real). Ordem de prioridade: algo em
 * voo sempre vence (`running`), depois aprovação pendente, depois
 * bloqueio estrutural REAL (nunca `skipped`/shadow), depois falha, só
 * então "tudo resolvido com sucesso" — que inclui itens `shadowed`
 * (decisão deliberada, não uma falha): um plano 100% `completed`+
 * `skipped` (sem nada bloqueado/falho/pendente/em voo) terminou de
 * processar sem nenhum impedimento real, então é `completed`, não
 * `blocked`. Um plano 100% `skipped` (Shadow Mode cobriu todas as
 * ações) também é `completed` pelo mesmo racional — a execução
 * terminou, deliberadamente sem mutar nada.
 */
export function deriveInitiativeExecutionState(hasActionPlan: boolean, progress: InitiativeProgress): InitiativeExecutionState {
  if (!hasActionPlan || progress.totalItems === 0) return 'not_started';
  if (progress.runningItems > 0) return 'running';
  if (progress.pendingApprovalItems > 0) return 'waiting_approval';
  if (progress.blockedItems > 0) return 'blocked';
  if (progress.failedItems > 0) return 'failed';
  if (progress.completedItems + progress.shadowedItems === progress.totalItems) return 'completed';
  // Inalcançável (as 6 categorias esgotam totalItems), mas nunca deixa a função sem retorno explícito.
  return 'running';
}
