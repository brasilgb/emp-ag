import { z } from 'zod';

import { WORKFLOW_TYPES } from './types.js';

// `z.coerce.boolean()` coercionaria qualquer string não-vazia (inclusive
// "false") para `true` — nunca usado para query params boolean neste
// projeto por esse motivo. Enum explícito + transform é o padrão seguro.
const booleanQueryFlag = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

export const runRecoveryQuerySchema = z.object({
  dryRun: booleanQueryFlag,
});

export const recoveryStaleQuerySchema = z.object({
  thresholdSeconds: z.coerce.number().int().positive().optional(),
});

export const recoveryEntityParamSchema = z.object({
  type: z.enum(WORKFLOW_TYPES),
  id: z.coerce.number().int().positive(),
});

export const recoveryEntityQuerySchema = z.object({
  dryRun: booleanQueryFlag,
});
