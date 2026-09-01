"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type CreateEventRuleInput,
  type ListEventRulesParams,
  type UpdateEventRuleInput,
  createEventRule,
  deleteEventRule,
  getEventRule,
  listEventRules,
  updateEventRule,
} from "@/services/agents";

// Agentes v1.4 — Event Engine & Autonomous Operations (correio.md).
export function useEventRules(params: ListEventRulesParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.eventRules(params),
    queryFn: () => listEventRules(params),
    placeholderData: keepPreviousData,
  });
}

export function useEventRule(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.eventRule(id ?? 0),
    queryFn: () => getEventRule(id as number),
    enabled: id !== null,
  });
}

function useInvalidateEventRules() {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: ["agents", "event-rules"] });
}

export function useCreateEventRule() {
  const invalidate = useInvalidateEventRules();

  return useMutation({
    mutationFn: (input: CreateEventRuleInput) => createEventRule(input),
    onSuccess: invalidate,
  });
}

export function useUpdateEventRule() {
  const invalidate = useInvalidateEventRules();

  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateEventRuleInput }) => updateEventRule(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteEventRule() {
  const invalidate = useInvalidateEventRules();

  return useMutation({
    mutationFn: (id: number) => deleteEventRule(id),
    onSuccess: invalidate,
  });
}
