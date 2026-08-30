"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useCreateTaskComment, useTaskComments } from "@/hooks/projects/use-task-comments";
import { formatDateTime } from "@/lib/projects/format";
import {
  commentFormSchema,
  type CommentFormInput,
  type CommentFormValues,
} from "@/lib/validation/projects-schema";
import { toErrorMessage } from "@/services/http";

export function TaskCommentsSection({ projectId, taskId }: { projectId: number; taskId: number }) {
  const commentsQuery = useTaskComments(projectId, taskId);
  const createComment = useCreateTaskComment(projectId, taskId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CommentFormInput, unknown, CommentFormValues>({
    resolver: zodResolver(commentFormSchema),
    defaultValues: { content: "" },
  });

  async function submit(values: CommentFormValues) {
    try {
      await createComment.mutateAsync(values.content);
      reset({ content: "" });
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao registrar comentário."));
    }
  }

  return (
    <div className="space-y-4">
      <PermissionGate permission="tasks.comment">
        <form onSubmit={handleSubmit(submit)} className="space-y-2 rounded-lg border p-3">
          <Textarea rows={2} placeholder="Escreva um comentário..." {...register("content")} />
          {errors.content ? <p className="text-xs text-destructive">{errors.content.message}</p> : null}
          <Button type="submit" size="sm" disabled={createComment.isPending}>
            {createComment.isPending ? "Enviando..." : "Comentar"}
          </Button>
        </form>
      </PermissionGate>

      {commentsQuery.isLoading ? (
        <LoadingState label="Carregando comentários..." />
      ) : commentsQuery.isError ? (
        <ErrorState onRetry={() => commentsQuery.refetch()} />
      ) : !commentsQuery.data || commentsQuery.data.data.length === 0 ? (
        <EmptyState title="Nenhum comentário ainda" description="Seja o primeiro a comentar nesta tarefa." />
      ) : (
        <ul className="space-y-3">
          {commentsQuery.data.data.map((comment) => (
            <li key={comment.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{comment.authorName ?? "Usuário removido"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(comment.createdAt)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{comment.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
