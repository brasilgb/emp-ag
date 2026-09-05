"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useOperationalSlaAnalytics } from "@/hooks/agents/use-operations";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { formatOperationalDuration, formatOperationalPercentage } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { cn } from "@/lib/utils";
import { OPERATIONAL_SEVERITIES, type OperationalSeverity, type OperationalSlaSeverityBreakdown } from "@/types/agents";

import { OperationalSeverityBadge } from "../status-badge";

// Agentes v4.2 (correio.md "Operational SLA Analytics & Performance
// Visibility", seção 3) — presets sugeridos + período personalizado.
// Todo cálculo de `from`/`to` acontece aqui (fronteira de apresentação);
// o backend nunca recebe um período implícito quando um preset é
// escolhido (sempre ISO explícito), coerente com a seção 3: "toda
// métrica agregada deve possuir período explícito".
const PERIOD_PRESETS = [
  { value: "24h", label: "24 horas", hours: 24 },
  { value: "7d", label: "7 dias", hours: 7 * 24 },
  { value: "30d", label: "30 dias", hours: 30 * 24 },
  { value: "custom", label: "Período personalizado", hours: null },
] as const;
type PeriodPreset = (typeof PERIOD_PRESETS)[number]["value"];

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface StatTileProps {
  label: string;
  value: string;
  emphasis?: "default" | "warning" | "danger";
}

const STAT_EMPHASIS_STYLES: Record<NonNullable<StatTileProps["emphasis"]>, string> = {
  default: "",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-red-400",
};

// Mesmo idioma visual de `metric-card.tsx` (MetricCard), mas aceitando
// `value` já FORMATADO como string (duração/percentual) — MetricCard é
// compartilhado por outras seções e só aceita `number` bruto; nenhuma
// lógica de negócio aqui, só apresentação (correio.md seção 17: "não
// inserir lógica de negócio nos componentes React" — os valores já vêm
// prontos do backend/formatadores puros de derived.ts).
function StatTile({ label, value, emphasis = "default" }: StatTileProps) {
  return (
    <div className="space-y-0.5">
      <p className={cn("text-xl font-semibold tabular-nums", STAT_EMPHASIS_STYLES[emphasis])}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StatCard({ title, tiles, className }: { title: string; tiles: StatTileProps[]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <StatTile key={tile.label} {...tile} />
        ))}
      </CardContent>
    </Card>
  );
}

function severityBreakdownRow(severity: OperationalSeverity, row: OperationalSlaSeverityBreakdown) {
  return (
    <TableRow key={severity}>
      <TableCell>
        <OperationalSeverityBadge severity={severity} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{row.detected}</TableCell>
      <TableCell className="text-right tabular-nums">{row.closed}</TableCell>
      <TableCell className="text-right tabular-nums">{row.withinSla}</TableCell>
      <TableCell className="text-right tabular-nums">{row.outsideSla}</TableCell>
      <TableCell className="text-right tabular-nums">{formatOperationalPercentage(row.breachRate)}</TableCell>
    </TableRow>
  );
}

/**
 * Agentes v4.2 (correio.md "Operational SLA Analytics & Performance
 * Visibility") — evolui a MESMA seção de Supervisão Operacional (nunca
 * uma página nova): indicadores agregados de SLA/desempenho sobre os
 * incidentes já detectados/revisados/atribuídos pela v3.5/v3.6/v3.8/v4.1.
 * Nenhum cálculo acontece aqui — cada número já vem pronto do backend
 * (`GET /agents/operations/sla-analytics`); esta seção só formata e
 * organiza a apresentação (seção 16). Nenhuma biblioteca de gráficos
 * adicionada (seção 16: "se o projeto ainda não possuir, não adicionar
 * dependência pesada apenas para esta versão") — a tendência temporal
 * (seção 12) é uma tabela simples.
 */
