"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCancelActionProposal } from "@/hooks/agents/use-action-proposals";
import { toErrorMessage } from "@/services/http";

export function CancelActionProposalDialog({
  followUpId,
  proposalId,
  open,
  onOpenChange,
}: {
  followUpId: number;
  proposalId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const cancel = useCancelActionProposal(followUpId);
  const [reason, setReason] = useState("");

  async function handleSubmit() {
    const trimmed = reason.trim();
    if (!trimmed) return;

    try {
      await cancel.mutateAsync({ id: proposalId, reason: trimmed });
      toast.success("Proposta cancelada.");
      onOpenChange(false);
      setReason("");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao cancelar."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar proposta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-proposal-reason">Justificativa (obrigatória)</Label>
            <Textarea id="cancel-proposal-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={4} />
          </div>
          <Button className="w-full" variant="destructive" onClick={handleSubmit} disabled={!reason.trim() || cancel.isPending}>
            Cancelar proposta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
