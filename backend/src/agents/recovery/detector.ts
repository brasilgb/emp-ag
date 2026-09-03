import { RECOVERY_ADAPTERS } from './registry.js';
import type { StaleCandidate } from './types.js';

/**
 * Agentes v2.4 (correio.md seção 3) — varre TODOS os adapters
 * registrados, cada um aplicando sua própria definição de "stale"
 * baseada em tempo (nunca só `status === 'draft'/'active'` — seção 3).
 * Nunca falha o scan inteiro por causa de um adapter com erro
 * (best-effort, seção 21) — um adapter que falhar é reportado, os
 * demais continuam.
 */
export async function scanStaleWorkflows(thresholdSeconds: number): Promise<{ candidates: StaleCandidate[]; errors: { workflowType: string; message: string }[] }> {
  const candidates: StaleCandidate[] = [];
  const errors: { workflowType: string; message: string }[] = [];

  for (const adapter of RECOVERY_ADAPTERS) {
    try {
      const found = await adapter.detectStale(thresholdSeconds);
      candidates.push(...found);
    } catch (error) {
      errors.push({ workflowType: adapter.workflowType, message: error instanceof Error ? error.message : 'Falha desconhecida ao detectar workflows stale.' });
    }
  }

  return { candidates, errors };
}