export function SlaAnalyticsSection() {
  const [preset, setPreset] = useState<PeriodPreset>("7d");
  const [severity, setSeverity] = useState<OperationalSeverity | "all">("all");
  const [customFrom, setCustomFrom] = useState(() => toDateInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [customTo, setCustomTo] = useState(() => toDateInputValue(new Date()));

  const { from, to } = useMemo(() => {
    if (preset === "custom") {
      // Fim do dia selecionado (23:59:59.999) — um período personalizado
      // de "hoje até hoje" deveria cobrir o dia inteiro, não só o
      // instante `00:00:00` (seção 3: período sempre EXPLÍCITO, nunca
      // ambíguo).
      const parsedFrom = new Date(`${customFrom}T00:00:00.000Z`);
      const parsedTo = new Date(`${customTo}T23:59:59.999Z`);
      return { from: parsedFrom.toISOString(), to: parsedTo.toISOString() };
    }
    const presetConfig = PERIOD_PRESETS.find((item) => item.value === preset);
    const hours = presetConfig?.hours ?? 7 * 24;
    const now = new Date();
    return { from: new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
  }, [preset, customFrom, customTo]);

  const analytics = useOperationalSlaAnalytics({ from, to, severity: severity === "all" ? undefined : severity });
  const usersQuery = useUsersDirectory();

  function assigneeName(userId: number): string {
    return usersQuery.data?.data.find((user) => user.id === userId)?.name ?? `Usuário #${userId}`;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Período</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={preset} onValueChange={(value) => setPreset((value as PeriodPreset) ?? "7d")}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_PRESETS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {preset === "custom" ? (
              <>
                <Input type="date" className="w-40" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} />
                <span className="text-sm text-muted-foreground">até</span>
                <Input type="date" className="w-40" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} />
              </>
            ) : null}

            <Select value={severity} onValueChange={(value) => setSeverity((value as OperationalSeverity | "all") ?? "all")}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda severidade</SelectItem>
                {OPERATIONAL_SEVERITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        {analytics.data ? (
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              {formatDateTime(analytics.data.data.period.from)} — {formatDateTime(analytics.data.data.period.to)}
            </p>
          </CardContent>
        ) : null}
      </Card>

      {analytics.isLoading ? (
        <LoadingState label="Carregando analytics de SLA..." />
      ) : analytics.isError || !analytics.data ? (
        <ErrorState onRetry={() => analytics.refetch()} />
      ) : (
        (() => {
          const data = analytics.data.data;
          const hasAnyIncident = data.incidents.detected > 0 || data.incidents.closed > 0;

          return (
            <>
              <StatCard
                title="SLA Performance"
                tiles={[
                  { label: "Incidentes detectados", value: String(data.incidents.detected) },
                  { label: "Incidentes encerrados", value: String(data.incidents.closed) },
                  { label: "Dentro do SLA", value: String(data.sla.completedWithinSla) },
                  { label: "Fora do SLA", value: String(data.sla.completedOutsideSla), emphasis: data.sla.completedOutsideSla > 0 ? "danger" : "default" },
                  { label: "Breach rate", value: formatOperationalPercentage(data.sla.breachRate), emphasis: (data.sla.breachRate ?? 0) > 0 ? "warning" : "default" },
                ]}
              />

              <StatCard
                title="Response Times"
                tiles={[
                  { label: "Tempo médio até acknowledgement", value: formatOperationalDuration(data.acknowledgement.averageSeconds) },
                  { label: "Mediana até acknowledgement", value: formatOperationalDuration(data.acknowledgement.medianSeconds) },
                  { label: "Tempo médio até resolução", value: formatOperationalDuration(data.resolution.averageSeconds) },
                  { label: "Mediana até resolução", value: formatOperationalDuration(data.resolution.medianSeconds) },
                ]}
              />

              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Current Open SLA</h3>
                  <p className="text-xs text-muted-foreground">
                    Fotografia dos incidentes ainda abertos NO MOMENTO da consulta — independente do período selecionado acima e do breach rate histórico (seção &ldquo;SLA Performance&rdquo;).
                  </p>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-4">
                  <StatTile label="Dentro do prazo" value={String(data.openSla.withinSla)} />
                  <StatTile label="Próximo do vencimento" value={String(data.openSla.warning)} emphasis={data.openSla.warning > 0 ? "warning" : "default"} />
                  <StatTile label="Vencido" value={String(data.openSla.breached)} emphasis={data.openSla.breached > 0 ? "danger" : "default"} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Por severidade</h3>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Severidade</TableHead>
                          <TableHead className="text-right">Detectados</TableHead>
                          <TableHead className="text-right">Encerrados</TableHead>
                          <TableHead className="text-right">Dentro</TableHead>
                          <TableHead className="text-right">Fora</TableHead>
                          <TableHead className="text-right">Breach</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>{OPERATIONAL_SEVERITIES.map((sev) => severityBreakdownRow(sev, data.bySeverity[sev]))}</TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Tendência diária</h3>
                </CardHeader>
                <CardContent>
                  {data.trend.length === 0 ? (
                    <EmptyState title="Sem dados no período" description="Nenhum ponto de tendência para o período/severidade selecionados." />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead className="text-right">Detectados</TableHead>
                            <TableHead className="text-right">Encerrados</TableHead>
                            <TableHead className="text-right">Dentro do SLA</TableHead>
                            <TableHead className="text-right">Fora do SLA</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.trend.map((point) => (
                            <TableRow key={point.date}>
                              <TableCell>{point.date}</TableCell>
                              <TableCell className="text-right tabular-nums">{point.detected}</TableCell>
                              <TableCell className="text-right tabular-nums">{point.closed}</TableCell>
                              <TableCell className="text-right tabular-nums">{point.withinSla}</TableCell>
                              <TableCell className="text-right tabular-nums">{point.outsideSla}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Por responsável</h3>
                  <p className="text-xs text-muted-foreground">
                    Só incidentes cujo responsável no momento do fechamento é inequívoco — fatos, nunca uma pontuação ou ranking de desempenho.
                  </p>
                </CardHeader>
                <CardContent>
                  {!hasAnyIncident ? (
                    <EmptyState title="Sem incidentes no período" description="Nenhum incidente detectado ou encerrado no período/severidade selecionados." />
                  ) : data.byAssignee.length === 0 ? (
                    <EmptyState title="Nenhum responsável inequívoco" description="Os incidentes encerrados neste período não têm um responsável claro no momento do fechamento." />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Responsável</TableHead>
                            <TableHead className="text-right">Encerrados</TableHead>
                            <TableHead className="text-right">Dentro</TableHead>
                            <TableHead className="text-right">Fora</TableHead>
                            <TableHead className="text-right">Breach</TableHead>
                            <TableHead className="text-right">Resolução (média)</TableHead>
                            <TableHead className="text-right">Resolução (mediana)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.byAssignee.map((row) => (
                            <TableRow key={row.userId}>
                              <TableCell>{row.displayName ?? assigneeName(row.userId)}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.closed}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.withinSla}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.outsideSla}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatOperationalPercentage(row.breachRate)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatOperationalDuration(row.averageResolutionSeconds)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatOperationalDuration(row.medianResolutionSeconds)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          );
        })()
      )}
    </div>
  );
}
