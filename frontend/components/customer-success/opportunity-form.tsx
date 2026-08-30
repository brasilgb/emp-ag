"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useClients } from "@/hooks/crm/use-clients";
import { OPPORTUNITY_TYPE_LABELS } from "@/lib/customer-success/format";
import {
  opportunityFormSchema,
  type OpportunityFormInput,
  type OpportunityFormValues,
} from "@/lib/validation/customer-success-schema";
import { OPPORTUNITY_TYPES } from "@/types/customer-success";

interface OpportunityFormProps {
  defaultValues?: Partial<OpportunityFormInput>;
  onSubmit: (values: OpportunityFormValues) => Promise<void> | void;
}

export function OpportunityForm({ defaultValues, onSubmit }: OpportunityFormProps) {
  const clientsQuery = useClients({ limit: 100 });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<OpportunityFormInput, unknown, OpportunityFormValues>({
    resolver: zodResolver(opportunityFormSchema),
    defaultValues: { type: "upsell", title: "", ...defaultValues },
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
                {OPPORTUNITY_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {OPPORTUNITY_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="title">Título</Label>
        <Input id="title" aria-invalid={!!errors.title} {...register("title")} />
        {errors.title ? <p className="text-xs text-destructive">{errors.title.message}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="estimatedValue">Valor estimado (R$, opcional)</Label>
        <Input id="estimatedValue" type="number" step="0.01" min="0" {...register("estimatedValue")} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Descrição</Label>
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Criar oportunidade"}
      </Button>
    </form>
  );
}
