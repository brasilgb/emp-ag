import bcrypt from 'bcryptjs';

import {
  and,
  eq,
} from 'drizzle-orm';

import { db } from './index.js';

import {
  agentToolPermissions,
  agentTools,
  agents,
  financialCategories,
  permissions,
  pipelineStages,
  rolePermissions,
  roles,
  supportCategories,
  supportSlaPolicies,
  users,
} from './schema/index.js';

import { database } from '../services/database.js';


function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variável obrigatória ausente: ${name}`);
  }

  return value;
}


const defaultPermissions = [
  {
    name: 'Visualizar clientes',
    slug: 'clients.read',
    description: 'Permite visualizar clientes.',
  },
  {
    name: 'Criar clientes',
    slug: 'clients.create',
    description: 'Permite cadastrar novos clientes.',
  },
  {
    name: 'Editar clientes',
    slug: 'clients.update',
    description: 'Permite alterar dados de clientes.',
  },

  {
    name: 'Visualizar contatos',
    slug: 'contacts.read',
    description: 'Permite visualizar contatos de clientes.',
  },
  {
    name: 'Criar contatos',
    slug: 'contacts.create',
    description: 'Permite cadastrar novos contatos.',
  },
  {
    name: 'Editar contatos',
    slug: 'contacts.update',
    description: 'Permite alterar dados de contatos.',
  },

  {
    name: 'Visualizar leads',
    slug: 'leads.read',
    description: 'Permite visualizar leads.',
  },
  {
    name: 'Criar leads',
    slug: 'leads.create',
    description: 'Permite cadastrar novos leads.',
  },
  {
    name: 'Editar leads',
    slug: 'leads.update',
    description: 'Permite alterar leads e seu estágio.',
  },
  {
    name: 'Converter leads',
    slug: 'leads.convert',
    description: 'Permite converter um lead em cliente.',
  },

  {
    name: 'Visualizar atividades do CRM',
    slug: 'crm.activities.read',
    description: 'Permite visualizar o histórico de atividades do CRM.',
  },
  {
    name: 'Criar atividades do CRM',
    slug: 'crm.activities.create',
    description: 'Permite registrar atividades no histórico do CRM.',
  },

  {
    name: 'Visualizar projetos',
    slug: 'projects.read',
    description: 'Permite consultar projetos.',
  },
  {
    name: 'Criar projetos',
    slug: 'projects.create',
    description: 'Permite cadastrar novos projetos.',
  },
  {
    name: 'Editar projetos',
    slug: 'projects.update',
    description: 'Permite alterar dados e status de projetos.',
  },
  {
    name: 'Gerenciar projetos',
    slug: 'projects.manage',
    description:
      'Permissão ampla de gestão de projetos, reservada para ações futuras (arquivar, excluir, reatribuir responsável).',
  },

  {
    name: 'Visualizar milestones',
    slug: 'milestones.read',
    description: 'Permite consultar milestones de projetos.',
  },
  {
    name: 'Criar milestones',
    slug: 'milestones.create',
    description: 'Permite cadastrar milestones em projetos.',
  },
  {
    name: 'Editar milestones',
    slug: 'milestones.update',
    description: 'Permite alterar milestones de projetos.',
  },

  {
    name: 'Visualizar tarefas',
    slug: 'tasks.read',
    description: 'Permite consultar tarefas de projetos.',
  },
  {
    name: 'Criar tarefas',
    slug: 'tasks.create',
    description: 'Permite cadastrar novas tarefas.',
  },
  {
    name: 'Editar tarefas',
    slug: 'tasks.update',
    description: 'Permite alterar qualquer campo de uma tarefa.',
  },
  {
    name: 'Atribuir tarefas',
    slug: 'tasks.assign',
    description: 'Permite alterar apenas o responsável (assignee) de uma tarefa.',
  },
  {
    name: 'Comentar em tarefas',
    slug: 'tasks.comment',
    description: 'Permite criar comentários em tarefas.',
  },
  {
    name: 'Concluir tarefas',
    slug: 'tasks.complete',
    description: 'Permite alterar apenas o status de uma tarefa (ex.: concluir).',
  },

  {
    name: 'Consultar diretório de usuários',
    slug: 'users.directory.read',
    description:
      'Permite listar usuários ativos (id, nome, email, role) para popular seletores de responsável/atribuído. Não é gestão de usuários.',
  },

  {
    name: 'Visualizar financeiro',
    slug: 'financial.read',
    description: 'Permite consultar informações financeiras.',
  },
  {
    name: 'Gerenciar financeiro',
    slug: 'financial.manage',
    description:
      'Permissão ampla de gestão financeira, reservada para ações futuras.',
  },
  {
    name: 'Criar lançamentos financeiros',
    slug: 'financial.create',
    description: 'Permite cadastrar contas a receber e a pagar.',
  },
  {
    name: 'Editar lançamentos financeiros',
    slug: 'financial.update',
    description: 'Permite alterar lançamentos financeiros existentes.',
  },
  {
    name: 'Registrar pagamentos',
    slug: 'financial.pay',
    description: 'Permite registrar pagamentos (totais ou parciais) de um lançamento.',
  },
  {
    name: 'Visualizar categorias financeiras',
    slug: 'financial.categories.read',
    description: 'Permite consultar categorias financeiras.',
  },
  {
    name: 'Gerenciar categorias financeiras',
    slug: 'financial.categories.manage',
    description: 'Permite criar e alterar categorias financeiras.',
  },
  {
    name: 'Visualizar indicadores financeiros',
    slug: 'financial.stats.read',
    description: 'Permite consultar indicadores, fluxo de caixa e previsões financeiras.',
  },

  {
    name: 'Visualizar agentes',
    slug: 'agents.read',
    description: 'Permite consultar agentes de IA cadastrados.',
  },
  {
    name: 'Usar agentes',
    slug: 'agents.use',
    description: 'Permite conversar com agentes de IA (chat e conversas).',
  },
  {
    name: 'Executar agentes',
    slug: 'agents.execute',
    description: 'Permite executar ferramentas de agentes de IA diretamente (POST /agents/execute).',
  },
  {
    name: 'Aprovar ações de agentes',
    slug: 'agents.approve',
    description: 'Permite aprovar ou rejeitar ações sensíveis solicitadas por agentes.',
  },
  {
    name: 'Gerenciar agentes',
    slug: 'agents.manage',
    description: 'Permissão ampla de gestão de agentes, reservada para ações futuras (CRUD de agentes).',
  },
  {
    name: 'Visualizar ferramentas de agentes',
    slug: 'agent.tools.read',
    description: 'Permite consultar o catálogo de ferramentas disponíveis para agentes.',
  },
  {
    name: 'Gerenciar ferramentas de agentes',
    slug: 'agent.tools.manage',
    description: 'Permissão ampla de gestão do catálogo de ferramentas, reservada para ações futuras.',
  },
  {
    name: 'Visualizar execuções de agentes',
    slug: 'agent.executions.read',
    description: 'Permite consultar o histórico de execuções de agentes.',
  },
  {
    name: 'Gerenciar execuções de agentes',
    slug: 'agent.executions.manage',
    description: 'Permissão ampla sobre execuções de agentes, reservada para ações futuras.',
  },
  {
    name: 'Solicitar plano de ações do Diretor Virtual',
    slug: 'agents.plan',
    description: 'Permite pedir ao Diretor Virtual para transformar um objetivo em um Action Plan (POST /agents/action-plans).',
  },
  {
    name: 'Visualizar planos de ações de agentes',
    slug: 'agents.plan.read',
    description: 'Permite consultar Action Plans e seus itens (GET /agents/action-plans).',
  },
  {
    name: 'Criar Jobs de agentes',
    slug: 'agents.jobs.create',
    description: 'Permite criar Jobs (objetivos operacionais recorrentes) para o Diretor Virtual (POST /agents/jobs).',
  },
  {
    name: 'Visualizar Jobs de agentes',
    slug: 'agents.jobs.read',
    description: 'Permite consultar Jobs cadastrados (GET /agents/jobs, GET /agents/jobs/:id).',
  },
  {
    name: 'Editar Jobs de agentes',
    slug: 'agents.jobs.update',
    description: 'Permite editar configuração de um Job (PATCH /agents/jobs/:id) — nunca o status, que só muda via pause/resume/cancel.',
  },
  {
    name: 'Executar Job de agentes manualmente',
    slug: 'agents.jobs.run',
    description: 'Permite disparar manualmente um novo Run de um Job (POST /agents/jobs/:id/run).',
  },
  {
    name: 'Gerenciar Jobs de agentes',
    slug: 'agents.jobs.manage',
    description: 'Permite pausar, retomar e cancelar Jobs (POST /agents/jobs/:id/pause|resume|cancel).',
  },
  {
    name: 'Visualizar Runs de Jobs de agentes',
    slug: 'agents.runs.read',
    description: 'Permite consultar o histórico de Runs de um Job (GET /agents/jobs/:id/runs, GET /agents/job-runs/:id).',
  },
  {
    name: 'Visualizar eventos internos de agentes',
    slug: 'agents.events.read',
    description: 'Permite consultar eventos internos e suas deliveries (GET /agents/events, GET /agents/events/:id).',
  },
  {
    name: 'Gerenciar eventos internos de agentes',
    slug: 'agents.events.manage',
    description: 'Permite reprocessar um evento (POST /agents/events/:id/retry) — nunca contorna policy/approval, só reagenda o processor.',
  },
  {
    name: 'Criar Event Rules de agentes',
    slug: 'agents.event_rules.create',
    description: 'Permite criar regras que associam um tipo de evento a um Job (POST /agents/event-rules).',
  },
  {
    name: 'Visualizar Event Rules de agentes',
    slug: 'agents.event_rules.read',
    description: 'Permite consultar Event Rules cadastradas (GET /agents/event-rules).',
  },
  {
    name: 'Editar Event Rules de agentes',
    slug: 'agents.event_rules.update',
    description: 'Permite editar/ativar/desativar Event Rules (PATCH /agents/event-rules/:id).',
  },
  {
    name: 'Remover Event Rules de agentes',
    slug: 'agents.event_rules.delete',
    description: 'Permite remover Event Rules (DELETE /agents/event-rules/:id).',
  },
  {
    name: 'Visualizar dashboard operacional de agentes',
    slug: 'agents.operations.read',
    description:
      'Permite consultar o dashboard agregado de operações de agentes (GET /agents/operations/summary).',
  },
  {
    name: 'Visualizar incidentes de agentes',
    slug: 'agents.incidents.read',
    description:
      'Permite consultar o Incident Center, derivado de autonomy blocks, deliveries falhas e falhas repetidas de Job (GET /agents/incidents).',
  },
  {
    name: 'Visualizar audit log de agentes',
    slug: 'agents.audit.read',
    description: 'Permite consultar a trilha de auditoria de operações de agentes (GET /agents/audit-logs).',
  },
  {
    name: 'Gerenciar autonomia global de agentes',
    slug: 'agents.autonomy.manage',
    description:
      'Permite consultar e alterar o global autonomy switch (GET/PATCH /agents/autonomy) — kill switch geral de execuções automáticas.',
  },
  {
    name: 'Visualizar configurações operacionais de agentes',
    slug: 'agents.settings.read',
    description:
      'Permite consultar configuração operacional efetiva de agentes (GET /agents/settings, GET /agents/jobs/:id/settings).',
  },
  {
    name: 'Gerenciar configurações operacionais de agentes',
    slug: 'agents.settings.manage',
    description:
      'Permite criar/alterar/remover overrides de configuração operacional (circuit breaker, autonomy depth, chain budget, rate limit) — global ou por Job (PATCH/DELETE /agents/settings/:key e /agents/jobs/:id/settings/:key).',
  },
  {
    name: 'Gerenciar fila de decisões do Diretor',
    slug: 'agents.director.decisions.manage',
    description:
      'Permite reconhecer, atribuir, dispensar e sincronizar itens da Director Decision Queue. Leitura segue em agents.read; propor ação segue em agents.use + agents.plan.',
  },
  {
    name: 'Gerenciar Goals estratégicos do Diretor',
    slug: 'agents.director.goals.manage',
    description:
      'Permite criar/editar Goals, adicionar métricas, ativar/pausar/cancelar e disparar avaliação (Agentes v2.0). Leitura segue em agents.read.',
  },
  {
    name: 'Gerenciar Initiatives do Diretor',
    slug: 'agents.director.initiatives.manage',
    description:
      'Permite criar/editar, aprovar, cancelar, concluir e gerar Executive Review de Initiatives (Agentes v2.0/v2.2). Leitura segue em agents.read; propor Action Plan segue em agents.use + agents.plan.',
  },
  {
    name: 'Gerenciar recovery/reconciliação de workflows de agentes',
    slug: 'agents.recovery.manage',
    description:
      'Permite executar a reconciliação de workflows stale (POST /agents/recovery/run e /agents/recovery/:type/:id — Agentes v2.4). Leitura de status/stale segue em agents.operations.read.',
  },
  {
    name: 'Gerenciar supervisão operacional de agentes',
    slug: 'agents.operations.manage',
    description:
      'Permite executar o Operational Supervisor (POST /agents/operations/supervise — Agentes v2.5): safe recovery, restrição de autonomia de Job, escalação. Leitura segue em agents.operations.read.',
  },
  {
    name: 'Visualizar responsibilities de agentes',
    slug: 'agents.responsibilities.read',
    description: 'Permite consultar Agent Responsibilities — quem é dono de qual domínio (Agentes v2.6).',
  },
  {
    name: 'Gerenciar responsibilities de agentes',
    slug: 'agents.responsibilities.manage',
    description: 'Permite criar/editar/desabilitar/excluir Agent Responsibilities (Agentes v2.6). Leitura segue em agents.responsibilities.read.',
  },
  {
    name: 'Visualizar escalations operacionais',
    slug: 'agents.escalations.read',
    description: 'Permite consultar Operational Escalations geradas pelo Supervisor (Agentes v2.6).',
  },
  {
    name: 'Gerenciar escalations operacionais',
    slug: 'agents.escalations.manage',
    description: 'Permite reconhecer/resolver/descartar Operational Escalations (Agentes v2.6). Leitura segue em agents.escalations.read.',
  },

  {
    name: 'Visualizar usuários',
    slug: 'users.read',
    description: 'Permite consultar usuários.',
  },
  {
    name: 'Gerenciar usuários',
    slug: 'users.manage',
    description: 'Permite criar, editar e administrar usuários.',
  },

  {
    name: 'Visualizar auditoria',
    slug: 'audit.read',
    description: 'Permite consultar os registros de auditoria.',
  },

  {
    name: 'Visualizar chamados',
    slug: 'support.read',
    description: 'Permite consultar chamados de suporte.',
  },
  {
    name: 'Criar chamados',
    slug: 'support.create',
    description: 'Permite abrir novos chamados de suporte.',
  },
  {
    name: 'Editar chamados',
    slug: 'support.update',
    description: 'Permite alterar qualquer campo de um chamado.',
  },
  {
    name: 'Atribuir chamados',
    slug: 'support.assign',
    description: 'Permite alterar apenas o responsável (owner) de um chamado.',
  },
  {
    name: 'Responder chamados',
    slug: 'support.message',
    description: 'Permite enviar mensagens e notas internas em um chamado.',
  },
  {
    name: 'Resolver/fechar/reabrir chamados',
    slug: 'support.resolve',
    description: 'Permite alterar apenas o status (e resolução) de um chamado.',
  },
  {
    name: 'Gerenciar suporte',
    slug: 'support.manage',
    description: 'Permissão ampla de gestão de suporte, reservada para ações futuras.',
  },
  {
    name: 'Visualizar categorias de suporte',
    slug: 'support.categories.read',
    description: 'Permite consultar categorias de suporte.',
  },
  {
    name: 'Gerenciar categorias de suporte',
    slug: 'support.categories.manage',
    description: 'Permite criar e alterar categorias de suporte.',
  },
  {
    name: 'Visualizar indicadores de suporte',
    slug: 'support.stats.read',
    description: 'Permite consultar indicadores de suporte.',
  },

  {
    name: 'Visualizar Customer Success',
    slug: 'cs.read',
    description: 'Permite consultar contas de Customer Success.',
  },
  {
    name: 'Editar Customer Success',
    slug: 'cs.update',
    description: 'Permite alterar/criar contas de Customer Success.',
  },
  {
    name: 'Visualizar atividades de CS',
    slug: 'cs.activities.read',
    description: 'Permite visualizar o histórico de atividades de Customer Success.',
  },
  {
    name: 'Criar atividades de CS',
    slug: 'cs.activities.create',
    description: 'Permite registrar atividades de Customer Success.',
  },
  {
    name: 'Visualizar oportunidades de CS',
    slug: 'cs.opportunities.read',
    description: 'Permite consultar oportunidades de expansão.',
  },
  {
    name: 'Criar oportunidades de CS',
    slug: 'cs.opportunities.create',
    description: 'Permite registrar oportunidades de expansão.',
  },
  {
    name: 'Editar oportunidades de CS',
    slug: 'cs.opportunities.update',
    description: 'Permite alterar oportunidades de expansão.',
  },
  {
    name: 'Visualizar indicadores de CS',
    slug: 'cs.stats.read',
    description: 'Permite consultar indicadores de Customer Success.',
  },
  {
    name: 'Gerenciar Customer Success',
    slug: 'cs.manage',
    description: 'Permissão ampla de gestão de Customer Success, reservada para ações futuras.',
  },
];


const defaultFinancialCategories = [
  { name: 'Projeto', slug: 'project', type: 'income', isSystem: true },
  { name: 'SaaS', slug: 'saas', type: 'income', isSystem: true },
  { name: 'Manutenção', slug: 'maintenance', type: 'income', isSystem: true },
  { name: 'Consultoria', slug: 'consulting', type: 'income', isSystem: true },
  { name: 'Website', slug: 'website', type: 'income', isSystem: true },
  { name: 'Aplicativo', slug: 'app', type: 'income', isSystem: true },
  { name: 'Outras receitas', slug: 'other_income', type: 'income', isSystem: true },

  { name: 'Hospedagem', slug: 'hosting', type: 'expense', isSystem: true },
  { name: 'Software', slug: 'software', type: 'expense', isSystem: true },
  { name: 'Anúncios', slug: 'ads', type: 'expense', isSystem: true },
  { name: 'Impostos', slug: 'taxes', type: 'expense', isSystem: true },
  { name: 'Terceiros', slug: 'contractors', type: 'expense', isSystem: true },
  { name: 'Infraestrutura', slug: 'infrastructure', type: 'expense', isSystem: true },
  { name: 'Taxas bancárias', slug: 'bank_fees', type: 'expense', isSystem: true },
  { name: 'Escritório', slug: 'office', type: 'expense', isSystem: true },
  { name: 'Outras despesas', slug: 'other_expense', type: 'expense', isSystem: true },
];


const defaultSupportCategories = [
  { name: 'Bug', slug: 'bug', defaultPriority: 'high', isSystem: true },
  { name: 'Suporte técnico', slug: 'technical_support', defaultPriority: 'normal', isSystem: true },
  { name: 'Configuração', slug: 'configuration', defaultPriority: 'normal', isSystem: true },
  { name: 'Financeiro/Cobrança', slug: 'billing', defaultPriority: 'high', isSystem: true },
  { name: 'Acesso', slug: 'access', defaultPriority: 'high', isSystem: true },
  { name: 'Integração', slug: 'integration', defaultPriority: 'normal', isSystem: true },
  { name: 'Solicitação de funcionalidade', slug: 'feature_request', defaultPriority: 'low', isSystem: true },
  { name: 'Treinamento', slug: 'training', defaultPriority: 'low', isSystem: true },
  { name: 'Outro', slug: 'other', defaultPriority: 'normal', isSystem: true },
];


// Seção 13: um valor por prioridade nesta v1 — usado tanto para
// firstResponseMinutes quanto resolutionMinutes (spec não distingue os
// dois na tabela de seed sugerida).
const defaultSlaPolicies = [
  { priority: 'low', firstResponseMinutes: 48 * 60, resolutionMinutes: 48 * 60 },
  { priority: 'normal', firstResponseMinutes: 24 * 60, resolutionMinutes: 24 * 60 },
  { priority: 'high', firstResponseMinutes: 8 * 60, resolutionMinutes: 8 * 60 },
  { priority: 'critical', firstResponseMinutes: 2 * 60, resolutionMinutes: 2 * 60 },
];


const defaultPipelineStages = [
  { name: 'Novo Lead', slug: 'new', position: 1, isWon: false, isLost: false },
  { name: 'Contato realizado', slug: 'contacted', position: 2, isWon: false, isLost: false },
  { name: 'Qualificado', slug: 'qualified', position: 3, isWon: false, isLost: false },
  { name: 'Reunião', slug: 'meeting', position: 4, isWon: false, isLost: false },
  { name: 'Proposta', slug: 'proposal', position: 5, isWon: false, isLost: false },
  { name: 'Negociação', slug: 'negotiation', position: 6, isWon: false, isLost: false },
  { name: 'Fechado', slug: 'won', position: 7, isWon: true, isLost: false },
  { name: 'Perdido', slug: 'lost', position: 8, isWon: false, isLost: true },
];


/*
 * AGENTES (Agentes v1 + Diretor Virtual — seções 6/36)
 */
const defaultAgents = [
  {
    name: 'Diretor Virtual',
    slug: 'director',
    department: 'director',
    description: 'Recebe a intenção do usuário, classifica o domínio e decide responder ou delegar a um agente especializado.',
    isSystem: true,
    defaultAutonomyLevel: 'read',
  },
  {
    name: 'Agente Comercial',
    slug: 'sales',
    department: 'sales',
    description: 'Consulta pipeline e leads, e prepara rascunhos de follow-up comercial.',
    isSystem: false,
    defaultAutonomyLevel: 'prepare',
  },
  {
    name: 'Agente de Projetos',
    slug: 'projects',
    department: 'projects',
    description: 'Consulta projetos e tarefas atrasadas/bloqueadas, e cria tarefas internas.',
    isSystem: false,
    defaultAutonomyLevel: 'execute',
  },
  {
    name: 'Agente Financeiro',
    slug: 'finance',
    department: 'finance',
    description: 'Consulta indicadores financeiros e prepara rascunhos de lembrete de cobrança.',
    isSystem: false,
    defaultAutonomyLevel: 'prepare',
  },
  {
    name: 'Agente de Suporte',
    slug: 'support',
    department: 'support',
    description: 'Consulta chamados críticos/atrasados, prepara respostas e registra notas internas.',
    isSystem: false,
    defaultAutonomyLevel: 'execute',
  },
  {
    name: 'Agente Customer Success',
    slug: 'customer_success',
    department: 'customer_success',
    description: 'Consulta contas em risco, follow-ups e oportunidades de expansão, e registra atividades internas.',
    isSystem: false,
    defaultAutonomyLevel: 'execute',
  },
];

/*
 * FERRAMENTAS DE AGENTES (seções 21/24/25) — 14 READ + 4 PREPARE +
 * 3 EXECUTE. `department` aqui é só catálogo/agrupamento (seção 7 do
 * relatório final) — quem efetivamente pode usar cada tool é definido em
 * agent_tool_permissions abaixo.
 */
const defaultAgentTools = [
  {
    name: 'Visão geral do negócio',
    slug: 'director-get-business-overview',
    description: 'Agrega os indicadores principais dos módulos existentes (CRM, projetos, financeiro, suporte, CS).',
    department: 'director',
    autonomyLevel: 'read',
    handler: 'director.get_business_overview',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Briefing operacional diário',
    slug: 'director-generate-daily-brief',
    description:
      'Gera o briefing operacional diário determinístico (Operational Signals de CRM/projetos/financeiro/suporte/agentes) — Agentes v1.8.',
    department: 'director',
    autonomyLevel: 'read',
    handler: 'director.generate_daily_brief',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Sincronizar fila de decisões do Diretor',
    slug: 'director-sync-decision-queue',
    description:
      'Sincroniza Operational Signals com a Director Decision Queue — cria/atualiza/resolve itens de forma determinística (Agentes v1.9).',
    department: 'director',
    autonomyLevel: 'execute',
    handler: 'director.sync_decision_queue',
    risk: 'low',
    mutatesData: true,
    requiresApproval: false,
  },
  {
    name: 'Avaliar Goals estratégicos do Diretor',
    slug: 'director-review-goals',
    description:
      'Avalia Goals ativos (progresso, health) e gera recomendações de Initiative quando aplicável, de forma determinística e deduplicada (Agentes v2.0).',
    department: 'director',
    autonomyLevel: 'execute',
    handler: 'director.review_goals',
    risk: 'low',
    mutatesData: true,
    requiresApproval: false,
  },
  {
    name: 'Resumo do funil de vendas',
    slug: 'sales-get-pipeline-summary',
    description: 'Contagem e valor estimado de leads por estágio do pipeline.',
    department: 'sales',
    autonomyLevel: 'read',
    handler: 'sales.get_pipeline_summary',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Listar leads em aberto',
    slug: 'sales-list-open-leads',
    description: 'Lista leads que ainda não foram ganhos nem perdidos.',
    department: 'sales',
    autonomyLevel: 'read',
    handler: 'sales.list_open_leads',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Projetos atrasados',
    slug: 'projects-get-overdue-projects',
    description: 'Lista projetos com prazo vencido e ainda não concluídos/cancelados.',
    department: 'projects',
    autonomyLevel: 'read',
    handler: 'projects.get_overdue_projects',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Tarefas atrasadas',
    slug: 'projects-get-overdue-tasks',
    description: 'Lista tarefas com prazo vencido e ainda não concluídas/canceladas.',
    department: 'projects',
    autonomyLevel: 'read',
    handler: 'projects.get_overdue_tasks',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Tarefas bloqueadas',
    slug: 'projects-get-blocked-tasks',
    description: 'Lista tarefas com status bloqueada.',
    department: 'projects',
    autonomyLevel: 'read',
    handler: 'projects.get_blocked_tasks',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Resumo financeiro',
    slug: 'finance-get-summary',
    description: 'A receber/a pagar pendente, resultado do mês e valores em atraso.',
    department: 'finance',
    autonomyLevel: 'read',
    handler: 'finance.get_summary',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Recebimentos em atraso',
    slug: 'finance-get-overdue-receivables',
    description: 'Lista lançamentos de receita pendentes com vencimento no passado.',
    department: 'finance',
    autonomyLevel: 'read',
    handler: 'finance.get_overdue_receivables',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Pagamentos em atraso',
    slug: 'finance-get-overdue-payables',
    description: 'Lista lançamentos de despesa pendentes com vencimento no passado.',
    department: 'finance',
    autonomyLevel: 'read',
    handler: 'finance.get_overdue_payables',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Chamados críticos',
    slug: 'support-get-critical-tickets',
    description: 'Lista chamados de prioridade crítica ainda não encerrados.',
    department: 'support',
    autonomyLevel: 'read',
    handler: 'support.get_critical_tickets',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Chamados com SLA estourado',
    slug: 'support-get-overdue-tickets',
    description: 'Lista chamados com SLA vencido e ainda não encerrados.',
    department: 'support',
    autonomyLevel: 'read',
    handler: 'support.get_overdue_tickets',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Contas em risco',
    slug: 'cs-get-at-risk-accounts',
    description: 'Lista contas de Customer Success com status "em risco".',
    department: 'customer_success',
    autonomyLevel: 'read',
    handler: 'cs.get_at_risk_accounts',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Follow-ups pendentes',
    slug: 'cs-get-due-followups',
    description: 'Lista contas com próximo contato agendado já vencido.',
    department: 'customer_success',
    autonomyLevel: 'read',
    handler: 'cs.get_due_followups',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Oportunidades de expansão',
    slug: 'cs-get-expansion-opportunities',
    description: 'Lista oportunidades de expansão/upsell ainda em aberto.',
    department: 'customer_success',
    autonomyLevel: 'read',
    handler: 'cs.get_expansion_opportunities',
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
  },

  {
    name: 'Preparar follow-up de lead',
    slug: 'sales-prepare-lead-followup',
    description: 'Gera um rascunho de mensagem de follow-up para um lead. Não envia.',
    department: 'sales',
    autonomyLevel: 'prepare',
    handler: 'sales.prepare_lead_followup',
    risk: 'low',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Preparar lembrete de pagamento',
    slug: 'finance-prepare-payment-reminder',
    description: 'Gera um rascunho de lembrete de cobrança para um lançamento financeiro. Não envia.',
    department: 'finance',
    autonomyLevel: 'prepare',
    handler: 'finance.prepare_payment_reminder',
    risk: 'low',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Preparar resposta de chamado',
    slug: 'support-prepare-ticket-response',
    description: 'Gera um rascunho de resposta para um chamado de suporte. Não envia.',
    department: 'support',
    autonomyLevel: 'prepare',
    handler: 'support.prepare_ticket_response',
    risk: 'low',
    mutatesData: false,
    requiresApproval: false,
  },
  {
    name: 'Preparar follow-up de cliente',
    slug: 'cs-prepare-customer-followup',
    description: 'Gera um rascunho de mensagem de follow-up para uma conta de Customer Success. Não envia.',
    department: 'customer_success',
    autonomyLevel: 'prepare',
    handler: 'cs.prepare_customer_followup',
    risk: 'low',
    mutatesData: false,
    requiresApproval: false,
  },

  {
    name: 'Criar tarefa interna',
    slug: 'projects-create-internal-task',
    description: 'Cria uma tarefa interna em um projeto existente.',
    department: 'projects',
    autonomyLevel: 'execute',
    handler: 'projects.create_internal_task',
    risk: 'medium',
    mutatesData: true,
    requiresApproval: false,
  },
  {
    name: 'Adicionar nota interna',
    slug: 'support-add-internal-note',
    description: 'Adiciona uma nota interna (não visível ao cliente) em um chamado.',
    department: 'support',
    autonomyLevel: 'execute',
    handler: 'support.add_internal_note',
    risk: 'low',
    mutatesData: true,
    requiresApproval: false,
  },
  {
    name: 'Registrar atividade de follow-up',
    slug: 'cs-create-internal-followup-activity',
    description: 'Registra uma atividade interna de follow-up em uma conta de Customer Success.',
    department: 'customer_success',
    autonomyLevel: 'execute',
    handler: 'cs.create_internal_followup_activity',
    risk: 'low',
    mutatesData: true,
    requiresApproval: false,
  },
];

// agentSlug → handlers das tools que este agente pode usar (seção 37 —
// associar apenas tools apropriadas a cada agente).
const defaultAgentToolPermissions: Record<string, string[]> = {
  director: [
    'director.get_business_overview',
    'director.generate_daily_brief',
    'director.sync_decision_queue',
    'director.review_goals',
  ],
  sales: [
    'sales.get_pipeline_summary',
    'sales.list_open_leads',
    'sales.prepare_lead_followup',
  ],
  projects: [
    'projects.get_overdue_projects',
    'projects.get_overdue_tasks',
    'projects.get_blocked_tasks',
    'projects.create_internal_task',
  ],
  finance: [
    'finance.get_summary',
    'finance.get_overdue_receivables',
    'finance.get_overdue_payables',
    'finance.prepare_payment_reminder',
  ],
  support: [
    'support.get_critical_tickets',
    'support.get_overdue_tickets',
    'support.prepare_ticket_response',
    'support.add_internal_note',
  ],
  customer_success: [
    'cs.get_at_risk_accounts',
    'cs.get_due_followups',
    'cs.get_expansion_opportunities',
    'cs.prepare_customer_followup',
    'cs.create_internal_followup_activity',
  ],
};


async function seed() {
  const name = required('CEO_NAME').trim();
  const email = required('CEO_EMAIL').trim().toLowerCase();
  const password = required('CEO_PASSWORD');

  if (password.length < 12) {
    throw new Error(
      'CEO_PASSWORD deve possuir pelo menos 12 caracteres.',
    );
  }

  if (bcrypt.truncates(password)) {
    throw new Error(
      'CEO_PASSWORD ultrapassa o limite suportado pelo bcrypt.',
    );
  }

  console.log('========================================');
  console.log('Seed inicial da Agência');
  console.log('========================================');

  /*
   * ROLE CEO
   */

  console.log();
  console.log('[1/11] Verificando role CEO...');

  let [ceoRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.slug, 'ceo'))
    .limit(1);

  if (!ceoRole) {
    [ceoRole] = await db
      .insert(roles)
      .values({
        name: 'CEO',
        slug: 'ceo',
        description: 'Administrador principal da agência',
        isSystem: true,
      })
      .returning();

    console.log('Role CEO criada.');
  } else {
    console.log('Role CEO já existe.');
  }


  /*
   * PERMISSIONS
   */

  console.log();
  console.log('[2/11] Verificando permissões...');

  for (const permission of defaultPermissions) {
    const [existingPermission] = await db
      .select()
      .from(permissions)
      .where(
        eq(
          permissions.slug,
          permission.slug,
        ),
      )
      .limit(1);

    if (!existingPermission) {
      await db
        .insert(permissions)
        .values(permission);

      console.log(
        `Permissão criada: ${permission.slug}`,
      );
    }
  }

  console.log('Permissões verificadas.');


  /*
   * CEO RECEBE TODAS AS PERMISSÕES
   */

  console.log();
  console.log(
    '[3/11] Vinculando permissões à role CEO...',
  );

  const allPermissions = await db
    .select()
    .from(permissions);

  for (const permission of allPermissions) {
    const [existingRelation] = await db
      .select()
      .from(rolePermissions)
      .where(
        and(
          eq(
            rolePermissions.roleId,
            ceoRole.id,
          ),
          eq(
            rolePermissions.permissionId,
            permission.id,
          ),
        ),
      )
      .limit(1);

    if (!existingRelation) {
      await db
        .insert(rolePermissions)
        .values({
          roleId: ceoRole.id,
          permissionId: permission.id,
        });

      console.log(
        `CEO recebeu: ${permission.slug}`,
      );
    }
  }

  console.log(
    'Permissões da role CEO verificadas.',
  );


  /*
   * PIPELINE DE VENDAS (CRM)
   */

  console.log();
  console.log('[4/11] Verificando estágios do pipeline...');

  for (const stage of defaultPipelineStages) {
    const [existingStage] = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.slug, stage.slug))
      .limit(1);

    if (!existingStage) {
      await db.insert(pipelineStages).values(stage);

      console.log(`Estágio criado: ${stage.slug}`);
    }
  }

  console.log('Estágios do pipeline verificados.');


  /*
   * CATEGORIAS FINANCEIRAS (Financeiro v1)
   */

  console.log();
  console.log('[5/11] Verificando categorias financeiras...');

  for (const category of defaultFinancialCategories) {
    const [existingCategory] = await db
      .select()
      .from(financialCategories)
      .where(eq(financialCategories.slug, category.slug))
      .limit(1);

    if (!existingCategory) {
      await db.insert(financialCategories).values(category);

      console.log(`Categoria financeira criada: ${category.slug}`);
    }
  }

  console.log('Categorias financeiras verificadas.');


  /*
   * CATEGORIAS DE SUPORTE (Suporte + CS v1)
   */

  console.log();
  console.log('[6/11] Verificando categorias de suporte...');

  for (const category of defaultSupportCategories) {
    const [existingCategory] = await db
      .select()
      .from(supportCategories)
      .where(eq(supportCategories.slug, category.slug))
      .limit(1);

    if (!existingCategory) {
      await db.insert(supportCategories).values(category);

      console.log(`Categoria de suporte criada: ${category.slug}`);
    }
  }

  console.log('Categorias de suporte verificadas.');


  /*
   * POLÍTICAS DE SLA (Suporte + CS v1)
   */

  console.log();
  console.log('[7/11] Verificando políticas de SLA...');

  for (const policy of defaultSlaPolicies) {
    const [existingPolicy] = await db
      .select()
      .from(supportSlaPolicies)
      .where(eq(supportSlaPolicies.priority, policy.priority))
      .limit(1);

    if (!existingPolicy) {
      await db.insert(supportSlaPolicies).values(policy);

      console.log(`Política de SLA criada: ${policy.priority}`);
    }
  }

  console.log('Políticas de SLA verificadas.');


  /*
   * AGENTES (Agentes v1 + Diretor Virtual)
   */

  console.log();
  console.log('[8/11] Verificando agentes...');

  for (const agentData of defaultAgents) {
    const [existingAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.slug, agentData.slug))
      .limit(1);

    if (!existingAgent) {
      await db.insert(agents).values(agentData);

      console.log(`Agente criado: ${agentData.slug}`);
    }
  }

  console.log('Agentes verificados.');


  /*
   * FERRAMENTAS DE AGENTES
   */

  console.log();
  console.log('[9/11] Verificando ferramentas de agentes...');

  for (const toolData of defaultAgentTools) {
    const [existingTool] = await db
      .select()
      .from(agentTools)
      .where(eq(agentTools.handler, toolData.handler))
      .limit(1);

    if (!existingTool) {
      await db.insert(agentTools).values(toolData);

      console.log(`Ferramenta de agente criada: ${toolData.handler}`);
      continue;
    }

    // Agentes v1.2: sincroniza só a classificação de risco (seção 4) em
    // ferramentas já existentes num banco seedado antes desta versão —
    // não reescreve nome/descrição/autonomy_level, que continuam sob
    // gestão manual depois do seed inicial.
    if (
      existingTool.risk !== toolData.risk ||
      existingTool.mutatesData !== toolData.mutatesData ||
      existingTool.requiresApproval !== toolData.requiresApproval
    ) {
      await db
        .update(agentTools)
        .set({
          risk: toolData.risk,
          mutatesData: toolData.mutatesData,
          requiresApproval: toolData.requiresApproval,
        })
        .where(eq(agentTools.id, existingTool.id));

      console.log(`Classificação de risco atualizada: ${toolData.handler}`);
    }
  }

  console.log('Ferramentas de agentes verificadas.');


  /*
   * RELAÇÃO AGENTE ↔ FERRAMENTA
   */

  console.log();
  console.log('[10/11] Vinculando ferramentas aos agentes...');

  const allAgents = await db.select().from(agents);
  const allAgentTools = await db.select().from(agentTools);

  for (const [agentSlug, handlers] of Object.entries(defaultAgentToolPermissions)) {
    const agentRow = allAgents.find((row) => row.slug === agentSlug);

    if (!agentRow) {
      continue;
    }

    for (const handler of handlers) {
      const toolRow = allAgentTools.find((row) => row.handler === handler);

      if (!toolRow) {
        continue;
      }

      const [existingLink] = await db
        .select()
        .from(agentToolPermissions)
        .where(
          and(
            eq(agentToolPermissions.agentId, agentRow.id),
            eq(agentToolPermissions.toolId, toolRow.id),
          ),
        )
        .limit(1);

      if (!existingLink) {
        await db.insert(agentToolPermissions).values({
          agentId: agentRow.id,
          toolId: toolRow.id,
          canUse: true,
        });

        console.log(`Vínculo criado: ${agentSlug} → ${handler}`);
      }
    }
  }

  console.log('Vínculos agente/ferramenta verificados.');


  /*
   * USUÁRIO CEO
   */

  console.log();
  console.log('[11/11] Verificando usuário CEO...');

  const [existingUser] = await db
    .select()
    .from(users)
    .where(
      eq(
        users.email,
        email,
      ),
    )
    .limit(1);

  if (existingUser) {
    console.log(
      'Usuário CEO já existe. Nenhuma alteração realizada.',
    );
  } else {
    const passwordHash = await bcrypt.hash(
      password,
      12,
    );

    await db
      .insert(users)
      .values({
        name,
        email,
        passwordHash,
        roleId: ceoRole.id,
        isActive: true,
      });

    console.log(
      'Usuário CEO criado com sucesso.',
    );
  }

  console.log();
  console.log('========================================');
  console.log('Seed concluído com sucesso.');
  console.log(`Role CEO: ${ceoRole.slug}`);
  console.log(
    `Permissões disponíveis: ${allPermissions.length}`,
  );
  console.log('========================================');
}


try {
  await seed();
} catch (error) {
  console.error();
  console.error(
    'Erro durante execução do seed:',
    error,
  );

  process.exitCode = 1;
} finally {
  await database.end();
}