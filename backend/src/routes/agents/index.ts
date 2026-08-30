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
}
