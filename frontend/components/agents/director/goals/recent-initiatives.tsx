"use client";

import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useDirectorInitiatives } from "@/hooks/agents/use-director-goals";

import { InitiativeStatusBadge } from "../../status-badge";

/**
 * Agentes v2.0 (correio.md seção 19 item 5) — "Recent/Relevant
 * Initiatives": só as 5 mais recentes, nunca uma lista completa aqui
 * (isso vive em /agents/director/goals/:id).
 */
export function RecentInitiativesSection() {
  const { data, isLoading, isError, refetch } = useDirectorInitiatives({ page: 1, limit: 5 });

  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Iniciativas recentes</h3>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando iniciativas..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="Nenhuma iniciativa ainda" className="py-6" />
        ) : (
          <ul className="divide-y">
            {data.data.map((initiative) => (
              <li key={initiative.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <Link href={`/agents/director/initiatives/${initiative.id}`} className="text-primary underline-offset-2 hover:underline">
                    {initiative.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Goal <Link href={`/agents/director/goals/${initiative.goalId}`} className="underline underline-offset-2">#{initiative.goalId}</Link>
                    {initiative.origin === "director_recommendation" ? " · recomendação do Diretor" : ""}
                  </p>
                </div>
                <InitiativeStatusBadge status={initiative.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
