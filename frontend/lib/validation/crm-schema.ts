import { z } from "zod";

import { CRM_ACTIVITY_TYPES, LEAD_SOURCES } from "@/types/crm";

// Validação client-side "de conveniência" (feedback imediato no formulário).
// O backend nunca confia apenas nela — valida tudo de novo antes de tocar o
// banco (ver backend/src/schemas/crm.ts).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

const optionalEmail = z
  .union([z.email("E-mail inválido."), z.literal("")])
  .optional()
  .transform((value) => (value ? value : undefined));

export const clientFormSchema = z.object({
  type: z.enum(["person", "company"]),
  name: z.string().trim().min(1, "Nome é obrigatório.").max(200),
  legalName: optionalText(200),
  document: optionalText(32),
  email: optionalEmail,
  phone: optionalText(32),
  website: optionalText(255),
  status: z.enum(["active", "inactive"]),
  notes: optionalText(5000),
});

// Duas variantes por esquema: a de entrada (o que os campos do formulário
// de fato produzem, com opcionais) e a de saída (depois das transformações
// do Zod). O useForm usa a de entrada; o callback de onSubmit recebe a de
// saída — ver o terceiro genérico de useForm em cada *-form.tsx.
export type ClientFormValues = z.output<typeof clientFormSchema>;
export type ClientFormInput = z.input<typeof clientFormSchema>;

export const contactFormSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(200),
  email: optionalEmail,
  phone: optionalText(32),
  position: optionalText(120),
  isPrimary: z.boolean(),
  notes: optionalText(5000),
});

export type ContactFormValues = z.output<typeof contactFormSchema>;
export type ContactFormInput = z.input<typeof contactFormSchema>;

export const leadFormSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(200),
  companyName: optionalText(200),
  email: optionalEmail,
  phone: optionalText(32),
  source: z.enum(LEAD_SOURCES),
  estimatedValue: z
    .union([z.literal(""), z.coerce.number().min(0, "Valor deve ser positivo.")])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  probability: z.coerce
    .number()
    .int("Deve ser um número inteiro.")
    .min(0, "Entre 0 e 100.")
    .max(100, "Entre 0 e 100."),
  nextActionAt: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || !Number.isNaN(Date.parse(value)), {
      error: "Data inválida.",
    }),
  nextActionDescription: optionalText(255),
  notes: optionalText(5000),
});

export type LeadFormValues = z.output<typeof leadFormSchema>;
export type LeadFormInput = z.input<typeof leadFormSchema>;

export const activityFormSchema = z.object({
  type: z.enum(CRM_ACTIVITY_TYPES),
  title: z.string().trim().min(1, "Título é obrigatório.").max(200),
  description: optionalText(5000),
});

export type ActivityFormValues = z.output<typeof activityFormSchema>;
export type ActivityFormInput = z.input<typeof activityFormSchema>;
