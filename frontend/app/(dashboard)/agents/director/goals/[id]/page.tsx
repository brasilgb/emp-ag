import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { GoalDetail } from "@/components/agents/director/goals/goal-detail";

export const metadata: Metadata = { title: "Goal Estratégico" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const goalId = Number(id);

  if (!Number.isInteger(goalId) || goalId <= 0) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Goal #{goalId}</h1>
        <p className="text-sm text-muted-foreground">Painel executivo do objetivo estratégico.</p>
      </div>

      <AgentsSubNav />

      <GoalDetail goalId={goalId} />
    </div>
  );
}
