"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateActionProposal } from "@/hooks/agents/use-action-proposals";
import { toErrorMessage } from "@/services/http";

/**
 * Agentes v2.8 (correio.md seção 20) — "Propor ação": modal estruturado
 * com só Título/Objetivo/Descrição — nunca tool/handler/permission/
 * policy (conceitos internos do pipeline, nunca expostos aqui). O
 * humano descreve o objetivo; o Planner estrutura; a Policy governa.
 */
export function CreateActionProposalDialog({
  followUpId,
  open,
  onOpenChange,
}: {
  followUpId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateActionProposal(followUpId);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [description, setDescription] = useState("");

  const canSubmit = title.trim().length > 0 && objective.trim().length > 0;

  function reset() {
    setTitle("");
    setObjective("");
    setDescription("");
  }

  async function handleSubmit() {
    if (!canSubmit) return;

    try {
      await create.mutateAsync({ title: title.trim(), objective: objective.trim(), description: description.trim() || undefined });
      toast.success("Proposta de ação criada — ainda não submetida ao pipeline.");
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar proposta."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propor ação</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Isto registra uma proposta — nada é executado ainda. Ao submeter, o Planner estrutura a ação e a Policy decide se ela pode executar
            automaticamente, precisa de aprovação, ou é bloqueada.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="proposal-title">Título</Label>
            <Input id="proposal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Enviar comunicação ao cliente" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proposal-objective">Objetivo</Label>
            <Textarea
              id="proposal-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Descreva o que precisa acontecer, em linguagem natural."
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proposal-description">Descrição/contexto (opcional)</Label>
            <Textarea id="proposal-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit || create.isPending}>
            Criar proposta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
