import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ENTRY_STATUS_LABELS, ENTRY_TYPE_LABELS } from "@/lib/financial/format";
import type { FinancialEntryStatus, FinancialEntryType } from "@/types/financial";

const ENTRY_STATUS_STYLES: Record<FinancialEntryStatus, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground",
};

const ENTRY_TYPE_STYLES: Record<FinancialEntryType, string> = {
  income: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  expense: "bg-red-500/10 text-red-700 dark:text-red-400",
};

// "Atrasado" nunca é um status real (ver lib/financial/derived.ts) — quando
// isOverdue é true, sobrepomos o badge de status pendente por este, em vez
// de inventar um quarto valor de status.
export function EntryStatusBadge({
  status,
  isOverdue,
}: {
  status: FinancialEntryStatus;
  isOverdue: boolean;
}) {
  if (isOverdue) {
    return (
      <Badge variant="secondary" className="border-transparent bg-red-500/10 text-red-700 dark:text-red-400">
        Atrasado
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className={cn("border-transparent", ENTRY_STATUS_STYLES[status])}>
      {ENTRY_STATUS_LABELS[status]}
    </Badge>
  );
}

export function EntryTypeBadge({ type }: { type: FinancialEntryType }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ENTRY_TYPE_STYLES[type])}>
      {ENTRY_TYPE_LABELS[type]}
    </Badge>
  );
}
