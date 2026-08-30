import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { InterpreterStatsView } from "@/components/agents/interpreter/interpreter-stats";

export const metadata: Metadata = { title: "LLM Interpreter" };

export default function AgentInterpreterPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">LLM Interpreter</h1>
        <p className="text-sm text-muted-foreground">
          Observabilidade do Shadow Mode — compara o roteador determinístico com o LLM sem afetar as respostas.
        </p>
      </div>

      <AgentsSubNav />

      <InterpreterStatsView />
    </div>
  );
}
