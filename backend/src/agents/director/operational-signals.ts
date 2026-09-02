import { collectAgentsSignals } from './collectors/agents.js';
import { collectCrmSignals } from './collectors/crm.js';
import { collectFinanceSignals } from './collectors/finance.js';
import { collectGoalsSignals } from './collectors/goals.js';
import { collectProjectsSignals } from './collectors/projects.js';
import { collectSupportSignals } from './collectors/support.js';
import type { OperationalSignal, SignalDomain } from './types.js';

export interface SignalSourceError {
  domain: SignalDomain;
  code: 'SOURCE_UNAVAILABLE';
  message: string;
}

export interface CollectSignalsResult {
  signals: OperationalSignal[];
  errors: SignalSourceError[];
}

/**
 * Agentes v2.0 (correio.md seção 12) — sinais de saúde de Goals somam-se
 * aos sinais de infraestrutura de agentes sob o MESMO domínio `agents`
 * (uma única entrada em COLLECTORS, não duas): assim, qualquer falha na
 * consulta de Goals ou de incidentes/jobs marca o domínio inteiro como
 * "falhou nesta coleta" e preserva TODOS os itens `agents` existentes na
 * fila (correio.md v1.9 seção 7), em vez de dois erros redundantes.
 */
async function collectAgentsDomainSignals(now: Date): Promise<OperationalSignal[]> {
  const [agentsSignals, goalsSignals] = await Promise.all([collectAgentsSignals(now), collectGoalsSignals(now)]);
  return [...agentsSignals, ...goalsSignals];
}

const COLLECTORS: { domain: SignalDomain; collect: (now: Date) => Promise<OperationalSignal[]> }[] = [
  { domain: 'crm', collect: collectCrmSignals },
  { domain: 'projects', collect: collectProjectsSignals },
  { domain: 'finance', collect: collectFinanceSignals },
  { domain: 'support', collect: collectSupportSignals },
  { domain: 'agents', collect: collectAgentsDomainSignals },
];

/**
 * Agentes v1.8 (correio.md secao 2/20) — ponto unico de coleta. Cada
 * dominio roda isolado (Promise.allSettled, nunca Promise.all): a falha
 * de uma fonte nunca corrompe silenciosamente as demais nem derruba o
 * briefing inteiro — vira um erro explicito em `errors`, nunca um `[]`
 * mascarando um problema real (correio.md secao 20: "nunca fingir que []
 * significa sem problema quando na verdade houve erro na consulta").
 *
 * `now` sempre controlavel pelo chamador (correio.md secao 17).
 */
export async function collectOperationalSignals(
  now: Date = new Date(),
  // Injeção de dependência só para teste (correio.md seção 20: "falha
  // isolada de uma fonte sem corromper silenciosamente dados") — nunca
  // usado em produção, onde o default (COLLECTORS reais) sempre se
  // aplica.
  collectors: { domain: SignalDomain; collect: (now: Date) => Promise<OperationalSignal[]> }[] = COLLECTORS,
): Promise<CollectSignalsResult> {
  const results = await Promise.allSettled(collectors.map((entry) => entry.collect(now)));

  const signals: OperationalSignal[] = [];
  const errors: SignalSourceError[] = [];

  results.forEach((result, index) => {
    const { domain } = collectors[index];

    if (result.status === 'fulfilled') {
      signals.push(...result.value);
      return;
    }

    errors.push({
      domain,
      code: 'SOURCE_UNAVAILABLE',
      message: result.reason instanceof Error ? result.reason.message : 'Falha desconhecida ao coletar sinais.',
    });
  });

  return { signals, errors };
}
