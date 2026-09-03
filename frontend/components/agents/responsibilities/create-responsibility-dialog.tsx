"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAgents } from "@/hooks/agents/use-agents";
import { useCreateResponsibility } from "@/hooks/agents/use-responsibilities";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { escalationPolicyLabel, responsibilityPriorityLabel, responsibilityTypeLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import {
  ESCALATION_POLICIES,
  RESPONSIBILITY_PRIORITIES,
  RESPONSIBILITY_TYPES,
  type EscalationPolicy,
  type ResponsibilityPriority,
  type ResponsibilityType,
  type SignalDomain,
} from "@/types/agents";

const DOMAIN_OPTIONS: SignalDomain[] = ["crm", "projects", "finance", "support", "agents"];

/**
 * Agentes v2.6 (correio.md seção 23) — "formulário estruturado... nunca
 * campo livre que resulte em execução". Todos os campos são seletores
 * fechados (Select) sobre o vocabulário real do backend, ou texto livre
 * puramente descritivo (name/description) que nunca é interpretado como
 * código/DSL — só persistido e exibido.
 */
export function CreateResponsibilityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const agentsQuery = useAgents();
  const usersQuery = useUsersDirectory();
  const create = useCreateResponsibility();

  const [agentId, setAgentId] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState<SignalDomain | null>(null);
  const [responsibilityType, setResponsibilityType] = useState<ResponsibilityType | null>(null);
  const [priority, setPriority] = useState<ResponsibilityPriority>("medium");
  const [escalationPolicy, setEscalationPolicy] = useState<EscalationPolicy>("none");
  const [escalationTargetAgentId, setEscalationTargetAgentId] = useState<string>("");
  const [escalationTargetUserId, setEscalationTargetUserId] = useState<string>("");

  const needsAgentTarget = escalationPolicy === "agent" || escalationPolicy === "agent_then_human";
  const needsUserTarget = escalationPolicy === "human" || escalationPolicy === "agent_then_human";

  const canSubmit =
    agentId !== "" &&
    name.trim().length > 0 &&
    domain !== null &&
    responsibilityType !== null &&
    (!needsAgentTarget || escalationTargetAgentId !== "") &&
    (!needsUserTarget || escalationTargetUserId !== "");

  function reset() {
    setAgentId("");
    setName("");
    setDescription("");
    setDomain(null);
    setResponsibilityType(null);
    setPriority("medium");
    setEscalationPolicy("none");
    setEscalationTargetAgentId("");
    setEscalationTargetUserId("");
  }

  async function handleSubmit() {
    if (domain === null || responsibilityType === null || !canSubmit) return;

    try {
      await create.mutateAsync({
        agentId: Number(agentId),
        name: name.trim(),
        description: description.trim() || undefined,
        domain,
        responsibilityType,
        priority,
        escalationPolicy,
        escalationTargetAgentId: needsAgentTarget ? Number(escalationTargetAgentId) : undefined,
        escalationTargetUserId: needsUserTarget ? Number(escalationTargetUserId) : undefined,
      });
      toast.success("Responsibility criada.");
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar Responsibility."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Responsibility</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Agente responsável</Label>
            <Select value={agentId} onValueChange={(value) => setAgentId(value ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o agente" />
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

          <div className="space-y-1.5">
            <Label htmlFor="responsibility-name">Nome</Label>
            <Input id="responsibility-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Monitorar SLA de Suporte" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="responsibility-description">Descrição (opcional)</Label>
            <Textarea id="responsibility-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Domínio</Label>
              <Select value={domain ?? ""} onValueChange={(value) => setDomain((value as SignalDomain) || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Domínio" />
                </SelectTrigger>
                <SelectContent>
                  {DOMAIN_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={responsibilityType ?? ""} onValueChange={(value) => setResponsibilityType((value as ResponsibilityType) || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  {RESPONSIBILITY_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {responsibilityTypeLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Prioridade</Label>
            <Select value={priority} onValueChange={(value) => setPriority((value as ResponsibilityPriority) ?? "medium")}>
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
            <Label>Política de escalonamento</Label>
            <Select value={escalationPolicy} onValueChange={(value) => setEscalationPolicy((value as EscalationPolicy) ?? "none")}>
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

          <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit || create.isPending}>
            Criar Responsibility
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
