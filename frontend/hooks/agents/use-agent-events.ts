"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { type ListEventsParams, getEvent, getEventCatalog, listEvents, retryEvent } from "@/services/agents";

// Agentes v1.4 — Event Engine & Autonomous Operations (correio.md).
export function useAgentEvents(params: ListEventsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.events(params),
    queryFn: () => listEvents(params),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });
}

export function useAgentEvent(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.event(id ?? 0),
    queryFn: () => getEvent(id as number),
    enabled: id !== null,
  });
}

export function useEventCatalog() {
  return useQuery({
    queryKey: queryKeys.agents.eventCatalog,
    queryFn: () => getEventCatalog(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRetryEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => retryEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "events"] });
    },
  });
}
