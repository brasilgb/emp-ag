"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCancelGoal } from "@/hooks/agents/use-director-goals";
import { toErrorMessage } from "@/services/http";

export function CancelGoalDialog({ goalId, open, onOpenChange }: { goalId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const cancelGoal = useCancelGoal();
  const [reason, setReason] = useState("");

  async function handleCancel() {
    const trimmed = reason.trim();
    if (!trimmed) return;

    try {
      await cancelGoal.mutateAsync({ id: goalId, reason: trimmed });
      toast.success("Goal cancelado.");
      onOpenChange(false);
      setReason("");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao cancelar Goal."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar Goal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-goal-reason">Justificativa (obrigatória)</Label>
            <Textarea id="cancel-goal-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={4} />
          </div>
          <Button className="w-full" variant="destructive" onClick={handleCancel} disabled={!reason.trim() || cancelGoal.isPending}>
            Cancelar Goal
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
