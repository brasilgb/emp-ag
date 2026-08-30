import { OverdueBadge } from "@/components/projects/badges";
import { isProjectOverdue } from "@/lib/projects/derived";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/projects/format";
import type { ProjectDetail } from "@/types/projects";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function ProjectOverviewTab({ project }: { project: ProjectDetail }) {
  const overdue = isProjectOverdue(project);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Progresso</span>
          <span className="font-medium">{project.progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${project.progress}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {project.taskCounts.done} de {project.taskCounts.total - project.taskCounts.cancelled}{" "}
          tarefas concluídas
          {project.taskCounts.cancelled > 0
            ? ` (${project.taskCounts.cancelled} cancelada(s) não contam)`
            : ""}
          .
        </p>
      </div>

      <div className="divide-y">
        <InfoRow label="Descrição" value={project.description ?? "--"} />
        <InfoRow label="Início" value={formatDate(project.startDate)} />
        <div className="flex items-center justify-between gap-4 py-2 text-sm">
          <span className="text-muted-foreground">Prazo</span>
          <span className="flex items-center gap-2 font-medium">
            {formatDate(project.dueDate)}
            {overdue ? <OverdueBadge /> : null}
          </span>
        </div>
        <InfoRow label="Conclusão" value={formatDateTime(project.completedAt)} />
        <InfoRow label="Valor estimado" value={formatCurrency(project.estimatedValue)} />
        <InfoRow label="Horas estimadas" value={project.estimatedHours ?? "--"} />
        <InfoRow label="Observações" value={project.notes ?? "--"} />
      </div>
    </div>
  );
}
