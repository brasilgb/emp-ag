"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { type CategoryInput, createCategory, listCategories } from "@/services/support";

export function useSupportCategories(params: { search?: string; isActive?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.support.categories(params),
    queryFn: () => listCategories(params),
  });
}

export function useCreateSupportCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CategoryInput) => createCategory(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "categories"] });
    },
  });
}
