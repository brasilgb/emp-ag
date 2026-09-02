"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDismissDecision } from "@/hooks/agents/use-director-decisions";
import { toErrorMessage } from "@/services/http";

/**
 * Agentes v1.9 (correio.md seção 17) — dismiss exige justificativa
 * auditável. Nunca apaga o registro; o backend grava reason/dismissedBy/At
 * e audita. Reabertura por reocorrência é tratada no próximo sync.
 */
export function DismissDecisionDialog({
  decisionId,
  open,
  onOpenChange,
}: {
  decisionId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dismiss = useDismissDecision();
  const [reason, setReason] = useState("");

  async function handleDismiss() {
    const trimmed = reason.trim();
    if (!trimmed) return;

    try {
      await dismiss.mutateAsync({ id: decisionId, reason: trimmed });
      toast.success("Item dispensado.");
      onOpenChange(false);
      setReason("");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao dispensar."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispensar item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dismiss-reason">Justificativa (obrigatória)</Label>
            <Textarea
              id="dismiss-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Por que este item não precisa mais de acompanhamento?"
              rows={4}
            />
          </div>
          <Button
            className="w-full"
            variant="destructive"
            onClick={handleDismiss}
            disabled={!reason.trim() || dismiss.isPending}
          >
            Dispensar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
