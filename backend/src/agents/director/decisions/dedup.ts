import type { OperationalSignal } from '../types.js';

/**
 * Agentes v1.9 (correio.md secao 6) - chave determinística estável.
 * Sempre uma string NOT NULL (nunca depende de colunas nullable no
 * banco para unicidade — ver comentário no schema). Sinais sem
 * `entityId` (nenhum dos 13 tipos atuais está nesse caso, mas o
 * correio.md pede robustez para o futuro) caem no fallback do próprio
 * `signal.id` — que já é estável e reproduzível por construção
 * (agents/director/operational-signals.ts), nunca texto gerado por LLM.
 */
export function buildDeduplicationKey(signal: Pick<OperationalSignal, 'type' | 'entityType' | 'entityId' | 'id'>): string {
  const entityPart = signal.entityType ?? 'none';
  const idPart = signal.entityId ?? signal.id;
  return `${signal.type}::${entityPart}::${idPart}`;
}
