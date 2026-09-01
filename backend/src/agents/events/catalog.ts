import { z } from 'zod';

/**
 * Agentes v1.4 — Event Engine (correio.md seção 3). Catálogo fechado de
 * eventos internos: único ponto de verdade sobre quais tipos de evento
 * existem, sua versão, o schema Zod `.strict()` do payload e quais campos
 * do payload podem ser usados em filtro de Event Rule
 * (agents/events/filters.ts). O LLM NUNCA participa disto — nenhum tipo de
 * evento é inventado ou decidido em tempo de execução, tudo é código
 * estático revisado.
 *
 * Cada entrada corresponde a uma operação de domínio REAL e confirmada por
 * exploração do código (nunca uma funcionalidade ainda inexistente —
 * correio.md seção 3): `project.task.overdue` e `finance.receivable.overdue`
 * ficam de fora de propósito porque são sempre derivados na leitura, sem
 * nenhum ponto de escrita real a instrumentar (ver plano de implementação).
 */

export type FilterFieldType = 'string' | 'number' | 'boolean';

export interface EventDefinition<TPayload = unknown> {
  type: string;
  version: number;
  domain: string;
  description: string;
  payloadSchema: z.ZodType<TPayload>;
  // Campos do payload que podem aparecer numa Event Rule.filters — nunca
  // um campo fora desta lista (correio.md seção 6/24).
  filterableFields: Record<string, FilterFieldType>;
}

function defineEvent<TPayload>(definition: EventDefinition<TPayload>): EventDefinition<TPayload> {
  return definition;
}

const idField = z.number().int().positive();

