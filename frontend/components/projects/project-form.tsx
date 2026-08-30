"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useClients } from "@/hooks/crm/use-clients";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { PRIORITY_LABELS } from "@/lib/projects/format";
import {
  projectFormSchema,
  type ProjectFormInput,
  type ProjectFormValues,
} from "@/lib/validation/projects-schema";
import { PRIORITIES, PROJECT_STATUSES } from "@/types/projects";
import { PROJECT_STATUS_LABELS } from "@/lib/projects/format";

interface ProjectFormProps {
  defaultValues?: Partial<ProjectFormInput>;
  onSubmit: (values: ProjectFormValues) => Promise<void> | void;
  submitLabel?: string;
  /** Pré-seleciona o cliente e trava o campo (fluxo "Cliente → Novo Projeto"). */
  lockedClientId?: number;
}

export function ProjectForm({
  defaultValues,
  onSubmit,
  submitLabel = "Salvar",
  lockedClientId,
}: ProjectFormProps) {
  const clientsQuery = useClients({ limit: 100 });
  const usersQuery = useUsersDirectory();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormInput, unknown, ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      status: "draft",
      priority: "normal",
      name: "",
      clientId: lockedClientId,
      ...defaultValues,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="clientId">Cliente</Label>
        <Controller
          control={control}
          name="clientId"
          render={({ field }) => (
            <Select
              value={field.value ? String(field.value) : undefined}
              onValueChange={(value) => field.onChange(Number(value))}
              disabled={Boolean(lockedClientId) || clientsQuery.isLoading}
            >
              <SelectTrigger id="clientId" className="w-full" aria-invalid={!!errors.clientId}>
                <SelectValue placeholder="Selecione um cliente" />
              </SelectTrigger>
              <SelectContent>
                {clientsQuery.data?.data.map((client) => (
                  <SelectItem key={client.id} value={String(client.id)}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.clientId ? <p className="text-xs text-destructive">{errors.clientId.message}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="name">Nome do projeto</Label>
        <Input id="name" aria-invalid={!!errors.name} {...register("name")} />
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {PROJECT_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="priority">Prioridade</Label>
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {PRIORITY_LABELS[priority]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ownerUserId">Responsável</Label>
        <Controller
          control={control}
          name="ownerUserId"
          render={({ field }) => (
            <Select
              value={field.value ? String(field.value) : "none"}
              onValueChange={(value) => field.onChange(value === "none" ? undefined : Number(value))}
              disabled={usersQuery.isLoading}
            >
              <SelectTrigger id="ownerUserId" className="w-full">
                <SelectValue placeholder="Sem responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem responsável</SelectItem>
                {usersQuery.data?.data.map((user) => (
                  <SelectItem key={user.id} value={String(user.id)}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Início</Label>
          <Input id="startDate" type="date" {...register("startDate")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dueDate">Prazo</Label>
          <Input id="dueDate" type="date" {...register("dueDate")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="estimatedValue">Valor estimado (R$)</Label>
          <Input id="estimatedValue" type="number" step="0.01" min="0" {...register("estimatedValue")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="estimatedHours">Horas estimadas</Label>
          <Input id="estimatedHours" type="number" step="0.5" min="0" {...register("estimatedHours")} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Descrição</Label>
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Observações</Label>
        <Textarea id="notes" rows={2} {...register("notes")} />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
