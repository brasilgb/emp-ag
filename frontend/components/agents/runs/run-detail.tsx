"use client";

import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useJobRunDetail, useJobRunLineage } from "@/hooks/agents/use-operations";
import { formatDateTime } from "@/lib/agents/format";
import { jobTriggerTypeLabel } from "@/lib/agents/derived";
import type { AgentJobRun, AutonomyBlock } from "@/types/agents";

import { ActionDecisionBadge, ActionPlanItemStatusBadge, ActionRiskBadge, AutonomyBlockReasonBadge, JobRunStatusBadge } from "../status-badge";

// Agentes v1.6 (correio.md seções 4/5) — Execution Timeline + Chain View
// numa única tela: Job → Run → Action Plan → Plan Items → Events
// publicados → Runs causados diretamente (timeline, GET .../detail) e a
// cadeia causal inteira a partir da raiz (chain, GET .../lineage).
export function RunDetail({ runId }: { runId: number }) {
  const detail = useJobRunDetail(runId);
  const lineage = useJobRunLineage(runId);

  if (detail.isLoading) return <LoadingState label="Carregando execução..." />;
  if (detail.isError || !detail.data) return <ErrorState onRetry={() => detail.refetch()} />;

  const { run, actionPlan, planItems, causedByDelivery, eventsPublished, childRuns } = detail.data.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Run #{run.id}</h3>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Job">
            <Link href={`/agents/jobs/${run.jobId}`} className="text-primary underline underline-offset-2">
              #{run.jobId}
            </Link>
          </Field>
          <Field label="Status">
            <JobRunStatusBadge status={run.status} />
          </Field>
          <Field label="Trigger">{jobTriggerTypeLabel(run.triggerType)}</Field>
          <Field label="Iniciado em">{formatDateTime(run.startedAt)}</Field>
          <Field label="Root Run">
            {run.rootExecutionId ? (
              <Link href={`/agents/runs/${run.rootExecutionId}`} className="text-primary underline underline-offset-2">
                #{run.rootExecutionId}
              </Link>
            ) : (
              "--"
            )}
          </Field>
          <Field label="Caused by Run">
            {run.causationRunId ? (
              <Link href={`/agents/runs/${run.causationRunId}`} className="text-primary underline underline-offset-2">
                #{run.causationRunId}
              </Link>
            ) : (
              "-- (raiz da cadeia)"
            )}
          </Field>
          <Field label="Depth">{run.autonomyDepth}</Field>
          <Field label="Erro">{run.errorMessage ?? "--"}</Field>
        </CardContent>
      </Card>

      {causedByDelivery ? (
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Disparado por</h3>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Event Rule #{causedByDelivery.ruleId} a partir do evento{" "}
            <Link href={`/agents/events/${causedByDelivery.eventId}`} className="text-primary underline underline-offset-2">
              #{causedByDelivery.eventId}
            </Link>
            .
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Action Plan</h3>
        </CardHeader>
        <CardContent className="p-0">
          {!actionPlan ? (
            <EmptyState title="Sem Action Plan" description="Este Run não chegou a gerar um Action Plan." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ação</TableHead>
                    <TableHead>Ferramenta</TableHead>
                    <TableHead>Risco</TableHead>
                    <TableHead>Decisão</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {planItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs">{item.actionId}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.tool}</TableCell>
                      <TableCell>
                        <ActionRiskBadge risk={item.risk} />
                      </TableCell>
                      <TableCell>
                        <ActionDecisionBadge decision={item.decision} />
                      </TableCell>
                      <TableCell>
                        <ActionPlanItemStatusBadge status={item.executionStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Eventos publicados por este Run</h3>
          </CardHeader>
          <CardContent className="p-0">
            {eventsPublished.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhum evento publicado.</p>
            ) : (
              <ul className="divide-y">
                {eventsPublished.map((event) => (
                  <li key={event.id} className="p-3 text-sm">
                    <Link href={`/agents/events/${event.id}`} className="font-mono text-xs text-primary underline underline-offset-2">
                      {event.eventType}
                    </Link>
                    <p className="text-xs text-muted-foreground">{formatDateTime(event.receivedAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Runs causados diretamente</h3>
          </CardHeader>
          <CardContent className="p-0">
            {childRuns.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhum Run causado por este.</p>
            ) : (
              <ul className="divide-y">
                {childRuns.map((child) => (
                  <li key={child.id} className="flex items-center justify-between p-3 text-sm">
                    <Link href={`/agents/runs/${child.id}`} className="text-primary underline underline-offset-2">
                      Run #{child.id} (Job #{child.jobId})
                    </Link>
                    <JobRunStatusBadge status={child.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ChainView currentRunId={run.id} isLoading={lineage.isLoading} isError={lineage.isError} data={lineage.data?.data} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function ChainView({
  currentRunId,
  isLoading,
  isError,
  data,
}: {
  currentRunId: number;
  isLoading: boolean;
  isError: boolean;
  data: { rootExecutionId: number; runs: AgentJobRun[]; blocks: AutonomyBlock[] } | undefined;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Cadeia causal inteira (a partir da raiz)</h3>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando cadeia..." />
        ) : isError || !data ? (
          <ErrorState />
        ) : (
          <div className="space-y-1 p-4">
            {[...data.runs]
              .sort((a, b) => a.autonomyDepth - b.autonomyDepth || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
              .map((chainRun) => (
                <div
                  key={chainRun.id}
                  className="flex items-center gap-2 text-sm"
                  style={{ paddingLeft: `${chainRun.autonomyDepth * 1.25}rem` }}
                >
                  <span className="text-muted-foreground">{"└─".repeat(chainRun.autonomyDepth > 0 ? 1 : 0)}</span>
                  <Link
                    href={`/agents/runs/${chainRun.id}`}
                    className={
                      chainRun.id === currentRunId
                        ? "font-semibold text-foreground"
                        : "text-primary underline underline-offset-2"
                    }
                  >
                    Run #{chainRun.id} (Job #{chainRun.jobId}, depth {chainRun.autonomyDepth})
                  </Link>
                  <JobRunStatusBadge status={chainRun.status} />
                </div>
              ))}

            {data.blocks.length > 0 ? (
              <div className="mt-3 space-y-1 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Tentativas bloqueadas nesta cadeia</p>
                {data.blocks.map((block) => (
                  <div key={block.id} className="flex items-center gap-2 text-sm" style={{ paddingLeft: `${block.attemptedDepth * 1.25}rem` }}>
                    <span className="text-muted-foreground">Job #{block.jobId}</span>
                    <AutonomyBlockReasonBadge reason={block.reason} />
                    <span className="text-xs text-muted-foreground">{formatDateTime(block.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
