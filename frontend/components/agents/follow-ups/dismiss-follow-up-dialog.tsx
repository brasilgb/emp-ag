"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDismissFollowUp } from "@/hooks/agents/use-follow-ups";
import { toErrorMessage } from "@/services/http";

/**
 * Agentes v2.7 — dismiss de FollowUp exige justificativa auditável,
 * mesmo padrão de DismissDecisionDialog (v1.9)/DismissEscalationDialog
 * (v2.6).
 */
export function DismissFollowUpDialog({ followUpId, open, onOpenChange }: { followUpId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const dismiss = useDismissFollowUp();
  const [reason, setReason] = useState("");

  async function handleSubmit() {
    const trimmed = reason.trim();
    if (!trimmed) return;

    try {
      await dismiss.mutateAsync({ id: followUpId, reason: trimmed });
      toast.success("FollowUp descartado.");
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
          <DialogTitle>Descartar FollowUp</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dismiss-follow-up-reason">Justificativa (obrigatória)</Label>
            <Textarea
              id="dismiss-follow-up-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Por que este acompanhamento não é mais necessário?"
              rows={4}
            />
          </div>
          <Button className="w-full" variant="destructive" onClick={handleSubmit} disabled={!reason.trim() || dismiss.isPending}>
            Descartar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
