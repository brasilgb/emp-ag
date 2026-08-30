"use client";

import { useState } from "react";
import { History } from "lucide-react";

import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useProjectHistory } from "@/hooks/projects/use-task-history";
import { formatDateTime, historyEventLabel } from "@/lib/projects/format";

export function ProjectHistoryTab({ projectId }: { projectId: number }) {
  const [page, setPage] = useState(1);
  const historyQuery = useProjectHistory(projectId, page);

  if (historyQuery.isLoading) {
    return <LoadingState label="Carregando histórico..." />;
  }

  if (historyQuery.isError || !historyQuery.data) {
    return <ErrorState onRetry={() => historyQuery.refetch()} />;
  }

  if (historyQuery.data.data.length === 0) {
    return (
      <EmptyState
        title="Nenhum evento registrado"
        description="A timeline reúne eventos do projeto, milestones, tarefas e comentários conforme forem acontecendo."
      />
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {historyQuery.data.data.map((entry, index) => (
          <li key={`${entry.createdAt}-${index}`} className="flex gap-3 rounded-lg border p-3 text-sm">
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

      <PaginationBar pagination={historyQuery.data.pagination} onPageChange={setPage} />
    </div>
  );
}
