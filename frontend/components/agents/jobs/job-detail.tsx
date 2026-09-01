"use client";

import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import {
  useAgentJob,
  useAgentJobRuns,
  useCancelAgentJob,
  usePauseAgentJob,
  useResumeAgentJob,
  useRunAgentJob,
} from "@/hooks/agents/use-agent-jobs";
import { formatDateTime } from "@/lib/agents/format";
import { jobTriggerTypeLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";

import { JobRunStatusBadge, JobStatusBadge } from "../status-badge";

/**
 * Correio.md v1.3 seção 17 — detalhe: mostra a cadeia Job → Run → Action
 * Plan → Actions → Approval/Execution (o link "Ver plano" leva à mesma
 * tela de detalhe de Action Plan já existente da v1.2, que por sua vez já
 * mostra risk/decision/execution status/resultado por ação e o link para
 * aprovações pendentes).
 */
export function JobDetail({ jobId }: { jobId: number }) {
  const { data: jobData, isLoading, isError, refetch } = useAgentJob(jobId);
  const { data: runsData } = useAgentJobRuns(jobId, { limit: 20 });

  const run = useRunAgentJob();
  const pause = usePauseAgentJob();
  const resume = useResumeAgentJob();
  const cancel = useCancelAgentJob();

  if (isLoading) return <LoadingState label="Carregando Job..." />;
  if (isError || !jobData) return <ErrorState onRetry={() => refetch()} />;

  const job = jobData.data;

  async function handleRun() {
    try {
      await run.mutateAsync(jobId);
      toast.success("Run iniciado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao iniciar Run."));
    }
  }

  async function handlePause() {
    try {
      await pause.mutateAsync(jobId);
      toast.success("Job pausado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao pausar Job."));
    }
  }

  async function handleResume() {
    try {
      await resume.mutateAsync(jobId);
      toast.success("Job retomado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao retomar Job."));
    }
  }

  async function handleCancel() {
    try {
      await cancel.mutateAsync(jobId);
      toast.success("Job cancelado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao cancelar Job."));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Objetivo</p>
            <p className="text-base">{job.objective}</p>
            {job.description ? <p className="mt-1 text-sm text-muted-foreground">{job.description}</p> : null}
          </div>
          <JobStatusBadge status={job.status} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>Trigger: {jobTriggerTypeLabel(job.triggerType)}</span>
            <span>Shadow Mode: {job.shadowMode ? "ativo" : "desligado"}</span>
            <span>Runs concorrentes: {job.allowConcurrentRuns ? "permitidos" : "não permitidos"}</span>
            <span>Última execução: {formatDateTime(job.lastRunAt)}</span>
            <span>Próxima execução: {formatDateTime(job.nextRunAt)}</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>Máx. runs/dia: {job.maxRunsPerDay}</span>
            <span>Máx. ações/run: {job.maxActionsPerRun}</span>
            <span>Máx. aprovações abertas: {job.maxOpenApprovals}</span>
            <span>Timeout: {job.timeoutSeconds}s</span>
          </div>

          <div className="flex gap-2">
            <PermissionGate permission="agents.jobs.run">
              <Button size="sm" disabled={run.isPending} onClick={handleRun}>
                Executar agora
              </Button>
            </PermissionGate>
            <PermissionGate permission="agents.jobs.manage">
              {job.status === "active" ? (
                <Button size="sm" variant="outline" disabled={pause.isPending} onClick={handlePause}>
                  Pausar
                </Button>
              ) : job.status === "paused" ? (
                <Button size="sm" variant="outline" disabled={resume.isPending} onClick={handleResume}>
                  Retomar
                </Button>
              ) : null}
              {job.status === "active" || job.status === "paused" ? (
                <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={handleCancel}>
                  Cancelar
                </Button>
              ) : null}
            </PermissionGate>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <p className="text-sm font-medium">Histórico de Runs</p>
        </CardHeader>
        <CardContent className="p-0">
          {!runsData || runsData.data.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nenhum Run ainda — clique em "Executar agora" para iniciar um.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Iniciado em</TableHead>
                    <TableHead>Erro</TableHead>
                    <TableHead>Plano</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runsData.data.map((jobRun) => (
                    <TableRow key={jobRun.id}>
                      <TableCell className="text-xs text-muted-foreground">#{jobRun.id}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{jobTriggerTypeLabel(jobRun.triggerType)}</TableCell>
                      <TableCell>
                        <JobRunStatusBadge status={jobRun.status} />
                      </TableCell>
                      <TableCell>{formatDateTime(jobRun.startedAt)}</TableCell>
                      <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                        {jobRun.errorMessage ?? "--"}
                      </TableCell>
                      <TableCell>
                        {jobRun.actionPlanId ? (
                          <Link
                            href={`/agents/plans/${jobRun.actionPlanId}`}
                            className="text-primary underline underline-offset-2"
                          >
                            Ver plano
                          </Link>
                        ) : (
                          "--"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Link href="/agents/jobs" className="text-sm text-primary underline underline-offset-2">
        ← Voltar para todos os Jobs
      </Link>
    </div>
  );
}
