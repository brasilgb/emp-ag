"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import {
  History,
  Mail,
  MessageCircle,
  Phone,
  StickyNote,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { ACTIVITY_TYPE_LABELS, formatDateTime } from "@/lib/crm/format";
import {
  activityFormSchema,
  type ActivityFormInput,
  type ActivityFormValues,
} from "@/lib/validation/crm-schema";
import type { CrmActivity, CrmActivityType } from "@/types/crm";

// Tipos que o usuário pode registrar manualmente — status_change, conversion
// e system são gerados automaticamente pelo backend.
const SELECTABLE_TYPES: CrmActivityType[] = [
  "note",
  "call",
  "email",
  "meeting",
  "whatsapp",
  "follow_up",
];

const ACTIVITY_ICONS: Record<CrmActivityType, typeof StickyNote> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  meeting: Users,
  whatsapp: MessageCircle,
  follow_up: History,
  status_change: History,
  conversion: Trophy,
  system: UserRound,
};

interface ActivitySectionProps {
  activities: CrmActivity[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onCreate: (values: ActivityFormValues) => Promise<void>;
  isCreating: boolean;
}

export function ActivitySection({
  activities,
  isLoading,
  isError,
  onRetry,
  onCreate,
  isCreating,
}: ActivitySectionProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<ActivityFormInput, unknown, ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: { type: "note", title: "", description: "" },
  });

  async function submit(values: ActivityFormValues) {
    try {
      await onCreate(values);
      reset({ type: "note", title: "", description: "" });
    } catch {
      // Erro já reportado ao usuário por quem chamou onCreate (toast).
      // Mantém os valores preenchidos para o usuário tentar de novo.
    }
  }

  return (
    <div className="space-y-4">
      <PermissionGate permission="crm.activities.create">
        <form onSubmit={handleSubmit(submit)} className="space-y-3 rounded-lg border p-4">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SELECTABLE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {ACTIVITY_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <div>
              <Input placeholder="Título" aria-invalid={!!errors.title} {...register("title")} />
              {errors.title ? <p className="mt-1 text-xs text-destructive">{errors.title.message}</p> : null}
            </div>
          </div>

          <Textarea rows={2} placeholder="Descrição (opcional)" {...register("description")} />

          <Button type="submit" size="sm" disabled={isCreating}>
            {isCreating ? "Registrando..." : "Registrar atividade"}
          </Button>
        </form>
      </PermissionGate>

      {isLoading ? (
        <LoadingState label="Carregando histórico..." />
      ) : isError ? (
        <ErrorState onRetry={onRetry} />
      ) : !activities || activities.length === 0 ? (
        <EmptyState title="Nenhuma atividade registrada" description="O histórico aparece aqui conforme for criado." />
      ) : (
        <ul className="space-y-3">
          {activities.map((activity) => {
            const Icon = ACTIVITY_ICONS[activity.type];

            return (
              <li key={activity.id} className="flex gap-3 rounded-lg border p-3 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{activity.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(activity.occurredAt)}
                    </span>
                  </div>
                  {activity.description ? (
                    <p className="mt-1 text-muted-foreground">{activity.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ACTIVITY_TYPE_LABELS[activity.type]}
                    {activity.userName ? ` · ${activity.userName}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
