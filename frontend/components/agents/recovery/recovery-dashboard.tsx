"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useRecoveryStatus, useRunRecovery, useStaleWorkflows } from "@/hooks/agents/use-recovery";
import { formatAgeSeconds, workflowTypeLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";
import type { RecoveryItemResult, StaleCandidate } from "@/types/agents";

import { RecoveryResultBadge } from "../status-badge";

/**
 * Agentes v2.4 (correio.md seções 26/27) — tela ADMINISTRATIVA/
 * OPERACIONAL, nunca ferramenta diária do usuário comum (protegida por
 * `agents.recovery.manage` para a ação real; leitura por
 * `agents.operations.read` — os próprios endpoints já barram no
 * backend, aqui só reforça a UX). Fluxo privilegiado: "Simular
 * recuperação" (dry-run, sempre sem custo) antes de "Executar
 * recuperação" (real, com confirmação explícita).
 */
export function RecoveryDashboard() {
  const statusQuery = useRecoveryStatus();
  const staleQuery = useStaleWorkflows();
  const runRecovery = useRunRecovery();

  const [simulatedItems, setSimulatedItems] = useState<RecoveryItemResult[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastRealItems, setLastRealItems] = useState<RecoveryItemResult[] | null>(null);

  async function handleSimulate() {
    try {
      const { data } = await runRecovery.mutateAsync(true);
      setSimulatedItems(data.items);
      setLastRealItems(null);
      toast.success(`Simulação concluída: ${data.stale} stale, ${data.items.length} ação(ões) proposta(s).`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao simular recuperação."));
    }
  }

  async function handleRunReal() {
    try {
      const { data } = await runRecovery.mutateAsync(false);
      setLastRealItems(data.items);
      setSimulatedItems(null);
      setConfirmOpen(false);
      toast.success(`Recuperação executada: ${data.reverted} revertido(s), ${data.manualAttention} escalado(s), ${data.skipped} ignorado(s).`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao executar recuperação."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Saúde dos workflows</h3>
        </CardHeader>
        <CardContent>
          {statusQuery.isLoading ? (
            <LoadingState label="Carregando status..." />
          ) : statusQuery.isError || !statusQuery.data ? (
            <ErrorState onRetry={() => statusQuery.refetch()} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatBox label="Stale total" value={statusQuery.data.data.staleTotal} />
              <StatBox label="Initiatives" value={statusQuery.data.data.byType.initiative} />
              <StatBox label="Executive Reviews" value={statusQuery.data.data.byType.executive_review} />
              <StatBox label="Strategic Memories" value={statusQuery.data.data.byType.strategic_memory} />
              <StatBox
                label="Mais antigo"
                value={statusQuery.data.data.oldest ? formatAgeSeconds(statusQuery.data.data.oldest.ageSeconds) : "--"}
              />
              <StatBox label="Atenção manual pendente" value={statusQuery.data.data.manualAttentionPending} highlight={statusQuery.data.data.manualAttentionPending > 0} />
              <StatBox label="Último scan" value={statusQuery.data.data.lastScanAt ? formatDateTime(statusQuery.data.data.lastScanAt) : "Nunca"} small />
              <StatBox label="Última reconciliação" value={statusQuery.data.data.lastReconciledAt ? formatDateTime(statusQuery.data.data.lastReconciledAt) : "Nunca"} small />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Workflows stale</h3>
          <PermissionGate permission="agents.recovery.manage">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={runRecovery.isPending} onClick={handleSimulate}>
                Simular recuperação
              </Button>
              <Button size="sm" disabled={runRecovery.isPending} onClick={() => setConfirmOpen(true)}>
                Executar recuperação
              </Button>
            </div>
          </PermissionGate>
        </CardHeader>
        <CardContent className="space-y-3">
          {staleQuery.isLoading ? (
            <LoadingState label="Carregando workflows stale..." />
          ) : staleQuery.isError || !staleQuery.data ? (
            <ErrorState onRetry={() => staleQuery.refetch()} />
          ) : staleQuery.data.data.length === 0 ? (
            <EmptyState title="Nenhum workflow stale" description="Todos os workflows dos agentes estão em estados saudáveis." />
          ) : (
            <StaleTable candidates={staleQuery.data.data} results={simulatedItems ?? lastRealItems} />
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Executar recuperação real?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Isso vai reconciliar de verdade os workflows stale listados abaixo — reverter claims órfãos para um estado seguro de retry, ou escalar
              inconsistências reais para a Director Decision Queue. Nenhuma ação de negócio (approval, execução de tool, Action Plan novo) é disparada.
            </p>
            <p className="text-muted-foreground">Recomendado simular antes, se ainda não simulou.</p>
            <Button className="w-full" disabled={runRecovery.isPending} onClick={handleRunReal}>
              Confirmar e executar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatBox({ label, value, small, highlight }: { label: string; value: string | number; small?: boolean; highlight?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={small ? "text-xs" : `font-medium ${highlight ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</p>
    </div>
  );
}

/**
 * Agentes v2.4 (correio.md seção 27) — tabela Tipo/ID/Estado/Idade/
 * Problema/Ação proposta. `results` (de uma simulação ou execução real
 * mais recente) é sobreposto por linha quando disponível — nunca
 * inventa uma ação para um candidato que não foi simulado/executado
 * ainda (mostra "--" nesse caso).
 */
function StaleTable({ candidates, results }: { candidates: StaleCandidate[]; results: RecoveryItemResult[] | null }) {
  function resultFor(candidate: StaleCandidate): RecoveryItemResult | undefined {
    return results?.find((item) => item.workflowType === candidate.workflowType && item.entityId === candidate.entityId);
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Idade</TableHead>
            <TableHead>Problema</TableHead>
            <TableHead>Ação proposta/resultado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => {
            const result = resultFor(candidate);
            return (
              <TableRow key={`${candidate.workflowType}-${candidate.entityId}`}>
                <TableCell className="text-xs">{workflowTypeLabel(candidate.workflowType)}</TableCell>
                <TableCell className="text-xs">#{candidate.entityId}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">
                    {candidate.previousState}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{formatAgeSeconds(candidate.ageSeconds)}</TableCell>
                <TableCell className="max-w-80 text-xs text-muted-foreground">{candidate.problem}</TableCell>
                <TableCell>{result ? <RecoveryResultBadge result={result.result} /> : <span className="text-xs text-muted-foreground">--</span>}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
