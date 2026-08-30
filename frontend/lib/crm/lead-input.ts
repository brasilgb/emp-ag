import type { LeadFormValues } from "@/lib/validation/crm-schema";
import type { LeadInput } from "@/services/leads";

/** Converte os valores do formulário (strings de <input>) para o payload
 * aceito pela API — principalmente nextActionAt, que vem de um
 * datetime-local sem timezone e precisa virar um ISO 8601 com offset. */
export function toLeadInput(values: LeadFormValues): LeadInput {
  return {
    name: values.name,
    companyName: values.companyName,
    email: values.email,
    phone: values.phone,
    source: values.source,
    estimatedValue: values.estimatedValue,
    probability: values.probability,
    nextActionAt: values.nextActionAt ? new Date(values.nextActionAt).toISOString() : undefined,
    nextActionDescription: values.nextActionDescription,
    notes: values.notes,
  };
}
