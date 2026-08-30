import { z } from 'zod';

import {
  getBlockedTasks,
  getOverdueProjects,
  getOverdueTasks,
} from '../../routes/projects/projects.js';
import { createInternalTask } from '../../routes/projects/tasks.js';
import { audit } from '../../services/audit.js';
import { registerTool } from '../tool-registry.js';
import type { ToolDefinition } from '../types.js';
import { AgentError } from '../errors.js';

const emptyInput = z.object({}).strict();

// projects.get_overdue_projects (READ)
export const projectsGetOverdueProjects: ToolDefinition<Record<string, never>> = {
  handler: 'projects.get_overdue_projects',
  requiredPermission: 'projects.read',
  inputSchema: emptyInput,
  async run() {
    const rows = await getOverdueProjects();

    return {
      success: true,
      summary: `${rows.length} projeto(s) atrasado(s).`,
      data: rows,
    };
  },
};

// projects.get_overdue_tasks (READ)
export const projectsGetOverdueTasks: ToolDefinition<Record<string, never>> = {
  handler: 'projects.get_overdue_tasks',
  requiredPermission: 'projects.read',
  inputSchema: emptyInput,
  async run() {
    const rows = await getOverdueTasks();

    return {
      success: true,
      summary: `${rows.length} tarefa(s) atrasada(s).`,
      data: rows,
    };
  },
};

// projects.get_blocked_tasks (READ)
export const projectsGetBlockedTasks: ToolDefinition<Record<string, never>> = {
  handler: 'projects.get_blocked_tasks',
  requiredPermission: 'projects.read',
  inputSchema: emptyInput,
  async run() {
    const rows = await getBlockedTasks();

    return {
      success: true,
      summary: `${rows.length} tarefa(s) bloqueada(s).`,
      data: rows,
    };
  },
};

// projects.create_internal_task (EXECUTE) — ação interna segura (seção
// 25): reusa o mesmo núcleo transacional de POST /projects/:id/tasks.
const createInternalTaskInput = z.object({
  projectId: z.coerce.number().int().positive('projectId inválido.'),
  title: z.string().trim().min(1, 'Título é obrigatório.').max(200),
  description: z.string().trim().max(5000).optional(),
  assigneeUserId: z.coerce.number().int().positive().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueDate: z.iso.date('Data inválida.').optional(),
});

export const projectsCreateInternalTask: ToolDefinition<
  z.infer<typeof createInternalTaskInput>
> = {
  handler: 'projects.create_internal_task',
  requiredPermission: 'tasks.create',
  inputSchema: createInternalTaskInput,
  async run(input, ctx) {
    const result = await createInternalTask(
      {
        title: input.title,
        description: input.description,
        status: 'todo',
        priority: input.priority,
        assigneeUserId: input.assigneeUserId,
        executionType: 'agent',
        executionRef: `agent:${ctx.agentSlug}`,
        dueDate: input.dueDate,
      },
      input.projectId,
      ctx.userId,
    );

    if (!result.ok) {
      throw new AgentError('execution_failed', result.message ?? 'Não foi possível criar a tarefa.');
    }

    // Auditoria adicional de mutação por agente (seção 15) — além do
    // registro genérico de execução feito pelo pipeline.
    await audit({
      userId: ctx.userId,
      actorType: 'agent',
      actorId: ctx.agentSlug,
      action: 'agent.projects.create_internal_task',
      entityType: 'task',
      entityId: String(result.task!.id),
      newData: result.task,
      metadata: { executionId: ctx.executionId },
    });

    return {
      success: true,
      summary: `Tarefa "${result.task!.title}" criada no projeto #${input.projectId}.`,
      data: result.task,
    };
  },
};

export function registerProjectsTools() {
  registerTool(projectsGetOverdueProjects);
  registerTool(projectsGetOverdueTasks);
  registerTool(projectsGetBlockedTasks);
  registerTool(projectsCreateInternalTask);
}
