import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { MemoriesList } from "@/components/agents/director/memory/memories-list";

export const metadata: Metadata = { title: "Aprendizados Estratégicos" };

export default function DirectorMemoriesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Aprendizados Estratégicos</h1>
        <p className="text-sm text-muted-foreground">
          Histórico de aprendizados extraídos de Executive Reviews — orientação consultiva para o Diretor, nunca uma regra obrigatória.
        </p>
      </div>

      <AgentsSubNav />

      <MemoriesList />
    </div>
  );
}
