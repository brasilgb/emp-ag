import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { GoalsList } from "@/components/agents/director/goals/goals-list";

export const metadata: Metadata = { title: "Objetivos Estratégicos" };

export default function DirectorGoalsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Objetivos Estratégicos</h1>
        <p className="text-sm text-muted-foreground">Goals definidos pelo CEO, progresso, saúde e prazos.</p>
      </div>

      <AgentsSubNav />

      <GoalsList />
    </div>
  );
}
