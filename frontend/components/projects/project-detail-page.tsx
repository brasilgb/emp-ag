"use client";

import { useState } from "react";
import Link from "next/link";
import { ArchiveRestore, ArrowLeft, MoreHorizontal, Pencil, Trash2, UserRoundCog } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionGate } from "@/components/auth/permission-gate";
import { PriorityBadge, ProjectStatusBadge } from "@/components/projects/badges";
import { MilestonesTab } from "@/components/projects/milestones-tab";
import { ProjectForm } from "@/components/projects/project-form";
import { ProjectHistoryTab } from "@/components/projects/project-history-tab";
import { ProjectOverviewTab } from "@/components/projects/project-overview-tab";
import { TasksTab } from "@/components/projects/tasks-tab";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useProject, useUpdateProject } from "@/hooks/projects/use-projects";
import type { ProjectFormValues } from "@/lib/validation/projects-schema";
import { toErrorMessage } from "@/services/http";

export function ProjectDetailPage({ projectId }: { projectId: number }) {
  const [editing, setEditing] = useState(false);

  const projectQuery = useProject(projectId);
  const updateProject = useUpdateProject(projectId);

  if (projectQuery.isLoading) {
    return <LoadingState label="Carregando projeto..." />;
  }

  if (projectQuery.isError || !projectQuery.data) {
    return <ErrorState onRetry={() => projectQuery.refetch()} />;
  }

  const project = projectQuery.data.data;

  async function handleUpdate(values: ProjectFormValues) {
    try {
      await updateProject.mutateAsync(values);
      toast.success("Projeto atualizado com sucesso.");
      setEditing(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar projeto."));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/projects" />} className="mb-2 -ml-2">
          <ArrowLeft /> Projetos
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <ProjectStatusBadge status={project.status} />
              <PriorityBadge priority={project.priority} />
            </div>
            <p className="text-sm text-muted-foreground">
              {project.clientName}
              {project.ownerName ? ` · Responsável: ${project.ownerName}` : ""}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <PermissionGate permission="projects.update">
              <Button variant="outline" onClick={() => setEditing((value) => !value)}>
                <Pencil /> {editing ? "Cancelar edição" : "Editar"}
              </Button>
            </PermissionGate>

            <PermissionGate permission="projects.manage">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="icon">
                      <MoreHorizontal />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled>
                    <UserRoundCog /> Alterar responsável
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <ArchiveRestore /> Arquivar projeto
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled variant="destructive">
                    <Trash2 /> Excluir projeto
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </PermissionGate>
          </div>
        </div>
      </div>

      <Tabs defaultValue="visao-geral">
        <TabsList>
          <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
          <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="visao-geral" className="mt-4">
          <Card className="max-w-2xl">
            <CardContent className="pt-6">
              {editing ? (
                <ProjectForm
                  defaultValues={{
                    clientId: project.clientId,
                    name: project.name,
                    description: project.description ?? undefined,
                    status: project.status,
                    priority: project.priority,
                    ownerUserId: project.ownerUserId ?? undefined,
                    startDate: project.startDate ?? undefined,
                    dueDate: project.dueDate ?? undefined,
                    estimatedValue: project.estimatedValue ? Number(project.estimatedValue) : undefined,
                    estimatedHours: project.estimatedHours ? Number(project.estimatedHours) : undefined,
                    notes: project.notes ?? undefined,
                  }}
                  onSubmit={handleUpdate}
                  submitLabel="Salvar alterações"
                />
              ) : (
                <ProjectOverviewTab project={project} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tarefas" className="mt-4">
          <TasksTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="milestones" className="mt-4">
          <MilestonesTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <ProjectHistoryTab projectId={project.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
