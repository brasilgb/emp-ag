"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type ListTicketsParams,
  type TicketInput,
  type TicketUpdateInput,
  createTicket,
  getTicket,
  listTickets,
  updateTicket,
} from "@/services/support";

export function useTickets(params: ListTicketsParams = {}) {
  return useQuery({
    queryKey: queryKeys.support.tickets(params),
    queryFn: () => listTickets(params),
    placeholderData: keepPreviousData,
  });
}

export function useTicket(id: number) {
  return useQuery({
    queryKey: queryKeys.support.ticket(id),
    queryFn: () => getTicket(id),
    enabled: Number.isFinite(id),
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TicketInput) => createTicket(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.support.stats });
    },
  });
}

export function useUpdateTicket(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TicketUpdateInput) => updateTicket(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.support.stats });
    },
  });
}
