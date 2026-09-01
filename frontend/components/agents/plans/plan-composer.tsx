"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/auth/permission-gate";
import { useCreateActionPlan } from "@/hooks/agents/use-action-plans";
import { toErrorMessage } from "@/services/http";

/**
 * Correio.md v1.2 seção 9 — ponto de entrada do Diretor Virtual para
 * múltiplas ações: o usuário descreve um objetivo em texto livre, o
 * backend (POST /agents/action-plans) monta o Action Plan, avalia cada
 * ação e já executa o que puder. Exige `agents.plan` — o backend é quem
 * barra de verdade.
 */
export function PlanComposer() {
  const [objective, setObjective] = useState("");
  const router = useRouter();
  const createPlan = useCreateActionPlan();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = objective.trim();
    if (!trimmed) return;

    try {
      const response = await createPlan.mutateAsync(trimmed);
      setObjective("");
      toast.success("Plano de ações gerado.");
      router.push(`/agents/plans/${response.data.plan.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao gerar plano de ações."));
    }
  }

  return (
    <PermissionGate permission="agents.plan">
      <Card>
        <CardHeader>
          <p className="text-sm font-medium">Novo plano de ações</p>
          <p className="text-xs text-muted-foreground">
            Descreva um objetivo em texto livre. O Diretor Virtual monta um plano estruturado, avalia cada ação
            (executa/pede aprovação/bloqueia/só sugere) e já roda o que puder ser feito automaticamente.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <Textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Ex.: Crie uma tarefa para o comercial entrar em contato com todos os leads quentes sem atividade há 7 dias."
              className="min-h-20 flex-1"
              disabled={createPlan.isPending}
            />
            <Button type="submit" disabled={createPlan.isPending || !objective.trim()}>
              <Sparkles className="size-4" />
              Gerar plano
            </Button>
          </form>
        </CardContent>
      </Card>
    </PermissionGate>
  );
}
