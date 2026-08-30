"use client";

import { Clock, FolderKanban, ListChecks, ListTodo } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { useProjectStats } from "@/hooks/projects/use-project-stats";
import { useAuth } from "@/lib/auth/use-auth";

/**
 * Cards reais de Projetos/Tarefas do dashboard geral — GET /projects/stats
 * agrega tudo via SQL (count/filter) no backend; aqui só exibimos os
 * números prontos, nunca recalculamos indicadores no frontend.
 */
export function ProjectStatsCards() {
  const { can } = useAuth();
  const canReadProjects = can("projects.read");

  const statsQuery = useProjectStats();
  const stats = canReadProjects ? statsQuery.data?.data : undefined;

  const items = [
    { label: "Projetos ativos", icon: FolderKanban, value: stats?.activeProjects },
    { label: "Projetos atrasados", icon: Clock, value: stats?.overdueProjects },
    { label: "Tarefas abertas", icon: ListTodo, value: stats?.openTasks },
    { label: "Tarefas vencidas", icon: Clock, value: stats?.overdueTasks },
    { label: "Tarefas em revisão", icon: ListChecks, value: stats?.inReviewTasks },
  ];

  return (
    <>
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value ?? "--"} icon={item.icon} />
      ))}
    </>
  );
}
