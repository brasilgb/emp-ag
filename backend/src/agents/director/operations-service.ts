import { collectOperationalSignals, type SignalSourceError } from './operational-signals.js';
import type { OperationalSignal, SignalDomain } from './types.js';

type Collectors = Parameters<typeof collectOperationalSignals>[1];

const SEVERITY_ORDER: Record<OperationalSignal['severity'], number> = {
  critical: 0,
  warning: 1,
  attention: 2,
  info: 3,
};

const DOMAINS: SignalDomain[] = ['crm', 'projects', 'finance', 'support', 'agents'];

export interface DailyOperationsBrief {
  generatedAt: string;
  status: 'ok' | 'partial';
  errors: SignalSourceError[];
  summary: { critical: number; warning: number; attention: number; info: number };
  domains: Record<SignalDomain, OperationalSignal[]>;
}

function sortBySeverity(signals: OperationalSignal[]): OperationalSignal[] {
  return [...signals].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return b.detectedAt.getTime() - a.detectedAt.getTime();
  });
}

/**
 * Agentes v1.8 (correio.md secoes 5/6) — Director Operations Service:
 * coleta, classifica por dominio, ordena por prioridade e monta o
 * briefing estruturado. Nunca executa acoes (correio.md secao 5: "nao
 * permitir que esse service execute acoes diretamente") — so leitura e
 * agregacao.
 *
 * `status: 'partial'` (nunca omitido silenciosamente) quando qualquer
 * fonte falhou — a estrutura e sempre a fonte oficial, nunca so texto
 * (correio.md secao 6).
 */
export async function getDailyOperationsBrief(now: Date = new Date(), collectors?: Collectors): Promise<DailyOperationsBrief> {
  const { signals, errors } = await collectOperationalSignals(now, collectors);
  const sorted = sortBySeverity(signals);

  const domains = Object.fromEntries(
    DOMAINS.map((domain) => [domain, sorted.filter((signal) => signal.domain === domain)]),
  ) as Record<SignalDomain, OperationalSignal[]>;

  const summary = {
    critical: sorted.filter((s) => s.severity === 'critical').length,
    warning: sorted.filter((s) => s.severity === 'warning').length,
    attention: sorted.filter((s) => s.severity === 'attention').length,
    info: sorted.filter((s) => s.severity === 'info').length,
  };

  return {
    generatedAt: now.toISOString(),
    status: errors.length > 0 ? 'partial' : 'ok',
    errors,
    summary,
    domains,
  };
}

export async function listOperationalSignals(now: Date = new Date()): Promise<{ signals: OperationalSignal[]; errors: SignalSourceError[] }> {
  const { signals, errors } = await collectOperationalSignals(now);
  return { signals: sortBySeverity(signals), errors };
}

export async function getOperationalSignalById(id: string, now: Date = new Date()): Promise<OperationalSignal | null> {
  const { signals } = await collectOperationalSignals(now);
  return signals.find((signal) => signal.id === id) ?? null;
}
