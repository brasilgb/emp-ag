"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useDirectorBrief } from "@/hooks/agents/use-director";
import { formatDateTime } from "@/lib/agents/format";
import { signalDomainLabel } from "@/lib/agents/derived";

import { DomainSection } from "./domain-section";

const DOMAIN_ORDER = ["crm", "projects", "finance", "support", "agents"] as const;

/**
 * Agentes v1.8 (correio.md seção 15) — "mesa do diretor": resumo +
 * seções por domínio, nunca outro dashboard genérico de métricas. Um
 * único fetch (GET /agents/director/brief), já agregado e classificado
 * no backend.
 */
export function DirectorDashboard() {
  const { data, isLoading, isError, refetch } = useDirectorBrief();

  if (isLoading) return <LoadingState label="Carregando briefing operacional..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const brief = data.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Resumo — {formatDateTime(brief.generatedAt)}</h3>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Críticos" value={brief.summary.critical} tone="danger" />
          <Stat label="Avisos" value={brief.summary.warning} tone="warning" />
          <Stat label="Atenção" value={brief.summary.attention} tone="default" />
          <Stat label="Info" value={brief.summary.info} tone="default" />
        </CardContent>
        {brief.status === "partial" ? (
          <CardContent className="pt-0 text-xs text-amber-700 dark:text-amber-400">
            Briefing parcial — falha ao consultar:{" "}
            {brief.errors.map((error) => signalDomainLabel(error.domain)).join(", ")}. Os demais domínios estão
            completos.
          </CardContent>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {DOMAIN_ORDER.map((domain) => (
          <DomainSection key={domain} domain={domain} signals={brief.domains[domain]} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "default" | "warning" | "danger" }) {
  const toneClass =
    tone === "danger"
      ? "text-red-700 dark:text-red-400"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : "text-foreground";

  return (
    <div>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
