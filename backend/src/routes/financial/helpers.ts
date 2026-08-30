import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import { and, eq, lt, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  clients,
  financialCategories,
  financialEntries,
  financialPayments,
  projects,
} from '../../db/schema/index.js';

// Duplicado de src/routes/crm/helpers.ts e src/routes/projects/helpers.ts
// de propósito: mantém o módulo Financeiro independente dos demais, sem
// risco para as rotas/testes já existentes (mesmo racional documentado nos
// outros módulos).

export function paginationMeta({
  page,
  limit,
  total,
}: {
  page: number;
  limit: number;
  total: number;
}) {
  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  };
}

export function badRequest(reply: FastifyReply, error: ZodError) {
  return reply.code(400).send({
    error: 'invalid_request',
    message: error.issues[0]?.message ?? 'Dados inválidos.',
  });
}

export function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({
    error: 'not_found',
    message,
  });
}

export function currentUserId(request: FastifyRequest): number {
  return Number(request.user.sub);
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// Regra canônica de "vencido" para lançamentos financeiros (v1.1, seção 1
// do correio): due_date < hoje AND status = pending. due_date = hoje NUNCA
// é vencido. Única fonte de verdade — usada pelo filtro status=overdue da
// listagem, por getOverdueEntries() e pelas SUMs de financial/stats.ts, em
// vez de cada lugar reimplementar sua própria comparação (a divergência
// anterior era exatamente isso: um lugar usava `<=`, outro `<`).
export function overdueEntryCondition() {
  return and(eq(financialEntries.status, 'pending'), lt(financialEntries.dueDate, todayString()));
}

export async function getCategoryOrNull(id: number) {
  const [category] = await db
    .select()
    .from(financialCategories)
    .where(eq(financialCategories.id, id))
    .limit(1);

  return category;
}

export async function getClientOrNull(id: number) {
  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);

  return client;
}

export async function getProjectOrNull(id: number) {
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

  return project;
}

// Regra da seção 11: se projectId for informado, valida que o projeto
// existe e preenche clientId a partir dele quando ausente; se clientId vier
// junto, valida coerência entre os dois.
export async function resolveClientProject(input: {
  projectId?: number;
  clientId?: number;
}): Promise<
  | { ok: true; clientId: number | null }
  | { ok: false; code: 'invalid_project' | 'invalid_client' | 'client_project_mismatch'; message: string }
> {
  if (input.projectId !== undefined) {
    const project = await getProjectOrNull(input.projectId);

    if (!project) {
      return {
        ok: false,
        code: 'invalid_project',
        message: 'Projeto inválido ou inexistente.',
      };
    }

    if (input.clientId !== undefined && input.clientId !== project.clientId) {
      return {
        ok: false,
        code: 'client_project_mismatch',
        message: 'O cliente informado não corresponde ao cliente do projeto.',
      };
    }

    return { ok: true, clientId: project.clientId };
  }

  if (input.clientId !== undefined) {
    const client = await getClientOrNull(input.clientId);

    if (!client) {
      return {
        ok: false,
        code: 'invalid_client',
        message: 'Cliente inválido ou inexistente.',
      };
    }

    return { ok: true, clientId: input.clientId };
  }

  return { ok: true, clientId: null };
}

// Subquery escalar: total já pago de um lançamento, calculado via SQL
// agregado (nunca somando pagamentos em memória no Node).
export const paidAmountExpr = sql<string>`COALESCE((
  SELECT SUM(${financialPayments.amount})
  FROM ${financialPayments}
  WHERE ${financialPayments.entryId} = ${financialEntries.id}
), 0)`;

export interface EntryWithBalance {
  amount: string;
  paidAmount: string;
  dueDate: string;
  status: string;
  [key: string]: unknown;
}

// Adiciona paidAmount (se ainda não vier no row)/remainingAmount/isOverdue a
// uma linha de financial_entries já selecionada. paidAmount nunca é
// persistido — sempre recalculado na leitura.
export function withComputedBalance<T extends EntryWithBalance>(row: T) {
  const amount = Number(row.amount);
  const paidAmount = Number(row.paidAmount);
  const remainingAmount = Math.max(amount - paidAmount, 0);

  return {
    ...row,
    paidAmount: paidAmount.toFixed(2),
    remainingAmount: remainingAmount.toFixed(2),
    isOverdue: row.status === 'pending' && row.dueDate < todayString(),
  };
}

export async function getEntryOrNull(id: number) {
  const [entry] = await db
    .select()
    .from(financialEntries)
    .where(eq(financialEntries.id, id))
    .limit(1);

  return entry;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type { Tx };

// Equivalente a recalcProjectProgress() em routes/projects/helpers.ts:
// trava a entry (FOR UPDATE), soma os pagamentos já registrados (incluindo
// o que acabou de ser inserido pelo chamador, na mesma transação) e decide
// se o lançamento foi quitado. Deve ser chamado depois de inserir o
// pagamento, dentro da mesma transação.
export async function settleEntryPayment(tx: Tx, entryId: number) {
  const [entry] = await tx
    .select()
    .from(financialEntries)
    .where(eq(financialEntries.id, entryId))
    .for('update');

  const [{ paid }] = await tx
    .select({
      paid: sql<string>`COALESCE(SUM(${financialPayments.amount}), 0)`,
    })
    .from(financialPayments)
    .where(eq(financialPayments.entryId, entryId));

  const [{ lastPaidAt }] = await tx
    .select({
      lastPaidAt: sql<string | null>`MAX(${financialPayments.paidAt})`,
    })
    .from(financialPayments)
    .where(eq(financialPayments.entryId, entryId));

  const remaining = Number(entry.amount) - Number(paid);
  const becamePaid = remaining <= 0 && entry.status !== 'paid';

  const [updated] = await tx
    .update(financialEntries)
    .set({
      status: remaining <= 0 ? 'paid' : entry.status,
      paidAt: remaining <= 0 && lastPaidAt ? new Date(lastPaidAt) : entry.paidAt,
      updatedAt: new Date(),
    })
    .where(eq(financialEntries.id, entryId))
    .returning();

  return { entry: updated, paidAmount: paid, becamePaid };
}
