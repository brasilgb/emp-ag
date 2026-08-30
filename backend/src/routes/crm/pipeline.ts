import type { FastifyInstance } from 'fastify';
import { asc, desc, eq, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { leads, pipelineStages, users } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';

// Exportada para reuso pela tool sales.get_pipeline_summary
// (backend/src/agents/tools/sales.ts — seção 22). Diferente da rota
// GET /pipeline acima (que agrupa em Node de propósito, para renderizar o
// board completo com todos os leads), aqui a agregação é feita em SQL —
// um resumo por estágio (contagem + soma de valor estimado) não precisa
// carregar cada lead individualmente.
export async function getPipelineSummary() {
  const rows = await db
    .select({
      stageId: pipelineStages.id,
      stageName: pipelineStages.name,
      position: pipelineStages.position,
      isWon: pipelineStages.isWon,
      isLost: pipelineStages.isLost,
      leadCount: sql<number>`count(${leads.id})`,
      totalEstimatedValue: sql<string>`coalesce(sum(${leads.estimatedValue}), 0)`,
    })
    .from(pipelineStages)
    .leftJoin(leads, eq(leads.pipelineStageId, pipelineStages.id))
    .where(eq(pipelineStages.isActive, true))
    .groupBy(pipelineStages.id)
    .orderBy(asc(pipelineStages.position));

  return rows.map((row) => ({
    stageId: row.stageId,
    stageName: row.stageName,
    isWon: row.isWon,
    isLost: row.isLost,
    leadCount: Number(row.leadCount),
    totalEstimatedValue: Number(row.totalEstimatedValue).toFixed(2),
  }));
}

export async function pipelineRoutes(app: FastifyInstance) {
  app.get(
    '/pipeline',
    {
      preHandler: [authenticate, requirePermission('leads.read')],
    },
    async () => {
      // Duas consultas no total (estágios + leads), sem N+1: os leads são
      // agrupados em memória por estágio.
      const stages = await db
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.isActive, true))
        .orderBy(asc(pipelineStages.position));

      const leadRows = await db
        .select({
          id: leads.id,
          name: leads.name,
          companyName: leads.companyName,
          source: leads.source,
          status: leads.status,
          pipelineStageId: leads.pipelineStageId,
          estimatedValue: leads.estimatedValue,
          probability: leads.probability,
          nextActionAt: leads.nextActionAt,
          nextActionDescription: leads.nextActionDescription,
          ownerUserId: leads.ownerUserId,
          ownerName: users.name,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .leftJoin(users, eq(leads.ownerUserId, users.id))
        .orderBy(desc(leads.createdAt));

      const leadsByStage = new Map<number, typeof leadRows>();

      for (const lead of leadRows) {
        const bucket = leadsByStage.get(lead.pipelineStageId);

        if (bucket) {
          bucket.push(lead);
        } else {
          leadsByStage.set(lead.pipelineStageId, [lead]);
        }
      }

      return {
        stages: stages.map((stage) => ({
          ...stage,
          leads: leadsByStage.get(stage.id) ?? [],
        })),
      };
    },
  );
}
