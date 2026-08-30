import type { BoardColumn, TaskStatus } from "@/types/projects";

/**
 * Move uma tarefa de uma coluna para outra dentro dos dados já em cache do
 * TanStack Query (usado para atualização otimista do board). Retorna um
 * novo array — nunca muta o original. Mesmo molde de
 * lib/crm/pipeline-helpers.ts (moveLeadBetweenStages).
 */
export function moveTaskBetweenColumns(
  columns: BoardColumn[],
  taskId: number,
  targetStatus: TaskStatus,
): BoardColumn[] {
  let movedTask: BoardColumn["tasks"][number] | undefined;

  const withoutTask = columns.map((column) => {
    const remaining = column.tasks.filter((task) => {
      if (task.id === taskId) {
        movedTask = task;
        return false;
      }
      return true;
    });

    return remaining.length === column.tasks.length ? column : { ...column, tasks: remaining };
  });

  if (!movedTask) {
    return columns;
  }

  const taskToInsert = { ...movedTask, status: targetStatus };

  return withoutTask.map((column) => {
    if (column.status !== targetStatus) {
      return column;
    }

    return { ...column, tasks: [taskToInsert, ...column.tasks] };
  });
}
