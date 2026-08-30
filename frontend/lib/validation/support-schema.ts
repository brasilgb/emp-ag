import { z } from "zod";

import { PRIORITIES, SOURCES } from "@/types/support";

// Validação client-side "de conveniência" (feedback imediato no formulário).
// O backend nunca confia apenas nela — valida tudo de novo antes de tocar o
// banco (ver backend/src/schemas/support.ts).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const ticketFormSchema = z.object({
  clientId: z.coerce.number().int().positive("Selecione um cliente."),
  projectId: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  categoryId: z.coerce.number().int().positive("Selecione uma categoria."),
  title: z.string().trim().min(1, "Título é obrigatório.").max(255),
  description: optionalText(10000),
  priority: z.enum(PRIORITIES).optional(),
  source: z.enum(SOURCES),
});

export type TicketFormValues = z.output<typeof ticketFormSchema>;
export type TicketFormInput = z.input<typeof ticketFormSchema>;

export const messageFormSchema = z.object({
  content: z.string().trim().min(1, "Conteúdo é obrigatório.").max(10000),
  isInternal: z.boolean(),
});

export type MessageFormValues = z.output<typeof messageFormSchema>;
export type MessageFormInput = z.input<typeof messageFormSchema>;

export const resolveFormSchema = z.object({
  resolution: z.string().trim().min(1, "Descreva a resolução.").max(10000),
});

export type ResolveFormValues = z.output<typeof resolveFormSchema>;
export type ResolveFormInput = z.input<typeof resolveFormSchema>;

export const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Slug é obrigatório.")
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Use apenas letras minúsculas, números e "_".'),
  description: optionalText(2000),
  defaultPriority: z.enum(PRIORITIES),
});

export type CategoryFormValues = z.output<typeof categoryFormSchema>;
export type CategoryFormInput = z.input<typeof categoryFormSchema>;
