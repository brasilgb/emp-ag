/**
 * Agentes v1.8 (correio.md secao 2) - representacao deterministica dos
 * fatos relevantes da agencia. Gerado exclusivamente a partir de
 * services/repositories reais dos modulos existentes (crm/projects/
 * financial/support) - nunca SQL dentro do Diretor, nunca inventado pelo
 * LLM (o LLM so pode interpretar sinais ja produzidos, nunca gera um
 * sinal novo por conta propria).
 *
 * `domain` cobre os 4 modulos de negocio (correio.md secao 1) - sinais
 * de Customer Success entram como domain='support' (o proprio correio.md
 * agrupa "Suporte / Customer Success" sob o mesmo titulo na secao 3) -
 * mais 'agents' (saude da propria infraestrutura de agentes: Jobs com
 * falha, circuit breakers abertos, approvals pendentes, incidents - a
 * mesma quinta chave que o exemplo de brief da secao 6 do correio.md
 * mostra ao lado de crm/projects/finance/support).
 */
export type SignalDomain = 'crm' | 'projects' | 'finance' | 'support' | 'agents';
export type SignalSeverity = 'info' | 'attention' | 'warning' | 'critical';

export interface OperationalSignal {
  /** Estavel e reproduzivel: `${type}:${entityId}` - nunca persistido, sempre recalculado a partir dos dados reais no momento da consulta. */
  id: string;
  type: string;
  domain: SignalDomain;
  severity: SignalSeverity;
  title: string;
  description: string;
  entityType?: string;
  entityId?: number;
  detectedAt: Date;
  metadata: Record<string, unknown>;
}
