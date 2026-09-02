"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useGlobalAutonomy, useSetGlobalAutonomy } from "@/hooks/agents/use-operations";
import { toErrorMessage } from "@/services/http";

// Agentes v1.6 (correio.md seção 7) — global autonomy switch: exibe
// estado atual e permite alterar, respeitando `agents.autonomy.manage`.
// Ações destrutivas/de impacto amplo exigem confirmação de UI —
// `window.confirm` é a confirmação mínima usada no resto do módulo
// Agentes (mesmo padrão de cancel/reject em approvals) para esta ação
// que afeta TODOS os Jobs autônomos de uma vez.
export function GlobalAutonomyToggle() {
  const { data, isLoading, isError, refetch } = useGlobalAutonomy();
  const setAutonomy = useSetGlobalAutonomy();

  async function handleToggle(next: boolean) {
    if (!next) {
      const confirmed = window.confirm(
        "Desligar a autonomia global bloqueia TODOS os disparos automáticos (schedule/evento) de TODOS os Jobs. Execuções manuais continuam funcionando. Confirmar?",
      );
      if (!confirmed) return;
    }

    try {
      await setAutonomy.mutateAsync(next);
      toast.success(next ? "Autonomia global ligada." : "Autonomia global desligada.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao alterar autonomia global."));
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Autonomia global</h3>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingState label="Carregando..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">
              Execuções automáticas (schedule/evento) estão{" "}
              <span className={data.data.enabled ? "font-medium text-emerald-700 dark:text-emerald-400" : "font-medium text-red-700 dark:text-red-400"}>
                {data.data.enabled ? "ligadas" : "desligadas"}
              </span>
              .
            </p>
            <PermissionGate permission="agents.autonomy.manage">
              <Button
                variant={data.data.enabled ? "destructive" : "default"}
                size="sm"
                disabled={setAutonomy.isPending}
                onClick={() => handleToggle(!data.data.enabled)}
              >
                {data.data.enabled ? "Desligar" : "Ligar"}
              </Button>
            </PermissionGate>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
