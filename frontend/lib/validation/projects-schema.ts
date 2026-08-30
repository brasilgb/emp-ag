import { z } from "zod";

import {
  EXECUTION_TYPES,
  MILESTONE_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  TASK_STATUSES,
} from "@/types/projects";

// Validação client-side "de conveniência" (feedback imediato no formulário).
// O backend nunca confia apenas nela — valida tudo de novo antes de tocar o
// banco (ver backend/src/schemas/projects.ts).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

const optionalDate = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((value) => (value ? value : undefined));

const optionalId = z
  .union([z.literal(""), z.coerce.number().int().positive()])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value));

const optionalHours = z
  .union([z.literal(""), z.coerce.number().min(0, "Deve ser positivo.")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value));

export const projectFormSchema = z.object({
  clientId: z.coerce.number().int().positive("Cliente é obrigatório."),
  name: z.string().trim().min(1, "Nome é obrigatório.").max(200),
  description: optionalText(5000),
  status: z.enum(PROJECT_STATUSES),
  priority: z.enum(PRIORITIES),
  ownerUserId: optionalId,
  startDate: optionalDate,
  dueDate: optionalDate,
  estimatedValue: z
    .union([z.literal(""), z.coerce.number().min(0, "Valor deve ser positivo.")])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  estimatedHours: optionalHours,
  notes: optionalText(5000),
});

export type ProjectFormValues = z.output<typeof projectFormSchema>;
export type ProjectFormInput = z.input<typeof projectFormSchema>;

export const milestoneFormSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(200),
  description: optionalText(5000),
  status: z.enum(MILESTONE_STATUSES),
  position: z.coerce.number().int().min(0).optional(),
  dueDate: optionalDate,
});

export type MilestoneFormValues = z.output<typeof milestoneFormSchema>;
export type MilestoneFormInput = z.input<typeof milestoneFormSchema>;

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, "Título é obrigatório.").max(200),
  description: optionalText(5000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  assigneeUserId: optionalId,
  milestoneId: optionalId,
  executionType: z.enum(EXECUTION_TYPES),
  dueDate: optionalDate,
  estimatedHours: optionalHours,
});

export type TaskFormValues = z.output<typeof taskFormSchema>;
export type TaskFormInput = z.input<typeof taskFormSchema>;

export const commentFormSchema = z.object({
  content: z.string().trim().min(1, "Comentário não pode ser vazio.").max(5000),
});

export type CommentFormValues = z.output<typeof commentFormSchema>;
export type CommentFormInput = z.input<typeof commentFormSchema>;
