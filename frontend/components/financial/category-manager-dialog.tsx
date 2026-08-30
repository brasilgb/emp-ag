"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useCategories, useCreateCategory } from "@/hooks/financial/use-categories";
import { CATEGORY_TYPE_LABELS } from "@/lib/financial/format";
import {
  categoryFormSchema,
  type CategoryFormInput,
  type CategoryFormValues,
} from "@/lib/validation/financial-schema";
import { toErrorMessage } from "@/services/http";

function CategoryForm({ onSubmit }: { onSubmit: (values: CategoryFormValues) => Promise<void> }) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormInput, unknown, CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: "", slug: "", type: "expense" },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">Nome</Label>
        <Input id="name" aria-invalid={!!errors.name} {...register("name")} />
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <Input id="slug" placeholder="ex.: consultoria_extra" aria-invalid={!!errors.slug} {...register("slug")} />
        {errors.slug ? <p className="text-xs text-destructive">{errors.slug.message}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="type">Tipo</Label>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">{CATEGORY_TYPE_LABELS.income}</SelectItem>
                <SelectItem value="expense">{CATEGORY_TYPE_LABELS.expense}</SelectItem>
                <SelectItem value="both">{CATEGORY_TYPE_LABELS.both}</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Criar categoria"}
      </Button>
    </form>
  );
}

export function CategoryManagerDialog() {
  const [open, setOpen] = useState(false);
  const categoriesQuery = useCategories();
  const createCategory = useCreateCategory();

  async function handleCreate(values: CategoryFormValues) {
    try {
      await createCategory.mutateAsync(values);
      toast.success("Categoria criada com sucesso.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar categoria."));
    }
  }

  return (
    <PermissionGate permission="financial.categories.manage">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline">Categorias</Button>} />
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Categorias financeiras</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {categoriesQuery.isLoading ? (
              <LoadingState label="Carregando categorias..." />
            ) : categoriesQuery.isError ? (
              <ErrorState onRetry={() => categoriesQuery.refetch()} />
            ) : !categoriesQuery.data || categoriesQuery.data.data.length === 0 ? (
              <EmptyState title="Nenhuma categoria cadastrada" description="Crie a primeira categoria abaixo." />
            ) : (
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {categoriesQuery.data.data.map((category) => (
                  <li
                    key={category.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{category.name}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary" className="border-transparent">
                        {CATEGORY_TYPE_LABELS[category.type]}
                      </Badge>
                      {category.isSystem ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Sistema
                        </Badge>
                      ) : null}
                      {!category.isActive ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Inativa
                        </Badge>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t pt-4">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-medium">
                <Plus className="size-4" /> Nova categoria
              </p>
              <CategoryForm onSubmit={handleCreate} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PermissionGate>
  );
}
