"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCategories } from "@/hooks/financial/use-categories";
import { useClients } from "@/hooks/crm/use-clients";
import { useProjects } from "@/hooks/projects/use-projects";
import { ENTRY_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/financial/format";
import {
  entryFormSchema,
  type EntryFormInput,
  type EntryFormValues,
} from "@/lib/validation/financial-schema";
import { PAYMENT_METHODS } from "@/types/financial";

interface EntryFormProps {
  defaultValues?: Partial<EntryFormInput>;
  onSubmit: (values: EntryFormValues) => Promise<void> | void;
  submitLabel?: string;
}

export function EntryForm({ defaultValues, onSubmit, submitLabel = "Salvar" }: EntryFormProps) {
  const clientsQuery = useClients({ limit: 100 });
  const projectsQuery = useProjects({ limit: 100 });

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EntryFormInput, unknown, EntryFormValues>({
    resolver: zodResolver(entryFormSchema),
    defaultValues: {
      type: "income",
      description: "",
      ...defaultValues,
    },
  });

  const type = useWatch({ control, name: "type" });
  const categoriesQuery = useCategories({ type, isActive: true });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="type">Tipo</Label>
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">{ENTRY_TYPE_LABELS.income}</SelectItem>
                  <SelectItem value="expense">{ENTRY_TYPE_LABELS.expense}</SelectItem>
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
        <Label htmlFor="description">Descrição</Label>
        <Input id="description" aria-invalid={!!errors.description} {...register("description")} />
        {errors.description ? (
          <p className="text-xs text-destructive">{errors.description.message}</p>
        ) : null}
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
                onValueChange={(value) => {
                  if (value === "none") {
                    field.onChange(undefined);
                    return;
                  }

                  field.onChange(Number(value));

                  // Seção 26: ao selecionar um projeto, pré-seleciona o
                  // cliente correspondente.
                  const project = projectsQuery.data?.data.find((item) => item.id === Number(value));
                  if (project) {
                    setValue("clientId", project.clientId, { shouldValidate: true });
                  }
                }}
                disabled={projectsQuery.isLoading}
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
          <Label htmlFor="clientId">Cliente (opcional)</Label>
          <Controller
            control={control}
            name="clientId"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : "none"}
                onValueChange={(value) => field.onChange(value === "none" ? undefined : Number(value))}
                disabled={clientsQuery.isLoading}
              >
                <SelectTrigger id="clientId" className="w-full">
                  <SelectValue placeholder="Sem cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem cliente</SelectItem>
                  {clientsQuery.data?.data.map((client) => (
                    <SelectItem key={client.id} value={String(client.id)}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="amount">Valor (R$)</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          min="0.01"
          aria-invalid={!!errors.amount}
          {...register("amount")}
        />
        {errors.amount ? <p className="text-xs text-destructive">{errors.amount.message}</p> : null}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="issueDate">Emissão</Label>
          <Input id="issueDate" type="date" aria-invalid={!!errors.issueDate} {...register("issueDate")} />
          {errors.issueDate ? <p className="text-xs text-destructive">{errors.issueDate.message}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dueDate">Vencimento</Label>
          <Input id="dueDate" type="date" aria-invalid={!!errors.dueDate} {...register("dueDate")} />
          {errors.dueDate ? <p className="text-xs text-destructive">{errors.dueDate.message}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="competenceDate">Competência</Label>
          <Input
            id="competenceDate"
            type="date"
            aria-invalid={!!errors.competenceDate}
            {...register("competenceDate")}
          />
          {errors.competenceDate ? (
            <p className="text-xs text-destructive">{errors.competenceDate.message}</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="paymentMethod">Forma de pagamento (opcional)</Label>
          <Controller
            control={control}
            name="paymentMethod"
            render={({ field }) => (
              <Select
                value={field.value ?? "none"}
                onValueChange={(value) => field.onChange(value === "none" ? undefined : value)}
              >
                <SelectTrigger id="paymentMethod" className="w-full">
                  <SelectValue placeholder="Não informado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não informado</SelectItem>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reference">Referência (opcional)</Label>
          <Input id="reference" {...register("reference")} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Observações</Label>
        <Textarea id="notes" rows={3} {...register("notes")} />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
