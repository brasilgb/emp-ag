"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateInitiative } from "@/hooks/agents/use-director-goals";
import { toErrorMessage } from "@/services/http";
import type { SignalDomain } from "@/types/agents";

/**
 * Agentes v2.0 (correio.md seção 10) — origem manual: "CEO/Diretor cria
 * iniciativa diretamente". Nasce sempre "proposed" — precisa ser
 * aprovada antes de poder propor Action Plan (mesma regra do backend).
 */
export function CreateInitiativeDialog({
  goalId,
  domain,
  open,
  onOpenChange,
}: {
  goalId: number;
  domain: SignalDomain;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createInitiative = useCreateInitiative();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rationale, setRationale] = useState("");

  const valid = title.trim().length > 0 && description.trim().length > 0 && rationale.trim().length > 0;

  async function handleCreate() {
    if (!valid) return;

    try {
      await createInitiative.mutateAsync({
        goalId,
        input: { title: title.trim(), description: description.trim(), domain, rationale: rationale.trim() },
      });
      toast.success("Initiative criada.");
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setRationale("");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar Initiative."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova Initiative</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="initiative-title">Título</Label>
            <Input id="initiative-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="initiative-description">Descrição</Label>
            <Textarea id="initiative-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="initiative-rationale">Racional (por que esta iniciativa ajuda o Goal)</Label>
            <Textarea id="initiative-rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} rows={3} />
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={!valid || createInitiative.isPending}>
            Criar Initiative
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
