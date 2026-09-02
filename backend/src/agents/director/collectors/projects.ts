import {
  getBlockedTasks,
  getOverdueProjects,
  getOverdueTasks,
  getTasksDueSoon,
  getUnassignedTasks,
} from '../../../routes/projects/projects.js';

import { DIRECTOR_THRESHOLDS } from '../thresholds.js';
import type { OperationalSignal } from '../types.js';

/**
 * Agentes v1.8 (correio.md secao 3, Projetos/Tarefas) — 5 sinais, todos
 * a partir de repositorios ja existentes (3 reaproveitados sem mudanca:
 * getOverdueTasks/getOverdueProjects/getBlockedTasks; 2 novos, mesmo
 * padrao: getTasksDueSoon/getUnassignedTasks, adicionados em
 * routes/projects/projects.ts).
 *
 * Sinal avaliado e NAO implementado: "projeto sem atividade recente" —
 * projects nao tem campo de ultima-atividade (so updated_at, que muda em
 * qualquer edicao administrativa, nao so progresso real); derivar de
 * task_history exigiria uma agregacao nova por projeto sem repositorio
 * existente equivalente — fora do escopo desta versao (correio.md secao
 * 3: "nao inventar dados").
 */
export async function collectProjectsSignals(now: Date): Promise<OperationalSignal[]> {
  const [overdueTasks, dueSoonTasks, blockedTasks, unassignedTasks, overdueProjects] = await Promise.all([
    getOverdueTasks(),
    getTasksDueSoon(now, DIRECTOR_THRESHOLDS.taskDueSoonDays),
    getBlockedTasks(),
    getUnassignedTasks(),
    getOverdueProjects(),
  ]);

  const signals: OperationalSignal[] = [];

  for (const task of overdueTasks) {
    signals.push({
      id: `projects.task_overdue:${task.id}`,
      type: 'projects.task_overdue',
      domain: 'projects',
      severity: 'warning',
      title: `Tarefa atrasada: ${task.title}`,
      description: `"${task.title}" (projeto "${task.projectName}") venceu em ${task.dueDate} e continua ${task.status}.`,
      entityType: 'task',
      entityId: task.id,
      detectedAt: now,
      metadata: { projectId: task.projectId, dueDate: task.dueDate, assigneeName: task.assigneeName },
    });
  }

  for (const task of dueSoonTasks) {
    signals.push({
      id: `projects.task_due_soon:${task.id}`,
      type: 'projects.task_due_soon',
      domain: 'projects',
      severity: 'attention',
      title: `Tarefa próxima do vencimento: ${task.title}`,
      description: `"${task.title}" (projeto "${task.projectName}") vence em ${task.dueDate}.`,
      entityType: 'task',
      entityId: task.id,
      detectedAt: now,
      metadata: { projectId: task.projectId, dueDate: task.dueDate, assigneeName: task.assigneeName },
    });
  }

  for (const task of blockedTasks) {
    signals.push({
      id: `projects.task_blocked:${task.id}`,
      type: 'projects.task_blocked',
      domain: 'projects',
      severity: 'warning',
      title: `Tarefa bloqueada: ${task.title}`,
      description: `"${task.title}" (projeto "${task.projectName}") está bloqueada.`,
      entityType: 'task',
      entityId: task.id,
      detectedAt: now,
      metadata: { projectId: task.projectId, assigneeName: task.assigneeName },
    });
  }

  for (const task of unassignedTasks) {
    signals.push({
      id: `projects.task_unassigned:${task.id}`,
      type: 'projects.task_unassigned',
      domain: 'projects',
      severity: 'attention',
      title: `Tarefa sem responsável: ${task.title}`,
      description: `"${task.title}" (projeto "${task.projectName}") não tem responsável definido.`,
      entityType: 'task',
      entityId: task.id,
      detectedAt: now,
      metadata: { projectId: task.projectId, status: task.status },
    });
  }

  for (const project of overdueProjects) {
    signals.push({
      id: `projects.project_overdue:${project.id}`,
      type: 'projects.project_overdue',
      domain: 'projects',
      severity: 'warning',
      title: `Projeto atrasado: ${project.name}`,
      description: `"${project.name}" (cliente "${project.clientName}") venceu em ${project.dueDate} e continua ${project.status}.`,
      entityType: 'project',
      entityId: project.id,
      detectedAt: now,
      metadata: { clientId: project.clientId, dueDate: project.dueDate, ownerName: project.ownerName },
    });
  }

  return signals;
}
