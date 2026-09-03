"use client";

import { useState } from "react";
import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useStrategicMemories } from "@/hooks/agents/use-director-memories";
import { memoryTypeLabel, signalDomainLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { MEMORY_TYPES, type MemoryType, type SignalDomain } from "@/types/agents";

import { MemoryImportanceBadge, MemoryStatusBadge } from "../../status-badge";

const DOMAIN_OPTIONS: SignalDomain[] = ["crm", "projects", "finance", "support", "agents"];
const LIMIT = 20;

/**
 * Agentes v2.3 (correio.md seção 19) — "Aprendizado histórico", nunca
 * apresentado como regra obrigatória: cada card mostra a lição em
 * linguagem consultiva, com confiança/importância visíveis, e links de
 * navegação para a origem real (Goal/Initiative/Review) — nunca uma
 * afirmação sem proveniência.
 */
export function MemoriesList() {
  const [page, setPage] = useState(1);
  const [domain, setDomain] = useState<SignalDomain | "all">("all");
  const [memoryType, setMemoryType] = useState<MemoryType | "all">("all");

  const memories = useStrategicMemories({
    page,
    limit: LIMIT,
    domain: domain === "all" ? undefined : domain,
    memoryType: memoryType === "all" ? undefined : memoryType,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={domain}
            onValueChange={(value) => {
              setPage(1);
              setDomain(value as SignalDomain | "all");
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os domínios</SelectItem>
              {DOMAIN_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {signalDomainLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={memoryType}
            onValueChange={(value) => {
              setPage(1);
              setMemoryType(value as MemoryType | "all");
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {MEMORY_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {memoryTypeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {memories.isLoading ? (
          <LoadingState label="Carregando aprendizados estratégicos..." />
        ) : memories.isError || !memories.data ? (
          <ErrorState onRetry={() => memories.refetch()} />
        ) : memories.data.data.length === 0 ? (
          <EmptyState title="Nenhum aprendizado ainda" description="Aprendizados estratégicos são gerados a partir de Executive Reviews concluídas." />
        ) : (
          <ul className="space-y-3">
            {memories.data.data.map((memory) => (
              <li key={memory.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{memory.title ?? `Aprendizado #${memory.id}`}</span>
                    <span className="text-xs text-muted-foreground">{signalDomainLabel(memory.domain)}</span>
                    <span className="text-xs text-muted-foreground">{memoryTypeLabel(memory.memoryType)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MemoryStatusBadge status={memory.status} />
                    {memory.importance ? <MemoryImportanceBadge importance={memory.importance} /> : null}
                  </div>
                </div>
                {memory.lesson ? <p className="mt-2 text-sm text-muted-foreground">{memory.lesson}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {memory.confidence ? <span>Confiança: {Math.round(Number(memory.confidence) * 100)}%</span> : null}
                  <span>{formatDateTime(memory.createdAt)}</span>
                  <Link href={`/agents/director/initiatives/${memory.sourceInitiativeId}`} className="text-primary underline underline-offset-2">
                    Ver Initiative de origem
                  </Link>
                  <Link href={`/agents/director/goals/${memory.sourceGoalId}`} className="text-primary underline underline-offset-2">
                    Ver Goal de origem
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        {memories.data ? <PaginationBar pagination={memories.data.pagination} onPageChange={setPage} /> : null}
      </CardContent>
    </Card>
  );
}
