"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { useCreateGoal } from "@/hooks/agents/use-director-goals";
import { goalPriorityLabel, signalDomainLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import type { GoalPriority, GoalTargetType, SignalDomain } from "@/types/agents";

const DOMAIN_OPTIONS: SignalDomain[] = ["crm", "projects", "finance", "support", "agents"];
const PRIORITY_OPTIONS: GoalPriority[] = ["low", "medium", "high", "critical"];

/**
 * Agentes v2.0 (correio.md seção 2/10) — "CEO/Diretor cria Goal
 * diretamente". Nasce sempre `draft` (o backend decide isso, nunca a UI)
 * — ativar é uma ação separada e explícita na tela de detalhe.
 */
export function CreateGoalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const usersQuery = useUsersDirectory();
  const createGoal = useCreateGoal();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState<SignalDomain>("crm");
  const [priority, setPriority] = useState<GoalPriority>("medium");
  const [ownerUserId, setOwnerUserId] = useState<string | undefined>(undefined);
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [targetType, setTargetType] = useState<GoalTargetType>("metric");
  const [targetValue, setTargetValue] = useState("");
  const [unit, setUnit] = useState("");

  const valid = title.trim().length > 0 && description.trim().length > 0 && startDate && targetDate;

  async function handleCreate() {
    if (!valid) return;

    try {
      const { data: goal } = await createGoal.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        domain,
        priority,
        ownerUserId: ownerUserId ? Number(ownerUserId) : undefined,
        startDate: new Date(startDate).toISOString(),
        targetDate: new Date(targetDate).toISOString(),
        targetType,
        targetValue: targetType === "metric" && targetValue ? Number(targetValue) : undefined,
        unit: unit.trim() || undefined,
      });
      toast.success(`Goal "${goal.title}" criado como rascunho.`);
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setTargetValue("");
      setUnit("");
      setStartDate("");
      setTargetDate("");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar Goal."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Goal estratégico</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="goal-title">Título</Label>
            <Input id="goal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Conquistar 20 novos clientes" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-description">Descrição</Label>
            <Textarea id="goal-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="goal-domain">Domínio</Label>
              <Select value={domain} onValueChange={(value) => setDomain(value as SignalDomain)}>
                <SelectTrigger id="goal-domain" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOMAIN_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {signalDomainLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-priority">Prioridade</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as GoalPriority)}>
                <SelectTrigger id="goal-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {goalPriorityLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="goal-start">Início</Label>
              <Input id="goal-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-target-date">Prazo</Label>
              <Input id="goal-target-date" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-owner">Responsável (opcional)</Label>
            <Select value={ownerUserId} onValueChange={(value) => setOwnerUserId(value ?? undefined)} disabled={usersQuery.isLoading}>
              <SelectTrigger id="goal-owner" className="w-full">
                <SelectValue placeholder="Sem responsável" />
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="goal-target-type">Tipo de acompanhamento</Label>
              <Select value={targetType} onValueChange={(value) => setTargetType(value as GoalTargetType)}>
                <SelectTrigger id="goal-target-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="metric">Métrica (catálogo)</SelectItem>
                  <SelectItem value="milestone">Marco (manual)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {targetType === "metric" ? (
              <div className="space-y-1.5">
                <Label htmlFor="goal-target-value">Valor alvo (opcional aqui — dá para associar métricas depois)</Label>
                <Input
                  id="goal-target-value"
                  type="number"
                  value={targetValue}
                  onChange={(event) => setTargetValue(event.target.value)}
                  placeholder="20"
                />
              </div>
            ) : null}
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={!valid || createGoal.isPending}>
            Criar Goal (rascunho)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
