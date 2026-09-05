import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { ControlCenterSection } from "@/components/agents/operations/control-center-section";
import { OperationsDashboard } from "@/components/agents/operations/operations-dashboard";
import { OperationsSupervisorDashboard } from "@/components/agents/operations/operations-supervisor-dashboard";
import { OperationalSupervisionSchedulerCard } from "@/components/agents/operations/operational-supervision-scheduler-card";
import { OwnershipAndAttentionSection } from "@/components/agents/operations/ownership-and-attention-section";
import { SlaAnalyticsSection } from "@/components/agents/operations/sla-analytics-section";
import { SupervisionInsightsSection } from "@/components/agents/operations/supervision-insights-section";
import { SupervisionRunHistorySection } from "@/components/agents/operations/supervision-run-history-section";

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

      {/* Agentes v3.4 (correio.md "Operational Supervision Observability &
          Run History") — histórico persistente das execuções (scheduler
          ou manual), integrado a esta MESMA seção de Supervisão
          Operacional (nunca uma página nova). */}
      <SupervisionRunHistorySection />

      {/* Agentes v3.5 (correio.md "Operational Supervision Insights &
          Incident Review") — evolui a MESMA seção de Supervisão
          Operacional (nunca uma página nova): visão consolidada,
          histórico pesquisável de incidentes, detalhe por incidente e
          recorrência — tudo sobre dados já persistidos por v2.5/v2.6/v3.4,
          nenhuma tabela nova. */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Insights de Supervisão</h2>
        <p className="text-sm text-muted-foreground">
          Recorrência, severidade, respostas aplicadas e resultados — análise e revisão dos incidentes já detectados.
        </p>
      </div>

      {/* Agentes v3.7 (correio.md "Operational Incident Review Queue &
          Attention Management") — fila humana de revisão, construída
          exclusivamente sobre v3.5/v3.6 (nenhuma tabela nova, nenhum
          conceito novo de incidente). Antes do histórico completo: é o
          que o operador olha primeiro ao entrar nesta seção.
          Agentes v3.9 (correio.md "Operational Ownership Workload &
          Human Coordination Views") — "Ownership" (workload por
          responsável) acoplado à MESMA fila, nunca uma segunda
          listagem: clicar num responsável filtra a fila abaixo. */}
      <OwnershipAndAttentionSection />

      <SupervisionInsightsSection />

      {/* Agentes v4.2 (correio.md "Operational SLA Analytics &
          Performance Visibility") — evolui a MESMA seção de Supervisão
          Operacional (nunca uma página/dashboard nova): indicadores
          agregados de SLA/desempenho sobre os incidentes já
          detectados/revisados/atribuídos acima — breach rate, tempo de
          acknowledgement/resolução, breakdown por severidade/responsável
          e tendência temporal. Estritamente analítica/observacional
          (nenhuma automação, nenhum ranking de pessoas). */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Analytics de SLA</h2>
        <p className="text-sm text-muted-foreground">
          Breach rate, tempo de resposta e tendência — indicadores agregados sobre os incidentes já detectados.
        </p>
      </div>
      <SlaAnalyticsSection />
    </div>
  );
}
