"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import {
  useAgentJobs,
  useCancelAgentJob,
  usePauseAgentJob,
  useResumeAgentJob,
  useRunAgentJob,
} from "@/hooks/agents/use-agent-jobs";
import { formatDateTime } from "@/lib/agents/format";
import { JOB_STATUS_LABELS, jobTriggerTypeLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import { JOB_STATUSES, type JobStatus } from "@/types/agents";

import { JobStatusBadge } from "../status-badge";

const LIMIT = 20;

// Correio.md v1.3 seção 17 — tela Jobs: nome, agente, status, trigger,
// última/próxima execução; ações executar agora/pausar/retomar/ver
// histórico (edição fica só na tela de detalhe, seção 17 "Detalhe").
export function JobList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<JobStatus | "all">("all");

  const { data, isLoading, isError, refetch } = useAgentJobs({
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
  });

  const run = useRunAgentJob();
  const pause = usePauseAgentJob();
  const resume = useResumeAgentJob();
  const cancel = useCancelAgentJob();

  async function handleRun(id: number) {
    try {
      await run.mutateAsync(id);
      toast.success("Run iniciado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao iniciar Run."));
    }
  }

  async function handlePause(id: number) {
    try {
      await pause.mutateAsync(id);
      toast.success("Job pausado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao pausar Job."));
    }
  }

  async function handleResume(id: number) {
    try {
      await resume.mutateAsync(id);
      toast.success("Job retomado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao retomar Job."));
    }
  }

  async function handleCancel(id: number) {
    try {
      await cancel.mutateAsync(id);
      toast.success("Job cancelado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao cancelar Job."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <Select
          value={status}
          onValueChange={(value) => {
            setPage(1);
            setStatus(value as JobStatus | "all");
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {JOB_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {JOB_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando Jobs..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="Nenhum Job cadastrado" description="Crie um Job acima para automatizar um objetivo recorrente." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Última execução</TableHead>
                  <TableHead>Próxima execução</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Link href={`/agents/jobs/${job.id}`} className="text-primary underline underline-offset-2">
                        {job.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <JobStatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{jobTriggerTypeLabel(job.triggerType)}</TableCell>
                    <TableCell>{formatDateTime(job.lastRunAt)}</TableCell>
                    <TableCell>{formatDateTime(job.nextRunAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <PermissionGate permission="agents.jobs.run">
                          <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => handleRun(job.id)}>
                            Executar agora
                          </Button>
                        </PermissionGate>
                        <PermissionGate permission="agents.jobs.manage">
                          {job.status === "active" ? (
                            <Button size="sm" variant="outline" disabled={pause.isPending} onClick={() => handlePause(job.id)}>
                              Pausar
                            </Button>
                          ) : job.status === "paused" ? (
                            <Button size="sm" variant="outline" disabled={resume.isPending} onClick={() => handleResume(job.id)}>
                              Retomar
                            </Button>
                          ) : null}
                          {job.status === "active" || job.status === "paused" ? (
                            <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => handleCancel(job.id)}>
                              Cancelar
                            </Button>
                          ) : null}
                        </PermissionGate>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data ? <PaginationBar pagination={data.pagination} onPageChange={setPage} /> : null}
      </CardContent>
    </Card>
  );
}
