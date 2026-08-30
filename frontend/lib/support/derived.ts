import type { TicketStatus } from "@/types/support";

const TERMINAL_STATUSES: TicketStatus[] = ["resolved", "closed", "cancelled"];

export type SlaState = "on_track" | "near_due" | "overdue";

const NEAR_DUE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h

/**
 * Seção 40: "Dentro do prazo" / "Próximo do vencimento" / "Atrasado" —
 * sempre derivado a partir de sla_due_at + status, nunca um estado
 * persistido. Espelha isOverdue calculado no backend (ver
 * backend/src/routes/support/helpers.ts) com um estágio intermediário para
 * a UI.
 */
export function slaState(
  ticket: { status: TicketStatus; slaDueAt: string | null },
  now: Date = new Date(),
): SlaState | null {
  if (!ticket.slaDueAt || TERMINAL_STATUSES.includes(ticket.status)) {
    return null;
  }

  const dueAt = new Date(ticket.slaDueAt);
  if (Number.isNaN(dueAt.getTime())) return null;

  const remainingMs = dueAt.getTime() - now.getTime();

  if (remainingMs < 0) return "overdue";
  if (remainingMs <= NEAR_DUE_THRESHOLD_MS) return "near_due";
  return "on_track";
}
