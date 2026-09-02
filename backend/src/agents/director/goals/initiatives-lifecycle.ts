import { AgentError } from '../../errors.js';

import { INITIATIVE_STATUSES, type InitiativeStatus } from './types.js';

/**
 * Agentes v2.1 (correio.md seção 1) — única fonte de verdade para
 * transições de status de Initiative. Nenhuma rota/serviço deve conter
 * `if (status === ...)` de lifecycle fora daqui — sempre chamar
 * `assertInitiativeTransition`/`canTransitionInitiative`.
 *
 * `completed → proposed` e `cancelled → proposed` existem
 * exclusivamente para o mecanismo de reincidência da v2.0
 * (`review-service.ts` — `REOPENABLE_INITIATIVE_STATUSES`); nunca
 * exposto como ação humana via API, só usado pelo upsert automático do
 * Director Goal Review. Há um teste (`initiatives-lifecycle.test.ts`)
 * que garante que `REOPENABLE_INITIATIVE_STATUSES` nunca diverge deste
 * mapa — uma única fonte de verdade, mesmo vivendo em dois arquivos.
 */
const INITIATIVE_TRANSITIONS: Record<InitiativeStatus, readonly InitiativeStatus[]> = {
  proposed: ['approved', 'cancelled'],
  approved: ['active', 'cancelled'],
  active: ['blocked', 'completed', 'cancelled'],
  blocked: ['active', 'cancelled'],
  completed: ['proposed'],
  cancelled: ['proposed'],
};

/** Estados que aceitam pelo menos uma transição de saída "para frente" (não-terminal do ponto de vista de fluxo normal). */
export function isInitiativeStatus(value: string): value is InitiativeStatus {
  return (INITIATIVE_STATUSES as readonly string[]).includes(value);
}

// `from` recebe `string` (não `InitiativeStatus`) de propósito: a coluna
// `status` no banco é um `varchar` não tipado no nível do Drizzle
// ($inferSelect nunca estreita para o union de status) — nunca confiar
// cegamente com um cast, sempre validar aqui, no único lugar que decide
// lifecycle.
export function canTransitionInitiative(from: string, to: InitiativeStatus): boolean {
  return isInitiativeStatus(from) && INITIATIVE_TRANSITIONS[from].includes(to);
}

export function assertInitiativeTransition(from: string, to: InitiativeStatus): void {
  if (!canTransitionInitiative(from, to)) {
    throw new AgentError('conflict', `Transição de Initiative inválida: "${from}" → "${to}".`);
  }
}
