import { z } from 'zod';

import { MAX_ACTIONS_PER_PLAN } from '../planner/schemas.js';

/*
 * Agentes v1.3 (correio.md seções 3/4) — validação de entrada do módulo
 * Jobs. Mesmo racional de schemas/agents.ts: o backend nunca confia
 * apenas na validação do frontend.
 */

const idSchema = z.coerce.number({ error: 'ID inválido.' }).int('ID inválido.').positive('ID inválido.');

export const jobIdParamSchema = z.object({ id: idSchema });
export const jobRunIdParamSchema = z.object({ id: idSchema });

export const triggerTypeSchema = z.enum(['manual', 'schedule', 'internal_event']);
export type TriggerType = z.infer<typeof triggerTypeSchema>;

// Seção 4 — só dois shapes deterministicamente validáveis, nunca cron
// arbitrário fornecido pelo LLM ou pelo usuário.
const dailyScheduleSchema = z
  .object({
    frequency: z.literal('daily'),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  })
  .strict();

const hourlyScheduleSchema = z
  .object({
    frequency: z.literal('hourly'),
    interval: z.number().int().min(1).max(24),
  })
  .strict();

export const scheduleConfigSchema = z.discriminatedUnion('frequency', [dailyScheduleSchema, hourlyScheduleSchema]);
export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;

// Catálogo interno fechado (seção 4) — vazio nesta versão de propósito:
// "criar arquitetura para o trigger, mas não inventar eventos de negócio
// que ainda não existam". Enquanto vazio, trigger_type='internal_event'
// nunca passa na validação — arquitetura pronta, sem eventos fabricados.
export const INTERNAL_EVENT_CATALOG: readonly string[] = [];

export const eventConfigSchema = z
  .object({ event: z.string().trim().min(1) })
  .strict()
  .refine((data) => INTERNAL_EVENT_CATALOG.includes(data.event), {
    message: 'Evento interno não reconhecido — nenhum evento de negócio está disponível ainda nesta versão.',
    path: ['event'],
  });

const jobLimitsShape = {
  maxRunsPerDay: z.number().int().positive().max(1000).default(24),
  maxActionsPerRun: z.number().int().positive().max(MAX_ACTIONS_PER_PLAN).default(10),
  maxOpenApprovals: z.number().int().nonnegative().max(1000).default(10),
  timeoutSeconds: z.number().int().positive().max(3600).default(60),
};

// Agentes v1.4 (correio.md seção 7) — "ativar" internal_event: um Job
// trigger_type='internal_event' NUNCA exige `eventConfig` na criação — a
// associação com o(s) evento(s) que o disparam agora vive em
// agent_event_rules (many-to-one: um Job pode ter zero ou várias regras),
// nunca num único campo fixo no Job. `eventConfig` continua existindo na
// tabela (v1.3) só como reserva para um uso futuro ainda não definido;
// criar um Job internal_event sem nenhuma regra ainda é uma situação
// válida (mesma semântica de um Job schedule sem next_run_at chegar) — a
// consistência real (nunca aceitar uma Event Rule para um event_type fora
// do catálogo ou um job_id inexistente) é garantida na criação da própria
// Event Rule (agents/events/schemas.ts), nunca aqui.
function withTriggerConfigRefinement<T extends z.ZodType<{ triggerType: TriggerType; scheduleConfig?: unknown }>>(
  schema: T,
) {
  return schema.refine((data) => data.triggerType !== 'schedule' || data.scheduleConfig !== undefined, {
    message: 'scheduleConfig é obrigatório quando triggerType="schedule".',
    path: ['scheduleConfig'],
  });
}

// agentSlug (não agentId): mesmo padrão de executeToolSchema
// (schemas/agents.ts) — a rota resolve o slug para o id real,
// nunca confia em id cru vindo do cliente.
export const createJobSchema = withTriggerConfigRefinement(
  z.object({
    name: z.string().trim().min(1, 'name é obrigatório.').max(150),
    description: z.string().trim().max(2000).optional(),
    objective: z.string().trim().min(1, 'objective é obrigatório.').max(2000),
    agentSlug: z.string().trim().min(1, 'agentSlug é obrigatório.'),
    triggerType: triggerTypeSchema,
    scheduleConfig: scheduleConfigSchema.optional(),
    eventConfig: eventConfigSchema.optional(),
    shadowMode: z.boolean().default(false),
    allowConcurrentRuns: z.boolean().default(false),
    ...jobLimitsShape,
  }).strict(),
);

// PATCH nunca aceita `status` (seção 15 — "evitar endpoint genérico que
// permita alteração arbitrária de status") nem `agentSlug` (agente do Job
// é imutável após a criação nesta versão, evita revalidar histórico de
// Runs anteriores contra um agente diferente). `triggerType` é opcional
// aqui — quando ausente, o refine abaixo passa trivialmente (só exige
// scheduleConfig quando o PATCH está de fato mudando o gatilho para
// 'schedule'; 'internal_event' nunca exige eventConfig — ver comentário
// de withTriggerConfigRefinement acima, seção 7).
export const updateJobSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(2000).optional(),
    objective: z.string().trim().min(1).max(2000).optional(),
    triggerType: triggerTypeSchema.optional(),
    scheduleConfig: scheduleConfigSchema.optional(),
    eventConfig: eventConfigSchema.optional(),
    shadowMode: z.boolean().optional(),
    allowConcurrentRuns: z.boolean().optional(),
    maxRunsPerDay: z.number().int().positive().max(1000).optional(),
    maxActionsPerRun: z.number().int().positive().max(MAX_ACTIONS_PER_PLAN).optional(),
    maxOpenApprovals: z.number().int().nonnegative().max(1000).optional(),
    timeoutSeconds: z.number().int().positive().max(3600).optional(),
  })
  .strict()
  .refine((data) => data.triggerType !== 'schedule' || data.scheduleConfig !== undefined, {
    message: 'scheduleConfig é obrigatório ao mudar triggerType para "schedule".',
    path: ['scheduleConfig'],
  });

export const listJobsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'failed', 'cancelled']).optional(),
});

export const listJobRunsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(['queued', 'planning', 'running', 'waiting_approval', 'completed', 'partial', 'failed', 'cancelled', 'blocked'])
    .optional(),
});

export const runJobSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});

// Agentes v1.5 — Granular Autonomy Switch (correio.md seção 10/18):
// endpoint dedicado (mesmo padrão de pause/resume/cancel), nunca pelo
// PATCH genérico — updateJobSchema continua sem `autonomyEnabled`.
export const setJobAutonomySchema = z.object({ enabled: z.boolean() }).strict();
