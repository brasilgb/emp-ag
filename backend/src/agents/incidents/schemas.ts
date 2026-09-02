import { z } from 'zod';

// Agentes v1.6 (correio.md seção 6) — Incident Center. Tipos derivados
// exclusivamente dos dados já existentes (seção 6: "não criar
// automaticamente um sistema paralelo de incidentes se os dados
// existentes forem suficientes"). Os 5 primeiros mapeiam 1:1 para
// agent_autonomy_blocks.reason (agents/autonomy/reasons.ts) — exceto
// `autonomy_job_disabled`, que é ação deliberada do operador, nunca uma
// anomalia. `job_repeated_failure` e `event_delivery_failed` são
// projeções sobre agent_job_runs/agent_event_deliveries.
export const INCIDENT_TYPES = [
  'autonomy_circuit_open',
  'autonomous_cycle_detected',
  'autonomy_depth_exceeded',
  'autonomy_chain_budget_exceeded',
  'autonomous_rate_limit_exceeded',
  'job_repeated_failure',
  'event_delivery_failed',
] as const;

export const incidentTypeSchema = z.enum(INCIDENT_TYPES);
export type IncidentType = z.infer<typeof incidentTypeSchema>;

export const listIncidentsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    type: incidentTypeSchema.optional(),
    jobId: z.coerce.number().int().positive().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
