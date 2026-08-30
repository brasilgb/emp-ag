"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import {
  CHURN_RISK_LABELS,
  CS_ACCOUNT_STATUS_LABELS,
  ONBOARDING_STATUS_LABELS,
} from "@/lib/customer-success/format";
import {
  accountFormSchema,
  type AccountFormInput,
  type AccountFormValues,
} from "@/lib/validation/customer-success-schema";
import { CHURN_RISKS, CS_ACCOUNT_STATUSES, ONBOARDING_STATUSES } from "@/types/customer-success";

interface AccountFormProps {
  defaultValues?: Partial<AccountFormInput>;
  onSubmit: (values: AccountFormValues) => Promise<void> | void;
}

export function AccountForm({ defaultValues, onSubmit }: AccountFormProps) {
  const usersQuery = useUsersDirectory();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AccountFormInput, unknown, AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      status: "onboarding",
      healthScore: 50,
      onboardingStatus: "not_started",
      churnRisk: "low",
      ...defaultValues,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
                  {CS_ACCOUNT_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CS_ACCOUNT_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
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
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="healthScore">Health score (0-100)</Label>
          <Input
            id="healthScore"
            type="number"
            min="0"
            max="100"
            aria-invalid={!!errors.healthScore}
            {...register("healthScore")}
          />
          {errors.healthScore ? (
            <p className="text-xs text-destructive">{errors.healthScore.message}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="satisfactionScore">Satisfação (1-5, opcional)</Label>
          <Input
            id="satisfactionScore"
            type="number"
            min="1"
            max="5"
            aria-invalid={!!errors.satisfactionScore}
            {...register("satisfactionScore")}
          />
          {errors.satisfactionScore ? (
            <p className="text-xs text-destructive">{errors.satisfactionScore.message}</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="onboardingStatus">Onboarding</Label>
          <Controller
            control={control}
            name="onboardingStatus"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="onboardingStatus" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ONBOARDING_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ONBOARDING_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="churnRisk">Risco de churn</Label>
          <Controller
            control={control}
            name="churnRisk"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="churnRisk" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHURN_RISKS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CHURN_RISK_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nextContactAt">Próximo contato</Label>
        <Input id="nextContactAt" type="date" {...register("nextContactAt")} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notas</Label>
        <Textarea id="notes" rows={3} {...register("notes")} />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Salvar alterações"}
      </Button>
    </form>
  );
}
