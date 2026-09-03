"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWaitFollowUp } from "@/hooks/agents/use-follow-ups";
import { toErrorMessage } from "@/services/http";

/**
 * Agentes v2.7 (correio.md seção 12) — `waitingReason` é só descritivo,
 * nunca interpretado como comando. `waitingUntil` é opcional.
 */
export function WaitFollowUpDialog({ followUpId, open, onOpenChange }: { followUpId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const wait = useWaitFollowUp();
  const [waitingReason, setWaitingReason] = useState("");
  const [waitingUntil, setWaitingUntil] = useState("");

  async function handleSubmit() {
    const trimmed = waitingReason.trim();
    if (!trimmed) return;

    try {
      await wait.mutateAsync({ id: followUpId, waitingReason: trimmed, waitingUntil: waitingUntil ? new Date(waitingUntil).toISOString() : undefined });
      toast.success("FollowUp em espera.");
      onOpenChange(false);
      setWaitingReason("");
      setWaitingUntil("");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao colocar em espera."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aguardar</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="waiting-reason">Motivo da espera (obrigatório)</Label>
            <Textarea
              id="waiting-reason"
              value={waitingReason}
              onChange={(event) => setWaitingReason(event.target.value)}
              placeholder="Ex.: Aguardando retorno do cliente."
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="waiting-until">Aguardar até (opcional)</Label>
            <Input id="waiting-until" type="date" value={waitingUntil} onChange={(event) => setWaitingUntil(event.target.value)} />
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={!waitingReason.trim() || wait.isPending}>
            Aguardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
