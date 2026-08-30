"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_SOURCE_LABELS } from "@/lib/crm/format";
import {
  leadFormSchema,
  type LeadFormInput,
  type LeadFormValues,
} from "@/lib/validation/crm-schema";
import { LEAD_SOURCES } from "@/types/crm";

interface LeadFormProps {
  defaultValues?: Partial<LeadFormInput>;
  onSubmit: (values: LeadFormValues) => Promise<void> | void;
  submitLabel?: string;
}

export function LeadForm({ defaultValues, onSubmit, submitLabel = "Salvar" }: LeadFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormInput, unknown, LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: {
      name: "",
      source: "other",
      probability: 0,
      ...defaultValues,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="lead-name">Nome</Label>
        <Input id="lead-name" aria-invalid={!!errors.name} {...register("name")} />
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="lead-company">Empresa</Label>
          <Input id="lead-company" {...register("companyName")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-source">Origem</Label>
          <Controller
            control={control}
            name="source"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="lead-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((source) => (
                    <SelectItem key={source} value={source}>
                      {LEAD_SOURCE_LABELS[source]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="lead-email">E-mail</Label>
          <Input id="lead-email" type="email" aria-invalid={!!errors.email} {...register("email")} />
          {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-phone">Telefone</Label>
          <Input id="lead-phone" {...register("phone")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="lead-value">Valor estimado (R$)</Label>
          <Input
            id="lead-value"
            type="number"
            min={0}
            step="0.01"
            aria-invalid={!!errors.estimatedValue}
            {...register("estimatedValue")}
          />
          {errors.estimatedValue ? (
            <p className="text-xs text-destructive">{errors.estimatedValue.message}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-probability">Probabilidade (%)</Label>
          <Input
            id="lead-probability"
            type="number"
            min={0}
            max={100}
            step={1}
            aria-invalid={!!errors.probability}
            {...register("probability")}
          />
          {errors.probability ? (
            <p className="text-xs text-destructive">{errors.probability.message}</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="lead-next-action-at">Próxima ação — data</Label>
          <Input id="lead-next-action-at" type="datetime-local" {...register("nextActionAt")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-next-action-description">Próxima ação — descrição</Label>
          <Input id="lead-next-action-description" placeholder="Ex.: Ligar novamente" {...register("nextActionDescription")} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="lead-notes">Observações</Label>
        <Textarea id="lead-notes" rows={3} {...register("notes")} />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
