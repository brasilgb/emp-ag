import { z } from "zod";

import { ACTIVITY_TYPES, CHURN_RISKS, CS_ACCOUNT_STATUSES, ONBOARDING_STATUSES, OPPORTUNITY_TYPES } from "@/types/customer-success";

// Validação client-side "de conveniência". O backend nunca confia apenas
// nela — ver backend/src/schemas/customer-success.ts.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const accountFormSchema = z.object({
  ownerUserId: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  status: z.enum(CS_ACCOUNT_STATUSES),
  healthScore: z.coerce.number().int().min(0, "Entre 0 e 100.").max(100, "Entre 0 e 100."),
  onboardingStatus: z.enum(ONBOARDING_STATUSES),
  nextContactAt: optionalText(32),
  satisfactionScore: z
    .union([z.literal(""), z.coerce.number().int().min(1, "Entre 1 e 5.").max(5, "Entre 1 e 5.")])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  churnRisk: z.enum(CHURN_RISKS),
  notes: optionalText(10000),
});

export type AccountFormValues = z.output<typeof accountFormSchema>;
export type AccountFormInput = z.input<typeof accountFormSchema>;

export const activityFormSchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  title: z.string().trim().min(1, "Título é obrigatório.").max(200),
  description: optionalText(10000),
});

export type ActivityFormValues = z.output<typeof activityFormSchema>;
export type ActivityFormInput = z.input<typeof activityFormSchema>;

export const opportunityFormSchema = z.object({
  clientId: z.coerce.number().int().positive("Selecione um cliente."),
  type: z.enum(OPPORTUNITY_TYPES),
  title: z.string().trim().min(1, "Título é obrigatório.").max(200),
  description: optionalText(10000),
  estimatedValue: z
    .union([z.literal(""), z.coerce.number().min(0.01, "Valor deve ser maior que zero.")])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
});

export type OpportunityFormValues = z.output<typeof opportunityFormSchema>;
export type OpportunityFormInput = z.input<typeof opportunityFormSchema>;
