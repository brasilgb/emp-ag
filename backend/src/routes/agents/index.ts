import type { FastifyInstance } from 'fastify';

import { registerAllTools } from '../../agents/tools/index.js';

import { agentsRoutes } from './agents.js';
import { agentToolsRoutes } from './tools.js';
import { executeRoutes } from './execute.js';
import { executionsRoutes } from './executions.js';
import { approvalsRoutes } from './approvals.js';
import { conversationsRoutes } from './conversations.js';
import { chatRoutes } from './chat.js';
import { interpreterRoutes } from './interpreter.js';
import { actionPlansRoutes } from './action-plans.js';
import { jobsRoutes } from './jobs.js';
import { jobRunsRoutes } from './job-runs.js';
import { eventsRoutes } from './events.js';
import { eventRulesRoutes } from './event-rules.js';
import { operationsRoutes } from './operations.js';
import { incidentsRoutes } from './incidents.js';
import { auditRoutes } from './audit.js';
import { autonomyRoutes } from './autonomy.js';
import { agentSettingsRoutes } from './settings.js';
import { directorRoutes } from './director.js';
import { directorDecisionsRoutes } from './director-decisions.js';
import { directorGoalsRoutes } from './director-goals.js';
import { directorInitiativesRoutes } from './director-initiatives.js';
import { directorMemoriesRoutes } from './director-memories.js';
import { recoveryRoutes } from './recovery.js';

export async function agentsModuleRoutes(app: FastifyInstance) {
  registerAllTools();

  await app.register(agentsRoutes);
  await app.register(agentToolsRoutes);
  await app.register(executeRoutes);
  await app.register(executionsRoutes);
  await app.register(approvalsRoutes);
  await app.register(conversationsRoutes);
  await app.register(chatRoutes);
  await app.register(interpreterRoutes);
  await app.register(actionPlansRoutes);
  await app.register(jobsRoutes);
  await app.register(jobRunsRoutes);
  await app.register(eventsRoutes);
  await app.register(eventRulesRoutes);
  await app.register(operationsRoutes);
  await app.register(incidentsRoutes);
  await app.register(auditRoutes);
  await app.register(autonomyRoutes);
  await app.register(agentSettingsRoutes);
  await app.register(directorRoutes);
  await app.register(directorDecisionsRoutes);
  await app.register(directorGoalsRoutes);
  await app.register(directorInitiativesRoutes);
  await app.register(directorMemoriesRoutes);
  await app.register(recoveryRoutes);
}
