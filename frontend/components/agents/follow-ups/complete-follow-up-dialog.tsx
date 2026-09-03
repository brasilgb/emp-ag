"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCompleteFollowUp } from "@/hooks/agents/use-follow-ups";
import { toErrorMessage } from "@/services/http";

/**
 * Agentes v2.7 (correio.md seção 13) — conclusão exige `resolution`
 * estruturada suficiente para auditoria (texto obrigatório, nunca vazio).
 */
export function CompleteFollowUpDialog({ followUpId, open, onOpenChange }: { followUpId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const complete = useCompleteFollowUp();
  const [resolution, setResolution] = useState("");

  async function handleSubmit() {
    const trimmed = resolution.trim();
    if (!trimmed) return;

    try {
      await complete.mutateAsync({ id: followUpId, resolution: trimmed });
      toast.success("FollowUp concluído.");
      onOpenChange(false);
      setResolution("");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao concluir."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Concluir FollowUp</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="follow-up-resolution">Resolução (obrigatória)</Label>
            <Textarea
              id="follow-up-resolution"
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="Como este acompanhamento foi resolvido?"
              rows={4}
            />
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={!resolution.trim() || complete.isPending}>
            Concluir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
