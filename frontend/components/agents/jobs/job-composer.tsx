"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/auth/permission-gate";
import { useAgents } from "@/hooks/agents/use-agents";
import { useCreateAgentJob } from "@/hooks/agents/use-agent-jobs";
import { jobTriggerTypeLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import { JOB_TRIGGER_TYPES, type JobTriggerType } from "@/types/agents";

/**
 * Correio.md v1.3 seção 17 — criar Job: nome, objetivo, agente
 * responsável, trigger, frequência, shadow mode, limites. Deixa claro que
 * ativar automação NÃO concede novas permissões — o Job sempre roda com
 * as permissions de quem o criou (agents/jobs/job-runner.ts).
 */
export function JobComposer() {
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [agentSlug, setAgentSlug] = useState("");
  const [triggerType, setTriggerType] = useState<JobTriggerType>("manual");
  const [frequency, setFrequency] = useState<"daily" | "hourly">("daily");
  const [hour, setHour] = useState(8);
  const [minute, setMinute] = useState(0);
  const [interval, setInterval] = useState(4);
  const [shadowMode, setShadowMode] = useState(false);
  const [allowConcurrentRuns, setAllowConcurrentRuns] = useState(false);
  const [maxRunsPerDay, setMaxRunsPerDay] = useState(24);
  const [maxActionsPerRun, setMaxActionsPerRun] = useState(10);
  const [maxOpenApprovals, setMaxOpenApprovals] = useState(10);
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);

  const { data: agents } = useAgents();
  const router = useRouter();
  const createJob = useCreateAgentJob();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!name.trim() || !objective.trim() || !agentSlug) return;

    try {
      const response = await createJob.mutateAsync({
        name: name.trim(),
        objective: objective.trim(),
        agentSlug,
        triggerType,
        scheduleConfig:
          triggerType === "schedule"
            ? frequency === "daily"
              ? { frequency: "daily", hour, minute }
              : { frequency: "hourly", interval }
            : undefined,
        shadowMode,
        allowConcurrentRuns,
        maxRunsPerDay,
        maxActionsPerRun,
        maxOpenApprovals,
        timeoutSeconds,
      });

      toast.success("Job criado.");
      setName("");
      setObjective("");
      router.push(`/agents/jobs/${response.data.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar Job."));
    }
  }

  return (
    <PermissionGate permission="agents.jobs.create">
      <Card>
        <CardHeader>
          <p className="text-sm font-medium">Novo Job</p>
          <p className="text-xs text-muted-foreground">
            Um objetivo operacional persistente, reexecutado ao longo do tempo. Ativar automação (trigger agendado)
            NÃO concede nenhuma permissão nova — o Job sempre roda com as permissions de quem o criou.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Resumo executivo diário" />
            </div>

            <div className="space-y-1.5">
              <Label>Agente responsável</Label>
              <Select value={agentSlug} onValueChange={(value) => setAgentSlug(value ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione um agente" />
                </SelectTrigger>
                <SelectContent>
                  {(agents?.data ?? []).map((agent) => (
                    <SelectItem key={agent.id} value={agent.slug}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Objetivo</Label>
              <Textarea
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder="Ex.: Todos os dias analise o resumo financeiro e o pipeline comercial e prepare uma visão executiva."
                className="min-h-16"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select value={triggerType} onValueChange={(value) => setTriggerType(value as JobTriggerType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_TRIGGER_TYPES.filter((value) => value !== "internal_event").map((value) => (
                    <SelectItem key={value} value={value}>
                      {jobTriggerTypeLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {triggerType === "schedule" ? (
              <div className="space-y-1.5">
                <Label>Frequência</Label>
                <div className="flex items-center gap-2">
                  <Select value={frequency} onValueChange={(value) => setFrequency(value as "daily" | "hourly")}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Diária</SelectItem>
                      <SelectItem value="hourly">De hora em hora</SelectItem>
                    </SelectContent>
                  </Select>

                  {frequency === "daily" ? (
                    <>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={hour}
                        onChange={(event) => setHour(Number(event.target.value))}
                        className="w-16"
                        aria-label="Hora"
                      />
                      <span className="text-sm text-muted-foreground">h</span>
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        value={minute}
                        onChange={(event) => setMinute(Number(event.target.value))}
                        className="w-16"
                        aria-label="Minuto"
                      />
                      <span className="text-sm text-muted-foreground">min (UTC)</span>
                    </>
                  ) : (
                    <>
                      <Input
                        type="number"
                        min={1}
                        max={24}
                        value={interval}
                        onChange={(event) => setInterval(Number(event.target.value))}
                        className="w-16"
                        aria-label="Intervalo em horas"
                      />
                      <span className="text-sm text-muted-foreground">em horas</span>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-4 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={shadowMode} onChange={(event) => setShadowMode(event.target.checked)} />
                Shadow Mode (nenhuma ação que altera dados executa de fato)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowConcurrentRuns}
                  onChange={(event) => setAllowConcurrentRuns(event.target.checked)}
                />
                Permitir Runs concorrentes
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Máx. runs/dia</Label>
                <Input type="number" min={1} value={maxRunsPerDay} onChange={(event) => setMaxRunsPerDay(Number(event.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Máx. ações/run</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={maxActionsPerRun}
                  onChange={(event) => setMaxActionsPerRun(Number(event.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Máx. aprovações abertas</Label>
                <Input
                  type="number"
                  min={0}
                  value={maxOpenApprovals}
                  onChange={(event) => setMaxOpenApprovals(Number(event.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Timeout (s)</Label>
                <Input
                  type="number"
                  min={1}
                  value={timeoutSeconds}
                  onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit" disabled={createJob.isPending || !name.trim() || !objective.trim() || !agentSlug}>
                <Sparkles className="size-4" />
                Criar Job
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PermissionGate>
  );
}
