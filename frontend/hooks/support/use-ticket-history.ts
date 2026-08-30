"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getTicketHistory } from "@/services/support";

export function useTicketHistory(ticketId: number, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.support.history(ticketId, params),
    queryFn: () => getTicketHistory(ticketId, params),
    enabled: Number.isFinite(ticketId),
  });
}
