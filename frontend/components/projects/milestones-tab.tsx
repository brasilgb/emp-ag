"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermissionGate } from "@/components/auth/permission-gate";
import { MilestoneStatusBadge } from "@/components/projects/badges";
import { MilestoneForm } from "@/components/projects/milestone-form";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useCreateMilestone, useMilestones, useUpdateMilestone } from "@/hooks/projects/use-milestones";
import { formatDate } from "@/lib/projects/format";
import type { MilestoneFormValues } from "@/lib/validation/projects-schema";
import { toErrorMessage } from "@/services/http";
import type { Milestone } from "@/types/projects";

function MilestoneRow({ projectId, milestone }: { projectId: number; milestone: Milestone }) {
  const updateMilestone = useUpdateMilestone(projectId, milestone.id);

  async function toggleCompleted() {
    try {
      await updateMilestone.mutateAsync({
        status: milestone.status === "completed" ? "pending" : "completed",
      });
      toast.success("Milestone atualizado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar milestone."));
    }
  }

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div>
          <div className="flex items-center gap-2 font-medium">{milestone.name}</div>
          {milestone.description ? (
            <p className="text-sm text-muted-foreground">{milestone.description}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">Prazo: {formatDate(milestone.dueDate)}</p>
        </div>
        <div className="flex items-center gap-2">
          <MilestoneStatusBadge status={milestone.status} />
          <PermissionGate permission="milestones.update">
            <Button
              variant="outline"
              size="sm"
              disabled={updateMilestone.isPending}
              onClick={toggleCompleted}
            >
              {milestone.status === "completed" ? "Reabrir" : "Concluir"}
            </Button>
          </PermissionGate>
        </div>
      </CardContent>
    </Card>
  );
}

export function MilestonesTab({ projectId }: { projectId: number }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const milestonesQuery = useMilestones(projectId);
  const createMilestone = useCreateMilestone(projectId);

  async function handleCreate(values: MilestoneFormValues) {
    try {
      await createMilestone.mutateAsync(values);
      toast.success("Milestone criado.");
      setDialogOpen(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar milestone."));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <PermissionGate permission="milestones.create">
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus /> Novo milestone
          </Button>
        </PermissionGate>
      </div>

      {milestonesQuery.isLoading ? (
        <LoadingState label="Carregando milestones..." />
      ) : milestonesQuery.isError ? (
        <ErrorState onRetry={() => milestonesQuery.refetch()} />
      ) : !milestonesQuery.data || milestonesQuery.data.data.length === 0 ? (
        <EmptyState title="Nenhum milestone cadastrado" description="Adicione o primeiro milestone deste projeto." />
      ) : (
        <div className="space-y-3">
          {milestonesQuery.data.data.map((milestone) => (
            <MilestoneRow key={milestone.id} projectId={projectId} milestone={milestone} />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo milestone</DialogTitle>
          </DialogHeader>
          <MilestoneForm onSubmit={handleCreate} submitLabel="Criar milestone" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
