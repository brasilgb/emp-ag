"use client";

import { History } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useTaskHistory } from "@/hooks/projects/use-task-history";
import { formatDateTime, historyEventLabel } from "@/lib/projects/format";

export function TaskHistorySection({ projectId, taskId }: { projectId: number; taskId: number }) {
  const historyQuery = useTaskHistory(projectId, taskId);

  if (historyQuery.isLoading) {
    return <LoadingState label="Carregando histórico..." />;
  }

  if (historyQuery.isError || !historyQuery.data) {
    return <ErrorState onRetry={() => historyQuery.refetch()} />;
  }

  if (historyQuery.data.data.length === 0) {
    return <EmptyState title="Nenhum evento registrado" description="O histórico aparece aqui conforme a tarefa evolui." />;
  }

  return (
    <ul className="space-y-3">
      {historyQuery.data.data.map((entry) => (
        <li key={entry.id} className="flex gap-3 rounded-lg border p-3 text-sm">
          <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{historyEventLabel(entry.event)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDateTime(entry.createdAt)}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
