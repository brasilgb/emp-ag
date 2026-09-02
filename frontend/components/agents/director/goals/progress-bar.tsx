import { cn } from "@/lib/utils";
import type { GoalHealth } from "@/types/agents";

const HEALTH_BAR_COLORS: Record<GoalHealth, string> = {
  on_track: "bg-emerald-500",
  attention: "bg-blue-500",
  at_risk: "bg-amber-500",
  critical: "bg-red-500",
  unknown: "bg-muted-foreground/40",
};

/**
 * Agentes v2.0 (correio.md seção 18) — barra de progresso simples,
 * colorida pelo health real do Goal (nunca inventado) — nenhuma
 * dependência de gráfico nova, só um indicador visual leve.
 */
export function GoalProgressBar({ percent, health, className }: { percent: number; health: GoalHealth; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-all", HEALTH_BAR_COLORS[health])} style={{ width: `${clamped}%` }} />
    </div>
  );
}
