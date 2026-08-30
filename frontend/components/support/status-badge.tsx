import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PRIORITY_LABELS, TICKET_STATUS_LABELS } from "@/lib/support/format";
import type { SlaState } from "@/lib/support/derived";
import type { Priority, TicketStatus } from "@/types/support";

const TICKET_STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  triage: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  in_progress: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  waiting_customer: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  waiting_internal: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  resolved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

const PRIORITY_STYLES: Record<Priority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  high: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  critical: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const SLA_STATE_LABELS: Record<SlaState, string> = {
  on_track: "Dentro do prazo",
  near_due: "Próximo do vencimento",
  overdue: "Atrasado",
};

const SLA_STATE_STYLES: Record<SlaState, string> = {
  on_track: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  near_due: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  overdue: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", TICKET_STATUS_STYLES[status])}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", PRIORITY_STYLES[priority])}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

// Seção 40: visual derivado no frontend (nunca um estado persistido) — ver
// lib/support/derived.ts::slaState.
export function SlaBadge({ state }: { state: SlaState | null }) {
  if (!state) return null;

  return (
    <Badge variant="secondary" className={cn("border-transparent", SLA_STATE_STYLES[state])}>
      {SLA_STATE_LABELS[state]}
    </Badge>
  );
}
