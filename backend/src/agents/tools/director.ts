import { z } from 'zod';

import { getAtRiskAccounts, getDueFollowups } from '../../routes/customer-success/accounts.js';
import { getOpenLeadsCount } from '../../routes/crm/leads.js';
import { getFinancialSummary } from '../../routes/financial/stats.js';
import { getProjectsOverviewCounts } from '../../routes/projects/projects.js';
import { getSupportOverviewCounts } from '../../routes/support/stats.js';
import { getDailyOperationsBrief } from '../director/operations-service.js';
import { syncDirectorDecisionQueue } from '../director/decisions/sync-service.js';
import { reviewDirectorGoals } from '../director/goals/review-service.js';
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

// director.generate_daily_brief (READ) — Agentes v1.8 (correio.md
// seção 11): permite que um Job recorrente ("Gerar briefing operacional
// diário...") produza o briefing determinístico usando a infraestrutura
// já existente de Jobs/Runs, sem criar um segundo mecanismo de execução
// — o LLM só decide chamar esta tool a partir do objetivo do Job; a
// coleta/classificação dos sinais em si é 100% determinística
// (agents/director/operations-service.ts), nunca inventada pelo LLM.
export const directorGenerateDailyBrief: ToolDefinition<Record<string, never>> = {
  handler: 'director.generate_daily_brief',
  requiredPermission: 'agents.read',
  inputSchema: emptyInput,
  async run() {
    const brief = await getDailyOperationsBrief();

    return {
      success: true,
      summary: `Briefing gerado: ${brief.summary.critical} críticos · ${brief.summary.warning} avisos · ${brief.summary.attention} para atenção.`,
      data: brief,
    };
  },
};

// director.sync_decision_queue (WRITE) — Agentes v1.9 (correio.md
// seção 21): decisão arquitetural explícita — sincronizar a Decision
// Queue é uma escrita real (cria/atualiza/resolve linhas em
// agent_director_decisions), então NUNCA reaproveita
// director.generate_daily_brief (READ, v1.8) para isso — transformar
// silenciosamente uma tool READ em mutação foi explicitamente proibido.
// Tool nova, classificada no catálogo (seed.ts) como mutatesData=true,
// risk='low' (bookkeeping interno determinístico, não uma mutação de
// negócio) — passa pelo MESMO Action Policy Evaluator que qualquer
// outra tool mutante, sem tratamento especial: se a política decidir
// que precisa de approval, precisará (não há bypass aqui).
export const directorSyncDecisionQueue: ToolDefinition<Record<string, never>> = {
  handler: 'director.sync_decision_queue',
  requiredPermission: 'agents.director.decisions.manage',
  inputSchema: emptyInput,
  async run() {
    const summary = await syncDirectorDecisionQueue();

    return {
      success: true,
      summary: `Fila de decisões sincronizada: ${summary.created} novos, ${summary.updated} atualizados, ${summary.resolved} resolvidos.`,
      data: summary,
    };
  },
};

// director.review_goals (WRITE) — Agentes v2.0 (correio.md seção 13):
// mesma decisão arquitetural da seção 21/v1.9 — avaliar Goals e gerar
// recomendações de Initiative é uma escrita real (atualiza
// agent_director_goals/agent_director_goal_evaluations, pode inserir
// agent_director_initiatives), então nunca modifica silenciosamente uma
// tool READ existente. Tool nova, mutatesData=true, risk='low' (mesmo
// racional de director.sync_decision_queue — bookkeeping determinístico
// interno do próprio módulo). NÃO sincroniza a Decision Queue aqui —
// isso continua exclusivo de director.sync_decision_queue; o
// collectGoalsSignals (seção 12) lê o health já persistido por esta
// tool na PRÓXIMA sincronização, sem acoplamento direto entre as duas.
export const directorReviewGoals: ToolDefinition<Record<string, never>> = {
  handler: 'director.review_goals',
  requiredPermission: 'agents.director.goals.manage',
  inputSchema: emptyInput,
  async run() {
    const summary = await reviewDirectorGoals();

    return {
      success: true,
      summary: `Goals avaliados: ${summary.evaluated} · ${summary.recommendationsCreated} nova(s) recomendação(ões) de iniciativa.`,
      data: summary,
    };
  },
};

export function registerDirectorTools() {
  registerTool(directorGetBusinessOverview);
  registerTool(directorGenerateDailyBrief);
  registerTool(directorSyncDecisionQueue);
  registerTool(directorReviewGoals);
}
