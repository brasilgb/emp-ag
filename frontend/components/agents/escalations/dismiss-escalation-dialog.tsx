"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDismissEscalation } from "@/hooks/agents/use-escalations";
import { toErrorMessage } from "@/services/http";

/**
 * Agentes v2.6 (correio.md seção 11) — dismiss de Escalation exige
 * justificativa auditável, mesmo padrão de DismissDecisionDialog (v1.9).
 * Nunca apaga o registro; reocorrência reabre a mesma linha (ver
 * escalations/service.ts:createOrReopenEscalation).
 */
export function DismissEscalationDialog({
  escalationId,
  open,
  onOpenChange,
}: {
  escalationId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dismiss = useDismissEscalation();
  const [reason, setReason] = useState("");

  async function handleDismiss() {
    const trimmed = reason.trim();
    if (!trimmed) return;

    try {
      await dismiss.mutateAsync({ id: escalationId, reason: trimmed });
      toast.success("Escalation descartada.");
      onOpenChange(false);
      setReason("");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao descartar."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Descartar escalation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dismiss-escalation-reason">Justificativa (obrigatória)</Label>
            <Textarea
              id="dismiss-escalation-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Por que esta escalation não precisa mais de acompanhamento?"
              rows={4}
            />
          </div>
          <Button
            className="w-full"
            variant="destructive"
            onClick={handleDismiss}
            disabled={!reason.trim() || dismiss.isPending}
          >
            Descartar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
