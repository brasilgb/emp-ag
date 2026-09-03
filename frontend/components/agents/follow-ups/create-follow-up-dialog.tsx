"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateManualFollowUp } from "@/hooks/agents/use-follow-ups";
import { useResponsibilities } from "@/hooks/agents/use-responsibilities";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { followUpPriorityLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import { FOLLOW_UP_PRIORITIES, type FollowUpPriority } from "@/types/agents";

/**
 * Agentes v2.7 (correio.md seção 6.B) — criação gerencial direta,
 * associada a uma Responsibility real. Formulário 100% estruturado:
 * `responsibilityId` é sempre um `<Select>` sobre Responsibilities reais
 * — nunca um id digitado livremente; `title`/`description` são só texto
 * descritivo, nunca interpretado como comando (seção 5: FollowUp ≠
 * Action Plan).
 */
export function CreateFollowUpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const responsibilitiesQuery = useResponsibilities({ limit: 100, enabled: true });
  const usersQuery = useUsersDirectory();
  const create = useCreateManualFollowUp();

  const [responsibilityId, setResponsibilityId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<FollowUpPriority>("medium");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [nextReviewAt, setNextReviewAt] = useState("");

  const canSubmit = responsibilityId !== "" && title.trim().length > 0;

  function reset() {
    setResponsibilityId("");
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAssignedUserId("");
    setDueAt("");
    setNextReviewAt("");
  }

  async function handleSubmit() {
    if (!canSubmit) return;

    try {
      await create.mutateAsync({
        responsibilityId: Number(responsibilityId),
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assignedUserId: assignedUserId ? Number(assignedUserId) : undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        nextReviewAt: nextReviewAt ? new Date(nextReviewAt).toISOString() : undefined,
      });
      toast.success("FollowUp criado.");
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar FollowUp."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo FollowUp</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Responsibility</Label>
            <Select value={responsibilityId} onValueChange={(value) => setResponsibilityId(value ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a Responsibility" />
              </SelectTrigger>
              <SelectContent>
                {responsibilitiesQuery.data?.data.map((responsibility) => (
                  <SelectItem key={responsibility.id} value={String(responsibility.id)}>
                    {responsibility.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="follow-up-title">Título</Label>
            <Input id="follow-up-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Cliente X precisa de retorno até sexta." />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="follow-up-description">Descrição (opcional)</Label>
            <Textarea id="follow-up-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          </div>

          <div className="space-y-1.5">
            <Label>Prioridade</Label>
            <Select value={priority} onValueChange={(value) => setPriority((value as FollowUpPriority) ?? "medium")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOLLOW_UP_PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {followUpPriorityLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Atribuir a (opcional)</Label>
            <Select value={assignedUserId} onValueChange={(value) => setAssignedUserId(value ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Ninguém atribuído" />
              </SelectTrigger>
              <SelectContent>
                {usersQuery.data?.data.map((user) => (
                  <SelectItem key={user.id} value={String(user.id)}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="follow-up-due-at">Prazo (opcional)</Label>
              <Input id="follow-up-due-at" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="follow-up-next-review">Próxima revisão (opcional)</Label>
              <Input id="follow-up-next-review" type="date" value={nextReviewAt} onChange={(event) => setNextReviewAt(event.target.value)} />
            </div>
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit || create.isPending}>
            Criar FollowUp
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
