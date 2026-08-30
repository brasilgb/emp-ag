"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type CategoryInput,
  createCategory,
  listCategories,
  updateCategory,
} from "@/services/financial";
import type { FinancialCategoryType } from "@/types/financial";

export function useCategories(
  params: { search?: string; type?: FinancialCategoryType; isActive?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.financial.categories(params),
    queryFn: () => listCategories(params),
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CategoryInput) => createCategory(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial", "categories"] });
    },
  });
}

export function useUpdateCategory(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<CategoryInput>) => updateCategory(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial", "categories"] });
    },
  });
}
