"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAgents } from "@/hooks/agents/use-agents";
import { useUpdateResponsibility } from "@/hooks/agents/use-responsibilities";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { escalationPolicyLabel, responsibilityPriorityLabel, responsibilityTypeLabel } from "@/lib/agents/derived";
import { escalationTargetsForPolicyChange, parseConditionsInput } from "@/lib/agents/responsibility-form";
import { toErrorMessage } from "@/services/http";
import {
  ESCALATION_POLICIES,
  RESPONSIBILITY_PRIORITIES,
  type AgentResponsibility,
  type EscalationPolicy,
  type ResponsibilityPriority,
} from "@/types/agents";

/**
 * Agentes v2.6 (correio.md "Fechamento antes do commit", item 1) —
 * edição completa de Responsibility. Segue o MESMO padrão visual/técnico
 * de `CreateResponsibilityDialog`: vocabulários fechados via `<Select>`,
 * texto livre só para campos puramente descritivos (name/description),
 * nunca interpretado como código. Nenhuma regra de negócio nova aqui — a
 * API `PATCH /agents/responsibilities/:id` (já validada/testada na v2.6)
 * continua a autoridade definitiva; o frontend só previne combinações
 * óbvias por UX.
 *
 * Campos editáveis: name, description, priority, conditions,
 * escalationPolicy, escalationTargetAgentId, escalationTargetUserId,
 * enabled — exatamente o conjunto que `updateResponsibilitySchema`
 * (backend) aceita. `agentId`/`domain`/`responsibilityType`/`createdBy`/
 * timestamps são deliberadamente imutáveis aqui, mesmo protegidos pelo
 * schema Zod do backend (que nem aceita esses campos em PATCH).
 */
