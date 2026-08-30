"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, PAYMENT_METHOD_LABELS } from "@/lib/financial/format";
import { paymentFormSchema, type PaymentFormInput, type PaymentFormValues } from "@/lib/validation/financial-schema";
import { PAYMENT_METHODS } from "@/types/financial";

interface PaymentFormProps {
  amount: string;
  paidAmount: string;
  remainingAmount: string;
  onSubmit: (values: PaymentFormValues) => Promise<void> | void;
}

export function PaymentForm({ amount, paidAmount, remainingAmount, onSubmit }: PaymentFormProps) {
  // Nunca permite registrar acima do saldo — mesma regra do backend (seção
  // 7), aplicada aqui só como feedback imediato; a validação real continua
  // no backend.
  const schema = useMemo(
    () =>
      paymentFormSchema.refine((data) => data.amount <= Number(remainingAmount), {
        error: `Valor não pode ser maior que o saldo restante (${formatCurrency(remainingAmount)}).`,
        path: ["amount"],
      }),
    [remainingAmount],
  );

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PaymentFormInput, unknown, PaymentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: remainingAmount,
      paidAt: new Date().toISOString().slice(0, 10),
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
        <div>
          <p className="text-muted-foreground">Valor original</p>
          <p className="font-medium">{formatCurrency(amount)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Já pago</p>
          <p className="font-medium">{formatCurrency(paidAmount)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Saldo restante</p>
          <p className="font-medium">{formatCurrency(remainingAmount)}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="amount">Valor do pagamento (R$)</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          min="0.01"
          max={remainingAmount}
          aria-invalid={!!errors.amount}
          {...register("amount")}
        />
        {errors.amount ? <p className="text-xs text-destructive">{errors.amount.message}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="paidAt">Data do pagamento</Label>
        <Input id="paidAt" type="date" aria-invalid={!!errors.paidAt} {...register("paidAt")} />
        {errors.paidAt ? <p className="text-xs text-destructive">{errors.paidAt.message}</p> : null}
      </div>

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

      <div className="space-y-1.5">
        <Label htmlFor="notes">Observações</Label>
        <Textarea id="notes" rows={2} {...register("notes")} />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Registrando..." : "Registrar pagamento"}
      </Button>
    </form>
  );
}
