"use client";

import { Bot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useAgentExecutions } from "@/hooks/agents/use-agent-executions";
import { useAgentToolsForAgent } from "@/hooks/agents/use-agent-tools";
import { useAgents } from "@/hooks/agents/use-agents";
import { formatDateTime } from "@/lib/agents/format";
import type { Agent, AgentStatus } from "@/types/agents";

import { ExecutionStatusBadge } from "./status-badge";

const STATUS_LABELS: Record<AgentStatus, string> = {
  active: "Ativo",
  paused: "Pausado",
  disabled: "Desativado",
};

const DEPARTMENT_LABELS: Record<string, string> = {
  director: "Diretoria",
  sales: "Comercial",
  projects: "Projetos",
  finance: "Financeiro",
  support: "Suporte",
  customer_success: "Customer Success",
};

function AgentCard({ agent }: { agent: Agent }) {
  const { data: tools } = useAgentToolsForAgent(agent.id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-muted">
            <Bot className="size-4 text-muted-foreground" aria-hidden />
          </div>
          <div>
            <CardTitle className="text-base">{agent.name}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {DEPARTMENT_LABELS[agent.department] ?? agent.department}
            </p>
          </div>
        </div>
        <Badge variant={agent.status === "active" ? "default" : "secondary"}>
          {STATUS_LABELS[agent.status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{agent.description ?? "Sem descrição."}</p>
        <p className="text-xs text-muted-foreground">
          {tools ? `${tools.data.length} ferramenta(s) disponível(is)` : "Carregando ferramentas..."}
        </p>
      </CardContent>
    </Card>
  );
}

// Seção 38: agentes disponíveis, departamento, status, descrição, tools
// disponíveis, últimas execuções.
export function AgentList() {
  const { data: agents, isLoading, isError, refetch } = useAgents();
  const { data: executions } = useAgentExecutions({ limit: 8 });

  if (isLoading) {
    return <LoadingState label="Carregando agentes..." />;
  }

  if (isError || !agents) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  if (agents.data.length === 0) {
    return <EmptyState title="Nenhum agente cadastrado" description="Rode o seed para cadastrar os agentes iniciais." />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.data.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimas execuções</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!executions || executions.data.length === 0 ? (
            <EmptyState title="Nenhuma execução ainda" description="As execuções de tools aparecerão aqui." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead>Ferramenta</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions.data.map((execution) => (
                    <TableRow key={execution.id}>
                      <TableCell>{formatDateTime(execution.createdAt)}</TableCell>
                      <TableCell>{execution.agentName}</TableCell>
                      <TableCell className="font-mono text-xs">{execution.toolHandler}</TableCell>
                      <TableCell>
                        <ExecutionStatusBadge status={execution.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
