import { matchesKeyword, normalizeText } from '../keyword-match.js';
import type { AgentInterpreter, InterpretResult } from './types.js';

interface AgentKeywordEntry {
  keywords: string[];
  toolHandler: string;
}

// Tabela de palavras-chave por agente (2º nível, ver types.ts) + um tool
// default por departamento como fallback quando o AgentRouter já
// identificou o departamento mas nenhuma palavra-chave mais específica
// bateu — evita um estado "meio desconhecido" não testável. Nesta v1
// todas as tools mapeadas aqui têm input vazio ({}), então não há
// extração de parâmetros a partir da mensagem.
const AGENT_KEYWORDS: Record<string, AgentKeywordEntry[]> = {
  sales: [
    { keywords: ['pipeline', 'funil'], toolHandler: 'sales.get_pipeline_summary' },
  ],
  projects: [
    { keywords: ['bloqueada', 'bloqueado'], toolHandler: 'projects.get_blocked_tasks' },
    { keywords: ['tarefa'], toolHandler: 'projects.get_overdue_tasks' },
  ],
  // finance não entra aqui — precisa de lógica combinada (atraso E
  // pagar/receber), que a tabela simples de "primeiro keyword que bater
  // vence" não expressa. Ver classifyFinanceIntent() abaixo.
  support: [
    { keywords: ['critico', 'critica'], toolHandler: 'support.get_critical_tickets' },
  ],
  customer_success: [
    { keywords: ['churn', 'risco'], toolHandler: 'cs.get_at_risk_accounts' },
    { keywords: ['follow-up', 'followup', 'onboarding'], toolHandler: 'cs.get_due_followups' },
  ],
};

// Marcadores de atraso (seção 30 do correio financeiro): têm sempre
// precedência sobre o saldo agregado. Cada forma no plural é coberta pelo
// `s?` de matchesKeyword() (atrasado→atrasados, vencida→vencidas etc.),
// então só as formas no singular precisam estar aqui.
const FINANCE_OVERDUE_MARKERS = ['atraso', 'atrasado', 'atrasada', 'vencido', 'vencida', 'devendo', 'inadimplente'];

// Só usado para decidir ENTRE as duas tools de atraso, depois que
// FINANCE_OVERDUE_MARKERS já confirmou que a mensagem é sobre atraso.
const FINANCE_PAYABLE_MARKERS = ['pagar', 'pagamento'];

/**
 * "a receber"/"a pagar" sozinhos são sempre saldo agregado
 * (finance.get_summary, via DEPARTMENT_DEFAULT_TOOL) — só viram
 * get_overdue_payables/get_overdue_receivables quando a mensagem também
 * carrega um marcador de atraso. Bug real corrigido aqui: antes,
 * "quanto temos a receber" batia direto em get_overdue_receivables só por
 * conter a palavra "receber", sem nenhum sinal de atraso.
 *
 * Quando há atraso, "pagar"/"pagamento" decidem por get_overdue_payables;
 * qualquer outro caso (receber/recebimento, ou devendo/inadimplente
 * sozinhos, como em "clientes devendo") é sempre sobre quem deve pra
 * gente → get_overdue_receivables. Não existe um terceiro sentido para
 * atraso financeiro fora de pagar/receber.
 */
function classifyFinanceIntent(normalized: string): string | null {
  const isOverdue = FINANCE_OVERDUE_MARKERS.some((keyword) => matchesKeyword(normalized, keyword));

  if (!isOverdue) {
    return null;
  }

  const isPayable = FINANCE_PAYABLE_MARKERS.some((keyword) => matchesKeyword(normalized, keyword));

  return isPayable ? 'finance.get_overdue_payables' : 'finance.get_overdue_receivables';
}

// Tool chamada quando o departamento foi identificado mas nenhuma
// palavra-chave de 2º nível bateu.
const DEPARTMENT_DEFAULT_TOOL: Record<string, string> = {
  sales: 'sales.list_open_leads',
  projects: 'projects.get_overdue_projects',
  finance: 'finance.get_summary',
  support: 'support.get_overdue_tickets',
  customer_success: 'cs.get_at_risk_accounts',
};

export class DeterministicInterpreter implements AgentInterpreter {
  interpret(message: string, agentSlug: string): InterpretResult | null {
    const normalized = normalizeText(message);

    if (agentSlug === 'finance') {
      const financeTool = classifyFinanceIntent(normalized);

      if (financeTool) {
        return { toolHandler: financeTool, input: {} };
      }
    } else {
      const entries = AGENT_KEYWORDS[agentSlug] ?? [];

      for (const entry of entries) {
        if (entry.keywords.some((keyword) => matchesKeyword(normalized, keyword))) {
          return { toolHandler: entry.toolHandler, input: {} };
        }
      }
    }

    const defaultTool = DEPARTMENT_DEFAULT_TOOL[agentSlug];

    if (!defaultTool) {
      return null;
    }

    return { toolHandler: defaultTool, input: {} };
  }
}
