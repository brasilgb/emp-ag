"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useOperationalSupervisionSchedulerStatus, useSetOperationalSupervisionSchedulerEnabled } from "@/hooks/agents/use-operations-supervisor";
import { schedulerLastResultLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";

/**
 * Agentes v2.5.1 (correio.md seções 24/25) — seção pequena na MESMA
 * página `/agents/operations` (nunca uma rota nova). Mesmo padrão de
 * confirmação de `GlobalAutonomyToggle` (v1.6) — `window.confirm`, único
 * mecanismo de confirmação já usado no módulo Agentes para ações de
 * impacto amplo. Texto de confirmação ao LIGAR é o exato pedido pela
 * seção 25 — nunca "permitir que a IA corrija o sistema sozinha".
 */
export function OperationalSupervisionSchedulerCard() {
  const { data, isLoading, isError, refetch } = useOperationalSupervisionSchedulerStatus();
  const setEnabled = useSetOperationalSupervisionSchedulerEnabled();

  async function handleToggle(next: boolean) {
    if (next) {
      const confirmed = window.confirm(
        "A supervisão operacional passará a executar automaticamente e poderá realizar recoveries seguros, restringir autonomia em situações críticas e escalar incidentes para atenção humana conforme as políticas atuais. Confirmar?",
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm("Desligar a supervisão automática? Os botões de simulação/execução manual continuam disponíveis.");
      if (!confirmed) return;
    }

    try {
      await setEnabled.mutateAsync(next);
      toast.success(next ? "Supervisão automática habilitada." : "Supervisão automática desabilitada.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao alterar a supervisão automática."));
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Supervisão automática</h3>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingState label="Carregando..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm">
                Execução automática está{" "}
                <span className={data.data.enabled ? "font-medium text-emerald-700 dark:text-emerald-400" : "font-medium text-muted-foreground"}>
                  {data.data.enabled ? "habilitada" : "desabilitada"}
                </span>
                {data.data.running ? <span className="ml-2 text-xs text-blue-700 dark:text-blue-400">executando agora</span> : null}
                {!data.data.active ? <span className="ml-2 text-xs text-muted-foreground">(scheduler não iniciado nesta implantação)</span> : null}
              </p>
              <PermissionGate permission="agents.operations.manage">
                <Button
                  variant={data.data.enabled ? "destructive" : "default"}
                  size="sm"
                  disabled={setEnabled.isPending || !data.data.active}
                  onClick={() => handleToggle(!data.data.enabled)}
                >
                  {data.data.enabled ? "Desabilitar" : "Habilitar"}
                </Button>
              </PermissionGate>
            </div>

            <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p>Intervalo</p>
                <p className="font-medium text-foreground">{data.data.intervalSeconds}s</p>
              </div>
              <div>
                <p>Último início</p>
                <p className="font-medium text-foreground">{data.data.lastStartedAt ? formatDateTime(data.data.lastStartedAt) : "--"}</p>
              </div>
              <div>
                <p>Última conclusão</p>
                <p className="font-medium text-foreground">{data.data.lastCompletedAt ? formatDateTime(data.data.lastCompletedAt) : "--"}</p>
              </div>
              <div>
                <p>Última falha</p>
                <p className="font-medium text-foreground">{data.data.lastFailedAt ? formatDateTime(data.data.lastFailedAt) : "--"}</p>
              </div>
              <div>
                <p>Duração</p>
                <p className="font-medium text-foreground">{data.data.lastDurationMs !== null ? `${data.data.lastDurationMs}ms` : "--"}</p>
              </div>
              <div>
                <p>Resultado</p>
                <p className="font-medium text-foreground">{data.data.lastResult ? schedulerLastResultLabel(data.data.lastResult) : "--"}</p>
              </div>
              <div>
                <p>Próximo ciclo</p>
                <p className="font-medium text-foreground">{data.data.nextRunAt ? formatDateTime(data.data.nextRunAt) : "--"}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
