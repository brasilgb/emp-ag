"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MILESTONE_STATUS_LABELS } from "@/lib/projects/format";
import {
  milestoneFormSchema,
  type MilestoneFormInput,
  type MilestoneFormValues,
} from "@/lib/validation/projects-schema";
import { MILESTONE_STATUSES } from "@/types/projects";

interface MilestoneFormProps {
  defaultValues?: Partial<MilestoneFormInput>;
  onSubmit: (values: MilestoneFormValues) => Promise<void> | void;
  submitLabel?: string;
}

export function MilestoneForm({ defaultValues, onSubmit, submitLabel = "Salvar" }: MilestoneFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<MilestoneFormInput, unknown, MilestoneFormValues>({
    resolver: zodResolver(milestoneFormSchema),
    defaultValues: {
      status: "pending",
      name: "",
      ...defaultValues,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="milestone-name">Nome</Label>
        <Input id="milestone-name" aria-invalid={!!errors.name} {...register("name")} />
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="milestone-status">Status</Label>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="milestone-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MILESTONE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {MILESTONE_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="milestone-dueDate">Prazo</Label>
          <Input id="milestone-dueDate" type="date" {...register("dueDate")} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="milestone-description">Descrição</Label>
        <Textarea id="milestone-description" rows={3} {...register("description")} />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
