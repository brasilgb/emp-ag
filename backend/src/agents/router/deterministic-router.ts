import { matchesKeyword, normalizeText } from '../keyword-match.js';
import type { AgentRouter, Department, RouteResult } from './types.js';

// Tabela de palavras-chave por departamento (seção 19), domain-level
// apenas — não escolhe uma tool específica, só o departamento/agente. A
// ordem da tabela é a ordem de prioridade em caso de mensagem ambígua
// (primeiro match vence).
const KEYWORDS: Array<{ department: Department; keywords: string[] }> = [
  {
    department: 'finance',
    // 'devendo'/'inadimplente'/'vencido'/'vencida' entram aqui (e não em
    // 'projects', que já usa 'atraso'/'atrasado'/'atrasada') para que
    // frases como "recebimentos em atraso" ou "clientes devendo" cheguem
    // ao agente financeiro — sem 'recebimento'/'devendo' na lista, essas
    // mensagens nem batiam aqui antes de decidir a tool (2º nível).
    keywords: [
      'financeiro',
      'caixa',
      'receber',
      'recebimento',
      'pagar',
      'pagamento',
      'cobranca',
      'fatura',
      'devendo',
      'inadimplente',
      'vencido',
      'vencida',
    ],
  },
  {
    department: 'sales',
    keywords: ['lead', 'cliente potencial', 'venda', 'pipeline', 'funil', 'comercial'],
  },
  {
    department: 'projects',
    keywords: ['projeto', 'tarefa', 'atraso', 'atrasado', 'atrasada', 'bloqueada', 'bloqueado'],
  },
  {
    department: 'support',
    keywords: ['ticket', 'chamado', 'suporte', 'sla', 'critico', 'critica'],
  },
  {
    department: 'customer_success',
    keywords: ['health score', 'churn', 'onboarding', 'customer success', 'risco', 'follow-up', 'followup'],
  },
];

// Agente e departamento têm o mesmo slug para os 6 agentes v1 (seção 4/36).
export class DeterministicRouter implements AgentRouter {
  route(message: string): RouteResult | null {
    const normalized = normalizeText(message);

    for (const entry of KEYWORDS) {
      if (entry.keywords.some((keyword) => matchesKeyword(normalized, keyword))) {
        return { department: entry.department, agentSlug: entry.department };
      }
    }

    return null;
  }
}
