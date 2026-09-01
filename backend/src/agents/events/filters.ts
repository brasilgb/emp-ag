import { z } from 'zod';

import { getEventDefinition } from './catalog.js';
import type { FilterFieldType } from './catalog.js';

/**
 * Agentes v1.4 (correio.md seções 6/21) — linguagem pequena e fechada de
 * filtros para Event Rules. Nunca `eval`, nunca JS dinâmico, nunca SQL,
 * nunca regex arbitrária, nunca decidido por LLM — só um mapa
 * campo→operador→valor avaliado por comparação direta em memória.
 */

export const FILTER_OPERATORS = ['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'exists'] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

const scalarValue = z.union([z.string(), z.number(), z.boolean()]);

const operatorConditionSchema = z
  .object({
    eq: scalarValue.optional(),
    neq: scalarValue.optional(),
    in: z.array(scalarValue).min(1).optional(),
    not_in: z.array(scalarValue).min(1).optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    exists: z.boolean().optional(),
  })
  .strict()
  .refine((condition) => Object.keys(condition).length === 1, {
    message: 'Cada campo de filtro deve ter exatamente um operador.',
  });

// Shape genérico (sem checar campos permitidos) — usado pelo schema Zod de
// criação/edição de Event Rule. A checagem de "campo existe e é
// filterable para este event_type" é feita à parte por
// validateFiltersAgainstEventType, porque depende do event_type escolhido
// (não dá para expressar isso estaticamente no Zod da rule).
export const filtersSchema = z.record(z.string(), operatorConditionSchema);
export type EventFilters = z.infer<typeof filtersSchema>;

export interface FilterValidationError {
  field: string;
  message: string;
}

/**
 * Valida que cada campo do filtro está na lista `filterableFields` do
 * catálogo para este event_type, e que o tipo do valor bate com o tipo
 * declarado do campo (correio.md seção 6: "avaliação somente sobre campos
 * permitidos do payload"). Chamada na criação/edição de Event Rule —
 * nunca no processor (que já recebe filtros de uma rule já validada).
 */
export function validateFiltersAgainstEventType(eventType: string, filters: EventFilters): FilterValidationError[] {
  const definition = getEventDefinition(eventType);

  if (!definition) {
    return [{ field: '(event_type)', message: `Tipo de evento desconhecido: "${eventType}".` }];
  }

  const errors: FilterValidationError[] = [];

  for (const [field, condition] of Object.entries(filters)) {
    const fieldType = definition.filterableFields[field];

    if (!fieldType) {
      errors.push({ field, message: `Campo "${field}" não é filtrável para o evento "${eventType}".` });
      continue;
    }

    // Defesa em profundidade: em tese `condition` sempre tem exatamente
    // uma chave (o Zod de filtersSchema já garante isso — seção 6), mas
    // um objeto de condição vazio/malformado nunca deve derrubar a
    // validação com uma exceção — trata como erro de validação normal.
    const [operator, value] = (Object.entries(condition)[0] ?? []) as [FilterOperator | undefined, unknown];

    if (!operator) {
      errors.push({ field, message: `Condição de filtro inválida para o campo "${field}".` });
      continue;
    }

    errors.push(...validateOperatorValueType(field, operator, value, fieldType));
  }

  return errors;
}

function validateOperatorValueType(
  field: string,
  operator: FilterOperator,
  value: unknown,
  fieldType: FilterFieldType,
): FilterValidationError[] {
  if (operator === 'exists') {
    return [];
  }

  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    return fieldType === 'number'
      ? []
      : [{ field, message: `Operador "${operator}" só é permitido em campos numéricos ("${field}" é ${fieldType}).` }];
  }

  const values = operator === 'in' || operator === 'not_in' ? (value as unknown[]) : [value];
  const mismatched = values.filter((entry) => typeof entry !== fieldType);

  if (mismatched.length > 0) {
    return [{ field, message: `Valor incompatível com o tipo de "${field}" (esperado ${fieldType}).` }];
  }

  return [];
}

/**
 * Avaliação pura, determinística: só lê campos presentes no payload já
 * validado pelo Zod do catálogo. Tipo incompatível ou operador não
 * aplicável nunca lança — retorna `false` (a rule simplesmente não casa),
 * mesmo racional de "falha segura" já usado no restante do módulo de
 * agentes.
 */
export function evaluateFilters(filters: EventFilters, payload: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filters)) {
    const [operator, expected] = (Object.entries(condition)[0] ?? []) as [FilterOperator | undefined, unknown];
    const actual = payload[field];

    if (!operator || !evaluateOperator(operator, actual, expected)) {
      return false;
    }
  }

  return true;
}

function evaluateOperator(operator: FilterOperator, actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case 'exists':
      return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null;
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual as never);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual as never);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return evaluateComparison(operator, actual, expected);
    default:
      return false;
  }
}

function evaluateComparison(operator: 'gt' | 'gte' | 'lt' | 'lte', actual: unknown, expected: unknown): boolean {
  if (typeof actual !== 'number' || typeof expected !== 'number') {
    return false;
  }

  switch (operator) {
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
  }
}
