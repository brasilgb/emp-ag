"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/auth/permission-gate";
import { useProposeSignalAction } from "@/hooks/agents/use-director";
import { toErrorMessage } from "@/services/http";

const DECISION_LABELS: Record<string, string> = {
  execute: "Executável automaticamente",
  approval_required: "Approval necessário",
  blocked: "Bloqueado",
  shadow: "Shadow",
};

/**
 * Agentes v1.8 (correio.md seção 16) — "Propor ação": nunca muta nada
 * diretamente na UI. O backend monta o objetivo, roda o Planner + Policy
 * Evaluator reais e devolve o Action Plan persistido; aqui só mostramos o
 * resultado e linkamos para a tela de planos/aprovações já existente —
 * "não criar confirmação paralela".
 */
export function ProposeActionButton({ signalId }: { signalId: string }) {
  const propose = useProposeSignalAction();
  const [result, setResult] = useState<{ planId: number; decisions: string } | null>(null);

  async function handlePropose() {
    try {
      const response = await propose.mutateAsync(signalId);
      const decisions = response.data.items.map((item) => DECISION_LABELS[item.decision] ?? item.decision);
      const uniqueDecisions = [...new Set(decisions)].join(", ") || "sem ações";

      setResult({ planId: response.data.plan.id, decisions: uniqueDecisions });
      toast.success(`Plano criado: ${uniqueDecisions}.`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao propor ação."));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <PermissionGate permission="agents.plan">
        <Button size="sm" variant="outline" disabled={propose.isPending} onClick={handlePropose}>
          Propor ação
        </Button>
      </PermissionGate>
      {result ? (
        <span className="text-xs text-muted-foreground">
          {result.decisions} ·{" "}
          <Link href={`/agents/plans/${result.planId}`} className="text-primary underline underline-offset-2">
            Ver plano #{result.planId}
          </Link>
        </span>
      ) : null}
    </div>
  );
}
