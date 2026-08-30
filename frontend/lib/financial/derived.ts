import type { FinancialEntryStatus } from "@/types/financial";

/**
 * "Atrasado" é sempre uma condição derivada (status = pending AND due_date <
 * hoje) — nunca um status novo no banco. Espelha a mesma regra calculada no
 * backend (ver backend/src/routes/financial/helpers.ts) para uso local
 * (ex.: feedback imediato antes de um refetch). Comparação por data (sem
 * horário) para que "vence hoje" nunca conte como atrasado.
 */
export function isEntryOverdue(
  entry: { dueDate: string; status: FinancialEntryStatus },
  today: Date = new Date(),
): boolean {
  if (entry.status !== "pending") return false;

  const due = new Date(`${entry.dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return false;

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return due.getTime() < startOfToday.getTime();
}

/**
 * Um lançamento só aceita pagamento se não estiver cancelado e ainda tiver
 * saldo restante — mesma regra do backend (seção 7/29 do escopo).
 */
export function canRegisterPayment(entry: {
  status: FinancialEntryStatus;
  remainingAmount: string;
}): boolean {
  return entry.status !== "cancelled" && Number(entry.remainingAmount) > 0;
}
