import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricRow {
  label: string;
  value: number;
  emphasis?: "default" | "warning" | "danger";
}

const EMPHASIS_STYLES: Record<NonNullable<MetricRow["emphasis"]>, string> = {
  default: "",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-red-400",
};

// Agentes v1.6 (correio.md seção 3/12) — bloco de métricas reutilizável
// entre as seções do dashboard (Jobs/Runs/Autonomous/Events/Approvals).
// Nunca calcula nada — só apresenta o que o backend já agregou.
export function MetricCard({ title, rows, className }: { title: string; rows: MetricRow[]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="space-y-0.5">
            <p className={cn("text-xl font-semibold tabular-nums", EMPHASIS_STYLES[row.emphasis ?? "default"])}>
              {row.value}
            </p>
            <p className="text-xs text-muted-foreground">{row.label}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
