import { z } from 'zod';

import { getAtRiskAccounts, getDueFollowups } from '../../routes/customer-success/accounts.js';
import { getOpenLeadsCount } from '../../routes/crm/leads.js';
import { getFinancialSummary } from '../../routes/financial/stats.js';
import { getProjectsOverviewCounts } from '../../routes/projects/projects.js';
import { getSupportOverviewCounts } from '../../routes/support/stats.js';
import { registerTool } from '../tool-registry.js';
import type { ToolDefinition } from '../types.js';

const emptyInput = z.object({}).strict();

// director.get_business_overview (READ) — seção 23. Agrega os
// indicadores principais dos módulos existentes chamando diretamente as
// funções já usadas pelas outras tools READ (seção 22: nunca reimplementa
// SQL, nunca faz chamadas HTTP internas).
export const directorGetBusinessOverview: ToolDefinition<Record<string, never>> = {
  handler: 'director.get_business_overview',
  // Sem uma permission de domínio única que cubra um resumo
  // cross-departamento — exige agents.read (quem pode ver agentes e suas
  // saídas pode ver o overview do Diretor).
  requiredPermission: 'agents.read',
  inputSchema: emptyInput,
  async run() {
    const [openLeads, projectCounts, financial, supportCounts, atRisk, followUpsDue] =
      await Promise.all([
        getOpenLeadsCount(),
        getProjectsOverviewCounts(),
        getFinancialSummary(),
        getSupportOverviewCounts(),
        getAtRiskAccounts(),
        getDueFollowups(),
      ]);

    const data = {
      crm: {
        openLeads,
      },
      projects: {
        active: projectCounts.active,
        overdue: projectCounts.overdue,
      },
      financial: {
        receivablePending: financial.receivablePending,
        payablePending: financial.payablePending,
        resultThisMonth: financial.resultThisMonth,
      },
      support: {
        open: supportCounts.open,
        critical: supportCounts.critical,
        overdue: supportCounts.overdue,
      },
      customerSuccess: {
        atRisk: atRisk.length,
        followUpsDue: followUpsDue.length,
      },
    };

    return {
      success: true,
      summary: `Visão geral: ${data.crm.openLeads} leads abertos · ${data.projects.overdue} projetos atrasados · ${data.support.critical} chamados críticos.`,
      data,
    };
  },
};

export function registerDirectorTools() {
  registerTool(directorGetBusinessOverview);
}