export const EVENT_CATALOG = {
  'crm.client.created': defineEvent({
    type: 'crm.client.created',
    version: 1,
    domain: 'crm',
    description: 'Um novo cliente foi cadastrado.',
    payloadSchema: z
      .object({
        clientId: idField,
        type: z.enum(['company', 'individual']),
        name: z.string(),
        status: z.string(),
      })
      .strict(),
    filterableFields: { type: 'string', status: 'string' },
  }),

  'crm.lead.created': defineEvent({
    type: 'crm.lead.created',
    version: 1,
    domain: 'crm',
    description: 'Um novo lead foi cadastrado.',
    payloadSchema: z
      .object({
        leadId: idField,
        name: z.string(),
        source: z.string().nullable(),
        status: z.string(),
        // Substitui "priority" do exemplo do correio.md — leads não têm
        // essa coluna no schema real (confirmado por exploração); 0-100,
        // usado como proxy determinístico de prioridade nos filtros.
        probability: z.number().int().min(0).max(100),
        pipelineStageId: idField,
        ownerUserId: idField.nullable(),
      })
      .strict(),
    filterableFields: { source: 'string', status: 'string', probability: 'number', pipelineStageId: 'number' },
  }),

  'crm.lead.stage_changed': defineEvent({
    type: 'crm.lead.stage_changed',
    version: 1,
    domain: 'crm',
    description: 'O estágio de pipeline de um lead mudou.',
    payloadSchema: z
      .object({
        leadId: idField,
        previousStageId: idField.nullable(),
        newStageId: idField,
        previousStageSlug: z.string().nullable(),
        newStageSlug: z.string(),
        isWon: z.boolean(),
        isLost: z.boolean(),
      })
      .strict(),
    filterableFields: { newStageSlug: 'string', previousStageSlug: 'string', isWon: 'boolean', isLost: 'boolean' },
  }),

  'crm.activity.created': defineEvent({
    type: 'crm.activity.created',
    version: 1,
    domain: 'crm',
    description: 'Uma atividade de CRM foi registrada em um lead ou cliente.',
    payloadSchema: z
      .object({
        activityId: idField,
        leadId: idField.nullable(),
        clientId: idField.nullable(),
        type: z.string(),
      })
      .strict(),
    filterableFields: { type: 'string' },
  }),

  'project.created': defineEvent({
    type: 'project.created',
    version: 1,
    domain: 'project',
    description: 'Um novo projeto foi criado.',
    payloadSchema: z
      .object({
        projectId: idField,
        clientId: idField,
        name: z.string(),
        status: z.string(),
        priority: z.string(),
      })
      .strict(),
    filterableFields: { status: 'string', priority: 'string' },
  }),

  'project.task.created': defineEvent({
    type: 'project.task.created',
    version: 1,
    domain: 'project',
    description: 'Uma nova tarefa foi criada em um projeto.',
    payloadSchema: z
      .object({
        taskId: idField,
        projectId: idField,
        title: z.string(),
        status: z.string(),
        priority: z.string(),
      })
      .strict(),
    filterableFields: { status: 'string', priority: 'string' },
  }),

  'project.task.updated': defineEvent({
    type: 'project.task.updated',
    version: 1,
    domain: 'project',
    description: 'Uma tarefa de projeto foi alterada.',
    payloadSchema: z
      .object({
        taskId: idField,
        projectId: idField,
        status: z.string(),
        priority: z.string(),
      })
      .strict(),
    filterableFields: { status: 'string', priority: 'string' },
  }),

  'project.task.completed': defineEvent({
    type: 'project.task.completed',
    version: 1,
    domain: 'project',
    description: 'Uma tarefa de projeto foi concluída.',
    payloadSchema: z
      .object({
        taskId: idField,
        projectId: idField,
        priority: z.string(),
      })
      .strict(),
    filterableFields: { priority: 'string' },
  }),

  'finance.receivable.created': defineEvent({
    type: 'finance.receivable.created',
    version: 1,
    domain: 'finance',
    description: 'Um novo lançamento de receita (a receber) foi criado.',
    payloadSchema: z
      .object({
        entryId: idField,
        clientId: idField.nullable(),
        amount: z.string(),
        dueDate: z.string(),
        status: z.string(),
      })
      .strict(),
    filterableFields: { status: 'string' },
  }),

  'finance.receivable.paid': defineEvent({
    type: 'finance.receivable.paid',
    version: 1,
    domain: 'finance',
    description: 'Um lançamento de receita foi totalmente quitado.',
    payloadSchema: z
      .object({
        entryId: idField,
        clientId: idField.nullable(),
        amount: z.string(),
      })
      .strict(),
    filterableFields: {},
  }),

  'support.ticket.created': defineEvent({
    type: 'support.ticket.created',
    version: 1,
    domain: 'support',
    description: 'Um novo chamado de suporte foi aberto.',
    payloadSchema: z
      .object({
        ticketId: idField,
        clientId: idField,
        priority: z.string(),
        status: z.string(),
        source: z.string(),
      })
      .strict(),
    filterableFields: { priority: 'string', status: 'string', source: 'string' },
  }),

  'support.ticket.updated': defineEvent({
    type: 'support.ticket.updated',
    version: 1,
    domain: 'support',
    description: 'Um chamado de suporte foi alterado.',
    payloadSchema: z
      .object({
        ticketId: idField,
        priority: z.string(),
        status: z.string(),
      })
      .strict(),
    filterableFields: { priority: 'string', status: 'string' },
  }),

  'support.ticket.closed': defineEvent({
    type: 'support.ticket.closed',
    version: 1,
    domain: 'support',
    description: 'Um chamado de suporte foi encerrado.',
    payloadSchema: z
      .object({
        ticketId: idField,
        priority: z.string(),
      })
      .strict(),
    filterableFields: { priority: 'string' },
  }),

  'agent.job.created': defineEvent({
    type: 'agent.job.created',
    version: 1,
    domain: 'agent',
    description: 'Um Job de agente foi criado.',
    payloadSchema: z
      .object({
        jobId: idField,
        agentId: idField,
        triggerType: z.string(),
      })
      .strict(),
    filterableFields: { triggerType: 'string' },
  }),

  'agent.job.completed': defineEvent({
    type: 'agent.job.completed',
    version: 1,
    domain: 'agent',
    description: 'Um Run de Job de agente foi concluído com sucesso.',
    payloadSchema: z
      .object({
        jobId: idField,
        runId: idField,
      })
      .strict(),
    filterableFields: {},
  }),

  'agent.job.failed': defineEvent({
    type: 'agent.job.failed',
    version: 1,
    domain: 'agent',
    description: 'Um Run de Job de agente falhou.',
    payloadSchema: z
      .object({
        jobId: idField,
        runId: idField,
        errorCode: z.string().nullable(),
      })
      .strict(),
    filterableFields: { errorCode: 'string' },
  }),
} as const satisfies Record<string, EventDefinition<any>>;

export type EventType = keyof typeof EVENT_CATALOG;

export const EVENT_TYPES = Object.keys(EVENT_CATALOG) as EventType[];

export function isEventType(value: string): value is EventType {
  return Object.prototype.hasOwnProperty.call(EVENT_CATALOG, value);
}

export function getEventDefinition(type: string): EventDefinition | undefined {
  return isEventType(type) ? EVENT_CATALOG[type] : undefined;
}