export function EditResponsibilityDialog({
  responsibility,
  open,
  onOpenChange,
}: {
  responsibility: AgentResponsibility;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const agentsQuery = useAgents();
  const usersQuery = useUsersDirectory();
  const update = useUpdateResponsibility();

  const [name, setName] = useState(responsibility.name);
  const [description, setDescription] = useState(responsibility.description ?? "");
  const [priority, setPriority] = useState<ResponsibilityPriority>(responsibility.priority);
  const [conditionsText, setConditionsText] = useState(() => JSON.stringify(responsibility.conditions, null, 2));
  const [enabled, setEnabled] = useState(responsibility.enabled);
  const [escalationPolicy, setEscalationPolicy] = useState<EscalationPolicy>(responsibility.escalationPolicy);
  const [escalationTargetAgentId, setEscalationTargetAgentId] = useState<string>(
    responsibility.escalationTargetAgentId ? String(responsibility.escalationTargetAgentId) : "",
  );
  const [escalationTargetUserId, setEscalationTargetUserId] = useState<string>(
    responsibility.escalationTargetUserId ? String(responsibility.escalationTargetUserId) : "",
  );

  // Sempre que o diálogo é reaberto para uma Responsibility diferente
  // (ou reaberto para a mesma após um refetch), realinha o formulário com
  // os dados reais — nunca mantém um estado obsoleto de uma edição
  // anterior.
  useEffect(() => {
    if (!open) return;
    setName(responsibility.name);
    setDescription(responsibility.description ?? "");
    setPriority(responsibility.priority);
    setConditionsText(JSON.stringify(responsibility.conditions, null, 2));
    setEnabled(responsibility.enabled);
    setEscalationPolicy(responsibility.escalationPolicy);
    setEscalationTargetAgentId(responsibility.escalationTargetAgentId ? String(responsibility.escalationTargetAgentId) : "");
    setEscalationTargetUserId(responsibility.escalationTargetUserId ? String(responsibility.escalationTargetUserId) : "");
  }, [open, responsibility]);

  const needsAgentTarget = escalationPolicy === "agent" || escalationPolicy === "agent_then_human";
  const needsUserTarget = escalationPolicy === "human" || escalationPolicy === "agent_then_human";

  // Ao trocar a política, esvazia (por UX) o campo de alvo que deixou de
  // ser exigido — nunca envia um target obsoleto para uma política que
  // não o usa. O backend continua validando a combinação de qualquer
  // forma (autoridade definitiva).
  function handlePolicyChange(value: EscalationPolicy) {
    setEscalationPolicy(value);
    const { agentId, userId } = escalationTargetsForPolicyChange(value, {
      agentId: escalationTargetAgentId,
      userId: escalationTargetUserId,
    });
    setEscalationTargetAgentId(agentId);
    setEscalationTargetUserId(userId);
  }

  const canSubmit =
    name.trim().length > 0 &&
    (!needsAgentTarget || escalationTargetAgentId !== "") &&
    (!needsUserTarget || escalationTargetUserId !== "");

  async function handleSubmit() {
    if (!canSubmit) return;

    let conditions: Record<string, unknown>;
    try {
      conditions = parseConditionsInput(conditionsText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Conditions precisa ser um JSON válido (um objeto).");
      return;
    }

    try {
      await update.mutateAsync({
        id: responsibility.id,
        input: {
          name: name.trim(),
          description: description.trim() || null,
          priority,
          conditions,
          enabled,
          escalationPolicy,
          escalationTargetAgentId: needsAgentTarget ? Number(escalationTargetAgentId) : null,
          escalationTargetUserId: needsUserTarget ? Number(escalationTargetUserId) : null,
        },
      });
      toast.success("Responsibility atualizada.");
      onOpenChange(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar Responsibility."));
    }
  }

  const agentName = agentsQuery.data?.data.find((agent) => agent.id === responsibility.agentId)?.name ?? `Agente #${responsibility.agentId}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Responsibility</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="border-transparent bg-muted">
              Agente: {agentName}
            </Badge>
            <Badge variant="secondary" className="border-transparent bg-muted">
              Domínio: {responsibility.domain}
            </Badge>
            <Badge variant="secondary" className="border-transparent bg-muted">
              Tipo: {responsibilityTypeLabel(responsibility.responsibilityType)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">Agente, domínio e tipo não podem ser alterados após a criação.</p>

          <div className="space-y-1.5">
            <Label htmlFor="edit-responsibility-name">Nome</Label>
            <Input id="edit-responsibility-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-responsibility-description">Descrição (opcional)</Label>
            <Textarea id="edit-responsibility-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          </div>

          <div className="space-y-1.5">
            <Label>Prioridade</Label>
            <Select value={priority} onValueChange={(value) => setPriority((value as ResponsibilityPriority) ?? priority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESPONSIBILITY_PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {responsibilityPriorityLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-responsibility-conditions">Conditions (JSON)</Label>
            <Textarea
              id="edit-responsibility-conditions"
              value={conditionsText}
              onChange={(event) => setConditionsText(event.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">Filtro descritivo opcional — nunca interpretado como código.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Política de escalonamento</Label>
            <Select value={escalationPolicy} onValueChange={(value) => handlePolicyChange((value as EscalationPolicy) ?? escalationPolicy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESCALATION_POLICIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {escalationPolicyLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsAgentTarget ? (
            <div className="space-y-1.5">
              <Label>Agente-alvo do escalonamento</Label>
              <Select value={escalationTargetAgentId} onValueChange={(value) => setEscalationTargetAgentId(value ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o agente-alvo" />
                </SelectTrigger>
                <SelectContent>
                  {agentsQuery.data?.data.map((agent) => (
                    <SelectItem key={agent.id} value={String(agent.id)}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {needsUserTarget ? (
            <div className="space-y-1.5">
              <Label>Usuário-alvo do escalonamento</Label>
              <Select value={escalationTargetUserId} onValueChange={(value) => setEscalationTargetUserId(value ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o usuário-alvo" />
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
          ) : null}

          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="edit-responsibility-enabled" className="cursor-pointer">
              Habilitada
            </Label>
            <Button
              id="edit-responsibility-enabled"
              type="button"
              size="sm"
              variant={enabled ? "default" : "outline"}
              onClick={() => setEnabled((value) => !value)}
            >
              {enabled ? "Habilitada" : "Desabilitada"}
            </Button>
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit || update.isPending}>
            Salvar alterações
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
