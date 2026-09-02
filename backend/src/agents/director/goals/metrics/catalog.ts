import { and, count, eq, gte, inArray, isNotNull } from 'drizzle-orm';

import { db } from '../../../../db/index.js';
import { clients, leads, supportTickets, tasks } from '../../../../db/schema/index.js';
import { getFinancialSummary } from '../../../../routes/financial/stats.js';
import type { SignalDomain } from '../../types.js';
import type { MetricDirection } from '../types.js';

/**
 * Agentes v2.0 (correio.md secao 4: "Não permitir SQL arbitrário em
 * métricas") - catalogo determinístico, mesmo padrao de
 * agents/tool-registry.ts e agents/director/workflows/catalog.ts.
 * `metricKey` gravado em agent_director_goal_metrics DEVE existir aqui -
 * validado em goals-service.ts antes de persistir. O `evaluator` e
 * codigo backend conhecido, nunca SQL/JS produzido ou armazenado pelo
 * LLM - o LLM pode, no maximo, sugerir QUAL metrica do catalogo usar
 * (por texto), nunca como calcula-la.
 */
export interface MetricCatalogEntry {
  key: string;
  domain: SignalDomain;
  label: string;
  unit: string;
  description: string;
  defaultDirection: MetricDirection;
  /** `now` sempre injetavel - nunca `new Date()` dentro do evaluator. */
  evaluate: (params: { startDate: Date; now: Date }) => Promise<number>;
}

/**
 * Agentes v2.0 — saneamento (correio.md "4. Validar semântica de
 * crm.clients_won"): a versão original contava TODO `clients.createdAt
 * >= startDate`, sem distinguir clientes que vieram de um lead
 * convertido (ganho real no pipeline, `leads.pipeline_stages.is_won`)
 * de clientes cadastrados diretamente via `POST /crm/clients` (import/
 * cadastro manual, sem processo de venda). Isso não é "conquistado" no
 * sentido comercial.
 *
 * Corrigido para contar só clientes com um lead que aponta para eles via
 * `leads.convertedClientId` (`routes/crm/leads.ts` — `POST
 * /leads/:id/convert` sempre cria o client NA MESMA transação que marca
 * o lead como `won`, então `clients.createdAt` desses registros é
 * exatamente o instante da conversão) — nenhuma coluna/tabela nova,
 * só a FK que já existe.
 */
async function crmClientsWon({ startDate }: { startDate: Date; now: Date }): Promise<number> {
  const convertedClientIds = db
    .select({ id: leads.convertedClientId })
    .from(leads)
    .where(isNotNull(leads.convertedClientId));

  const [row] = await db
    .select({ total: count() })
    .from(clients)
    .where(and(gte(clients.createdAt, startDate), inArray(clients.id, convertedClientIds)));

  return Number(row?.total ?? 0);
}

async function financeOverdueAmount(): Promise<number> {
  const summary = await getFinancialSummary();
  return Number(summary.overdueReceivable) + Number(summary.overduePayable);
}

async function projectsTasksCompleted({ startDate }: { startDate: Date; now: Date }): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(tasks)
    .where(and(eq(tasks.status, 'done'), gte(tasks.updatedAt, startDate)));
  return Number(row?.total ?? 0);
}

async function supportTicketsResolved({ startDate }: { startDate: Date; now: Date }): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(supportTickets)
    .where(gte(supportTickets.resolvedAt, startDate));
  return Number(row?.total ?? 0);
}

export const METRIC_CATALOG: Record<string, MetricCatalogEntry> = {
  'crm.clients_won': {
    key: 'crm.clients_won',
    domain: 'crm',
    label: 'Clientes conquistados',
    unit: 'clients',
    description:
      'Número de clientes efetivamente conquistados via conversão de lead (leads.convertedClientId) desde o início do Goal — não conta clientes cadastrados diretamente (import/cadastro manual sem processo de venda).',
    defaultDirection: 'increase',
    evaluate: crmClientsWon,
  },
  'finance.overdue_amount': {
    key: 'finance.overdue_amount',
    domain: 'finance',
    label: 'Valor em atraso (a receber + a pagar)',
    unit: 'currency',
    description: 'Soma de recebíveis e pagáveis vencidos e ainda pendentes, calculada por getFinancialSummary() (mesma função de finance.get_summary).',
    defaultDirection: 'decrease',
    evaluate: financeOverdueAmount,
  },
  'projects.tasks_completed': {
    key: 'projects.tasks_completed',
    domain: 'projects',
    label: 'Tarefas concluídas',
    unit: 'tasks',
    description: 'Número de tarefas com status=done atualizadas desde o início do Goal.',
    defaultDirection: 'increase',
    evaluate: projectsTasksCompleted,
  },
  'support.tickets_resolved': {
    key: 'support.tickets_resolved',
    domain: 'support',
    label: 'Tickets resolvidos',
    unit: 'tickets',
    description: 'Número de tickets de suporte resolvidos (resolvedAt preenchido) desde o início do Goal.',
    defaultDirection: 'increase',
    evaluate: supportTicketsResolved,
  },
};

export function getMetricCatalogEntry(metricKey: string): MetricCatalogEntry | null {
  return METRIC_CATALOG[metricKey] ?? null;
}

export function listMetricCatalog(): MetricCatalogEntry[] {
  return Object.values(METRIC_CATALOG);
}
