import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClientStatus, LeadStatus } from "@/types/crm";

const LEAD_STATUS_STYLES: Record<LeadStatus, string> = {
  open: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  won: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  lost: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const CLIENT_STATUS_STYLES: Record<ClientStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  inactive: "bg-muted text-muted-foreground",
};

export function LeadStatusBadge({ status, label }: { status: LeadStatus; label: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", LEAD_STATUS_STYLES[status])}>
      {label}
    </Badge>
  );
}

export function ClientStatusBadge({ status, label }: { status: ClientStatus; label: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", CLIENT_STATUS_STYLES[status])}>
      {label}
    </Badge>
  );
}
