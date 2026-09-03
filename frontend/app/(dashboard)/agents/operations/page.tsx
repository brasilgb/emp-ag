import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { ControlCenterSection } from "@/components/agents/operations/control-center-section";
import { OperationsDashboard } from "@/components/agents/operations/operations-dashboard";
import { OperationsSupervisorDashboard } from "@/components/agents/operations/operations-supervisor-dashboard";
import { OperationalSupervisionSchedulerCard } from "@/components/agents/operations/operational-supervision-scheduler-card";

export const metadata: Metadata = { title: "Operações de Agentes" };

export default function AgentOperationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operações</h1>
        <p className="text-sm text-muted-foreground">
          O que os agentes estão fazendo, o que falhou, o que foi bloqueado e o que aguarda intervenção.
        </p>
      </div>

      <AgentsSubNav />

      {/* Agentes v3.0 (correio.md "Etapa 2") — Operational Control
          Center: evolui esta MESMA página (nunca uma rota nova) com uma
          camada de observabilidade sobre a cadeia
          Responsibility → Supervisor → Escalation → FollowUp → Proposal →
          Action Plan → Approval — logo no topo, antes do dashboard de
          Jobs/Runs (v1.6) que já existia. */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Control Center</h2>
        <p className="text-sm text-muted-foreground">
          O que está acontecendo, parado, vencido, aguardando aprovação ou falhou — em toda a cadeia operacional.
        </p>
      </div>
      <ControlCenterSection />

      <OperationsDashboard />

      {/* Agentes v2.5 (correio.md seções 24-25) — Operational Supervisor:
          reaproveita esta MESMA página administrativa (nunca uma segunda
          tela paralela para "operações" — a v1.6 já é exatamente essa
          página; o Supervisor é uma seção adicional dela, não uma rota
          nova concorrente). */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Supervisão Operacional</h2>
        <p className="text-sm text-muted-foreground">
          Detecção e resposta segura a degradações operacionais — tela administrativa, não uma ferramenta de uso diário.
        </p>
      </div>
      <OperationalSupervisionSchedulerCard />

      <OperationsSupervisorDashboard />
    </div>
  );
}
