import { executiveReviewRecoveryAdapter } from './executive-review-recovery.js';
import { initiativeRecoveryAdapter } from './initiative-recovery.js';
import { strategicMemoryRecoveryAdapter } from './strategic-memory-recovery.js';
import type { RecoveryAdapter } from './types.js';

/**
 * Agentes v2.4 (correio.md seção 5) — registro central e pequeno dos
 * workflows recuperáveis. O core (`recovery-service.ts`/`detector.ts`)
 * itera esta lista sem conhecer NENHUM detalhe interno de
 * Initiative/Executive Review/Strategic Memory — só chama
 * `detectStale`/`reconcile` de cada adapter.
 */
export const RECOVERY_ADAPTERS: readonly RecoveryAdapter[] = [initiativeRecoveryAdapter, executiveReviewRecoveryAdapter, strategicMemoryRecoveryAdapter];
