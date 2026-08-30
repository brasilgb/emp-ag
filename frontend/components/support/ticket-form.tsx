"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useClients } from "@/hooks/crm/use-clients";
import { useProjects } from "@/hooks/projects/use-projects";
import { useSupportCategories } from "@/hooks/support/use-support-categories";
import { PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/support/format";
import {
  ticketFormSchema,
  type TicketFormInput,
  type TicketFormValues,
} from "@/lib/validation/support-schema";
import { PRIORITIES, SOURCES } from "@/types/support";

interface TicketFormProps {
  defaultValues?: Partial<TicketFormInput>;
  onSubmit: (values: TicketFormValues) => Promise<void> | void;
  submitLabel?: string;
}

export function TicketForm({ defaultValues, onSubmit, submitLabel = "Salvar" }: TicketFormProps) {
  const clientsQuery = useClients({ limit: 100 });

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TicketFormInput, unknown, TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: { source: "manual", title: "", ...defaultValues },
  });

  const clientId = useWatch({ control, name: "clientId" });
  const categoriesQuery = useSupportCategories({ isActive: true });
  const projectsQuery = useProjects({ client: Number(clientId) || undefined, limit: 100 });

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
              onValueChange={(value) => {
                field.onChange(Number(value));
                setValue("projectId", undefined);
              }}
              disabled={clientsQuery.isLoading}
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="projectId">Projeto (opcional)</Label>
          <Controller
            control={control}
            name="projectId"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : "none"}
                onValueChange={(value) => field.onChange(value === "none" ? undefined : Number(value))}
                disabled={!clientId || projectsQuery.isLoading}
              >
                <SelectTrigger id="projectId" className="w-full">
                  <SelectValue placeholder="Sem projeto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem projeto</SelectItem>
                  {projectsQuery.data?.data.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="categoryId">Categoria</Label>
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : undefined}
                onValueChange={(value) => field.onChange(Number(value))}
                disabled={categoriesQuery.isLoading}
              >
                <SelectTrigger id="categoryId" className="w-full" aria-invalid={!!errors.categoryId}>
                  <SelectValue placeholder="Selecione uma categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categoriesQuery.data?.data.map((category) => (
                    <SelectItem key={category.id} value={String(category.id)}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.categoryId ? (
            <p className="text-xs text-destructive">{errors.categoryId.message}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="title">Título</Label>
        <Input id="title" aria-invalid={!!errors.title} {...register("title")} />
        {errors.title ? <p className="text-xs text-destructive">{errors.title.message}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="priority">Prioridade (opcional)</Label>
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <Select
                value={field.value ?? "auto"}
                onValueChange={(value) => field.onChange(value === "auto" ? undefined : value)}
              >
                <SelectTrigger id="priority" className="w-full">
                  <SelectValue placeholder="Da categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Padrão da categoria</SelectItem>
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

        <div className="space-y-1.5">
          <Label htmlFor="source">Origem</Label>
          <Controller
            control={control}
            name="source"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((source) => (
                    <SelectItem key={source} value={source}>
                      {SOURCE_LABELS[source]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Descrição</Label>
        <Textarea id="description" rows={4} {...register("description")} />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
