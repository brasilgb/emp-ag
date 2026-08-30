"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProjectStatusBadge, PriorityBadge, OverdueBadge } from "@/components/projects/badges";
import { ProjectForm } from "@/components/projects/project-form";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useCreateProject, useProjects } from "@/hooks/projects/use-projects";
import { isProjectOverdue } from "@/lib/projects/derived";
import { formatDate } from "@/lib/projects/format";
import type { ProjectFormValues } from "@/lib/validation/projects-schema";
import { toErrorMessage } from "@/services/http";
import { PROJECT_STATUS_LABELS } from "@/lib/projects/format";
import { PROJECT_STATUSES, type ProjectStatus } from "@/types/projects";

const LIMIT = 20;

export function ProjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lockedClientId = searchParams.get("clientId");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [sheetOpen, setSheetOpen] = useState(Boolean(lockedClientId));

  const { data, isLoading, isError, refetch } = useProjects({
    page,
    limit: LIMIT,
    search: search || undefined,
    status: status === "all" ? undefined : status,
  });

  const createProject = useCreateProject();

  async function handleCreate(values: ProjectFormValues) {
    try {
      const { data: project } = await createProject.mutateAsync(values);
      toast.success("Projeto criado com sucesso.");
      setSheetOpen(false);
      router.push(`/projects/${project.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar projeto."));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
          <p className="text-sm text-muted-foreground">
            Planejamento e execução dos projetos em andamento.
          </p>
        </div>
        <PermissionGate permission="projects.create">
          <Button onClick={() => setSheetOpen(true)}>
            <Plus /> Novo Projeto
          </Button>
        </PermissionGate>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Buscar por nome ou descrição"
              className="pl-8"
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value as ProjectStatus | "all");
            }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {PROJECT_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {PROJECT_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <LoadingState label="Carregando projetos..." />
          ) : isError || !data ? (
            <ErrorState onRetry={() => refetch()} />
          ) : data.data.length === 0 ? (
            <EmptyState
              title="Nenhum projeto encontrado"
              description="Ajuste os filtros ou cadastre o primeiro projeto."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Progresso</TableHead>
                    <TableHead>Prazo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((project) => (
                    <TableRow
                      key={project.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <TableCell className="font-medium">{project.name}</TableCell>
                      <TableCell>{project.clientName}</TableCell>
                      <TableCell>
                        <ProjectStatusBadge status={project.status} />
                      </TableCell>
                      <TableCell>
                        <PriorityBadge priority={project.priority} />
                      </TableCell>
                      <TableCell>{project.ownerName ?? "--"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${project.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{project.progress}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {formatDate(project.dueDate)}
                          {isProjectOverdue(project) ? <OverdueBadge /> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data ? <PaginationBar pagination={data.pagination} onPageChange={setPage} /> : null}
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Novo projeto</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <ProjectForm
              onSubmit={handleCreate}
              submitLabel="Criar projeto"
              lockedClientId={lockedClientId ? Number(lockedClientId) : undefined}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
