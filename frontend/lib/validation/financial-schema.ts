import { z } from "zod";

import { PAYMENT_METHODS } from "@/types/financial";

// Validação client-side "de conveniência" (feedback imediato no formulário).
// O backend nunca confia apenas nela — valida tudo de novo antes de tocar o
// banco (ver backend/src/schemas/financial.ts).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

const positiveAmount = z.coerce
  .number({ error: "Valor inválido." })
  .positive("Valor deve ser maior que zero.");

export const entryFormSchema = z.object({
  type: z.enum(["income", "expense"]),
  categoryId: z.coerce.number().int().positive("Selecione uma categoria."),
  clientId: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  projectId: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  description: z.string().trim().min(1, "Descrição é obrigatória.").max(255),
  amount: positiveAmount,
  issueDate: z.string().min(1, "Data de emissão é obrigatória."),
  dueDate: z.string().min(1, "Data de vencimento é obrigatória."),
  competenceDate: z.string().min(1, "Data de competência é obrigatória."),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  reference: optionalText(120),
  notes: optionalText(5000),
});

export type EntryFormValues = z.output<typeof entryFormSchema>;
export type EntryFormInput = z.input<typeof entryFormSchema>;

export const paymentFormSchema = z.object({
  amount: positiveAmount,
  paidAt: z.string().min(1, "Data do pagamento é obrigatória."),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  reference: optionalText(120),
  notes: optionalText(5000),
});

export type PaymentFormValues = z.output<typeof paymentFormSchema>;
export type PaymentFormInput = z.input<typeof paymentFormSchema>;

export const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Slug é obrigatório.")
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Use apenas letras minúsculas, números e "_".'),
  type: z.enum(["income", "expense", "both"]),
});

export type CategoryFormValues = z.output<typeof categoryFormSchema>;
export type CategoryFormInput = z.input<typeof categoryFormSchema>;
