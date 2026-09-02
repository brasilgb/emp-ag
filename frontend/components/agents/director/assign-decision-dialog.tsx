"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { useAssignDecision } from "@/hooks/agents/use-director-decisions";
import { toErrorMessage } from "@/services/http";

/**
 * Agentes v1.9 (correio.md seção 15) — atribuir "responsável operacional
 * pelo acompanhamento". Nunca autorização para executar ferramentas — só
 * um seletor de usuário, o backend valida existência e audita.
 */
export function AssignDecisionDialog({
  decisionId,
  open,
  onOpenChange,
}: {
  decisionId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const usersQuery = useUsersDirectory();
  const assign = useAssignDecision();
  const [userId, setUserId] = useState<string | undefined>(undefined);

  async function handleAssign() {
    if (!userId) return;

    try {
      await assign.mutateAsync({ id: decisionId, userId: Number(userId) });
      toast.success("Item atribuído.");
      onOpenChange(false);
      setUserId(undefined);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atribuir."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atribuir responsável</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Select
            value={userId}
            onValueChange={(value) => setUserId(value ?? undefined)}
            disabled={usersQuery.isLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione um usuário" />
            </SelectTrigger>
            <SelectContent>
              {usersQuery.data?.data.map((user) => (
                <SelectItem key={user.id} value={String(user.id)}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="w-full" onClick={handleAssign} disabled={!userId || assign.isPending}>
            Atribuir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
