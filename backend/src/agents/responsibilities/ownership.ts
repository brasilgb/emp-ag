import { and, asc, eq, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentResponsibilities } from '../../db/schema/index.js';

import type { ResponsibilityRow } from './service.js';
import type { ResponsibilityType } from './types.js';

/**
 * Agentes v2.6 (correio.md seção 7) — "Nunca usar LLM para decidir quem
 * é responsável." Determinístico, só dados persistidos: `enabled=true`
 * (seção 29: "não deve receber novas escalations automáticas" quando
 * desabilitada — por isso NUNCA aparece aqui) + `domain` exato,
 * ordenado por prioridade (critical primeiro).
 */
export async function resolveOperationalResponsibility(params: { domain: string; responsibilityType?: ResponsibilityType }): Promise<ResponsibilityRow[]> {
  const conditions = [eq(agentResponsibilities.domain, params.domain), eq(agentResponsibilities.enabled, true)];
  if (params.responsibilityType) conditions.push(eq(agentResponsibilities.responsibilityType, params.responsibilityType));

  const rows = await db
    .select()
    .from(agentResponsibilities)
    .where(and(...conditions))
    .orderBy(
      sql`case ${agentResponsibilities.priority} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`,
      asc(agentResponsibilities.createdAt),
    );

  return rows;
}

/** Atalho para o caso comum de "só o dono de maior prioridade" — usado pela integração com o Operational Supervisor. */
export async function resolvePrimaryResponsibility(params: { domain: string; responsibilityType?: ResponsibilityType }): Promise<ResponsibilityRow | null> {
  const rows = await resolveOperationalResponsibility(params);
  return rows[0] ?? null;
}
