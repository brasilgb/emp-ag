import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  clients,
  contacts,
  crmActivities,
  leads,
  pipelineStages,
  users,
} from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  createActivitySchema,
  createLeadSchema,
  leadIdParamSchema,
  listActivitiesQuerySchema,
  listLeadsQuerySchema,
  updateLeadSchema,
} from '../../schemas/crm.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

type PipelineStage = typeof pipelineStages.$inferSelect;

// status do lead é derivado do estágio para o qual ele está apontando —
// nunca deve depender do nome visual do estágio, apenas de isWon/isLost.
function deriveLeadStatus(stage: PipelineStage): 'open' | 'won' | 'lost' {
  if (stage.isWon) return 'won';
  if (stage.isLost) return 'lost';
  return 'open';
}

async function getActiveStageById(id: number) {
  const [stage] = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.id, id), eq(pipelineStages.isActive, true)))
    .limit(1);

  return stage;
}

// Estágio de entrada padrão para leads criados sem pipelineStageId
// explícito: o de menor `position` entre os estágios ativos (normalmente
// "Novo Lead" / slug "new", mas a lógica não depende do nome).
async function getDefaultStage() {
  const [stage] = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.isActive, true))
    .orderBy(asc(pipelineStages.position))
    .limit(1);

  return stage;
}

async function getWonStage() {
  const [stage] = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.isWon, true))
    .limit(1);

  return stage;
}

// Exportada para reuso pela tool sales.list_open_leads
// (backend/src/agents/tools/sales.ts — seção 22). leads.status é
// derivado do estágio (ver deriveLeadStatus) mas mantido em sincronia na
// própria linha, então filtrar por status='open' aqui é seguro e evita
// duplicar o join com pipeline_stages para a lógica de won/lost.
export async function listOpenLeads() {
  return db
    .select({
      id: leads.id,
      name: leads.name,
      companyName: leads.companyName,
      source: leads.source,
      pipelineStageId: leads.pipelineStageId,
      stageName: pipelineStages.name,
      ownerUserId: leads.ownerUserId,
      ownerName: users.name,
      estimatedValue: leads.estimatedValue,
      nextActionAt: leads.nextActionAt,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(pipelineStages, eq(leads.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(leads.ownerUserId, users.id))
    .where(eq(leads.status, 'open'))
    .orderBy(desc(leads.createdAt));
}

// Usada por director.get_business_overview (seção 23, crm.openLeads).
export async function getOpenLeadsCount() {
  const [{ total }] = await db
    .select({ total: count() })
    .from(leads)
    .where(eq(leads.status, 'open'));

  return Number(total);
}

export async function leadRoutes(app: FastifyInstance) {
  app.get(
    '/leads',
    {
      preHandler: [authenticate, requirePermission('leads.read')],
    },
    async (request, reply) => {
      const query = listLeadsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, search, stage, owner, source } = query.data;

      const stageFilter = stage
        ? /^\d+$/.test(stage)
          ? eq(leads.pipelineStageId, Number(stage))
          : eq(pipelineStages.slug, stage)
        : undefined;

      const filters = [
        stageFilter,
        owner ? eq(leads.ownerUserId, owner) : undefined,
        source ? eq(leads.source, source) : undefined,
        search
          ? or(
              ilike(leads.name, `%${search}%`),
              ilike(leads.companyName, `%${search}%`),
              ilike(leads.email, `%${search}%`),
            )
          : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const baseQuery = db
        .select({
          id: leads.id,
          name: leads.name,
          companyName: leads.companyName,
          email: leads.email,
          phone: leads.phone,
          source: leads.source,
          status: leads.status,
          pipelineStageId: leads.pipelineStageId,
          stageName: pipelineStages.name,
          stageSlug: pipelineStages.slug,
          ownerUserId: leads.ownerUserId,
          ownerName: users.name,
          estimatedValue: leads.estimatedValue,
          probability: leads.probability,
          nextActionAt: leads.nextActionAt,
          nextActionDescription: leads.nextActionDescription,
          convertedClientId: leads.convertedClientId,
          createdAt: leads.createdAt,
          updatedAt: leads.updatedAt,
        })
        .from(leads)
        .innerJoin(pipelineStages, eq(leads.pipelineStageId, pipelineStages.id))
        .leftJoin(users, eq(leads.ownerUserId, users.id));

      const [rows, [{ total }]] = await Promise.all([
        baseQuery
          .where(where)
          .orderBy(desc(leads.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(leads)
          .innerJoin(pipelineStages, eq(leads.pipelineStageId, pipelineStages.id))
          .where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/leads',
    {
      preHandler: [authenticate, requirePermission('leads.create')],
    },
    async (request, reply) => {
      const body = createLeadSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const stage = body.data.pipelineStageId
        ? await getActiveStageById(body.data.pipelineStageId)
        : await getDefaultStage();

      if (!stage) {
        return reply.code(422).send({
          error: 'invalid_pipeline_stage',
          message: 'Estágio do pipeline inválido ou inexistente.',
        });
      }

      const userId = currentUserId(request);

      const [lead] = await db
        .insert(leads)
        .values({
          ...body.data,
          pipelineStageId: stage.id,
          status: deriveLeadStatus(stage),
          nextActionAt: body.data.nextActionAt
            ? new Date(body.data.nextActionAt)
            : undefined,
          createdBy: userId,
        })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'lead.created',
        entityType: 'lead',
        entityId: String(lead.id),
        newData: lead,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: lead });
    },
  );

  app.get(
    '/leads/:id',
    {
      preHandler: [authenticate, requirePermission('leads.read')],
    },
    async (request, reply) => {
      const params = leadIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [lead] = await db
        .select({
          id: leads.id,
          name: leads.name,
          companyName: leads.companyName,
          email: leads.email,
          phone: leads.phone,
          source: leads.source,
          status: leads.status,
          pipelineStageId: leads.pipelineStageId,
          stageName: pipelineStages.name,
          stageSlug: pipelineStages.slug,
          ownerUserId: leads.ownerUserId,
          ownerName: users.name,
          estimatedValue: leads.estimatedValue,
          probability: leads.probability,
          nextActionAt: leads.nextActionAt,
          nextActionDescription: leads.nextActionDescription,
          notes: leads.notes,
          convertedClientId: leads.convertedClientId,
          createdBy: leads.createdBy,
          createdAt: leads.createdAt,
          updatedAt: leads.updatedAt,
        })
        .from(leads)
        .innerJoin(pipelineStages, eq(leads.pipelineStageId, pipelineStages.id))
        .leftJoin(users, eq(leads.ownerUserId, users.id))
        .where(eq(leads.id, params.data.id))
        .limit(1);

      if (!lead) {
        return notFound(reply, 'Lead não encontrado.');
      }

      return { data: lead };
    },
  );

  app.patch(
    '/leads/:id',
    {
      preHandler: [authenticate, requirePermission('leads.update')],
    },
    async (request, reply) => {
      const params = leadIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateLeadSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Lead não encontrado.');
      }

      if (Object.keys(body.data).length === 0) {
        return { data: existing };
      }

      const userId = currentUserId(request);
      const isStageChange =
        body.data.pipelineStageId !== undefined &&
        body.data.pipelineStageId !== existing.pipelineStageId;

      let targetStage: PipelineStage | undefined;

      if (isStageChange) {
        targetStage = await getActiveStageById(body.data.pipelineStageId!);

        if (!targetStage) {
          return reply.code(422).send({
            error: 'invalid_pipeline_stage',
            message: 'Estágio do pipeline inválido ou inexistente.',
          });
        }
      }

      const values: Partial<typeof leads.$inferInsert> = {
        ...body.data,
        nextActionAt:
          body.data.nextActionAt !== undefined
            ? new Date(body.data.nextActionAt)
            : undefined,
        updatedAt: new Date(),
      };

      if (targetStage) {
        values.pipelineStageId = targetStage.id;
        values.status = deriveLeadStatus(targetStage);
      }

      // Alteração de estágio é uma operação composta (atualiza o lead,
      // registra atividade e auditoria) — roda em transação para não deixar
      // o lead atualizado sem o rastro correspondente em caso de falha.
      const updated = await db.transaction(async (tx) => {
        const [updatedLead] = await tx
          .update(leads)
          .set(values)
          .where(eq(leads.id, params.data.id))
          .returning();

        if (targetStage) {
          const [previousStage] = await tx
            .select()
            .from(pipelineStages)
            .where(eq(pipelineStages.id, existing.pipelineStageId))
            .limit(1);

          await tx.insert(crmActivities).values({
            leadId: updatedLead.id,
            userId,
            type: 'status_change',
            title: `Estágio alterado: ${previousStage?.name ?? existing.pipelineStageId} → ${targetStage.name}`,
            metadata: {
              fromStageId: existing.pipelineStageId,
              toStageId: targetStage.id,
            },
          });
        }

        return updatedLead;
      });

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: targetStage ? 'lead.stage_changed' : 'lead.updated',
        entityType: 'lead',
        entityId: String(updated.id),
        oldData: existing,
        newData: updated,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return { data: updated };
    },
  );

  app.post(
    '/leads/:id/convert',
    {
      preHandler: [authenticate, requirePermission('leads.convert')],
    },
    async (request, reply) => {
      const params = leadIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [existing] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Lead não encontrado.');
      }

      if (existing.convertedClientId) {
        return reply.code(409).send({
          error: 'lead_already_converted',
          message: 'Este lead já foi convertido em cliente.',
        });
      }

      const wonStage = await getWonStage();

      if (!wonStage) {
        return reply.code(422).send({
          error: 'missing_won_stage',
          message:
            'Nenhum estágio do pipeline está marcado como "ganho" (is_won). Configure o pipeline antes de converter leads.',
        });
      }

      const userId = currentUserId(request);

      const result = await db.transaction(async (tx) => {
        // Trava a linha do lead e reconfirma que ele ainda não foi
        // convertido, evitando conversão duplicada em requisições
        // concorrentes.
        const [lockedLead] = await tx
          .select()
          .from(leads)
          .where(eq(leads.id, params.data.id))
          .for('update')
          .limit(1);

        if (!lockedLead || lockedLead.convertedClientId) {
          return null;
        }

        const clientType = lockedLead.companyName ? 'company' : 'person';
        const clientName = lockedLead.companyName || lockedLead.name;

        const [client] = await tx
          .insert(clients)
          .values({
            type: clientType,
            name: clientName,
            email: lockedLead.email,
            phone: lockedLead.phone,
            status: 'active',
            notes: `Convertido a partir do lead #${lockedLead.id}.`,
            createdBy: userId,
          })
          .returning();

        let contact: typeof contacts.$inferSelect | undefined;

        // Cria o contato principal apenas se houver dados suficientes.
        if (lockedLead.name && (lockedLead.email || lockedLead.phone)) {
          [contact] = await tx
            .insert(contacts)
            .values({
              clientId: client.id,
              name: lockedLead.name,
              email: lockedLead.email,
              phone: lockedLead.phone,
              isPrimary: true,
            })
            .returning();
        }

        const [updatedLead] = await tx
          .update(leads)
          .set({
            convertedClientId: client.id,
            pipelineStageId: wonStage.id,
            status: 'won',
            updatedAt: new Date(),
          })
          .where(eq(leads.id, lockedLead.id))
          .returning();

        await tx.insert(crmActivities).values({
          leadId: updatedLead.id,
          clientId: client.id,
          userId,
          type: 'conversion',
          title: 'Lead convertido em cliente',
          metadata: { clientId: client.id, contactId: contact?.id ?? null },
        });

        return { lead: updatedLead, client, contact };
      });

      if (!result) {
        return reply.code(409).send({
          error: 'lead_already_converted',
          message: 'Este lead já foi convertido em cliente.',
        });
      }

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'lead.converted',
        entityType: 'lead',
        entityId: String(result.lead.id),
        oldData: existing,
        newData: result.lead,
        metadata: { clientId: result.client.id },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(200).send({
        data: {
          lead: result.lead,
          client: result.client,
          contact: result.contact ?? null,
        },
      });
    },
  );

  /*
   * Histórico de atividades do lead
   */

  app.get(
    '/leads/:id/activities',
    {
      preHandler: [authenticate, requirePermission('crm.activities.read')],
    },
    async (request, reply) => {
      const params = leadIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listActivitiesQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const [lead] = await db
        .select({ id: leads.id })
        .from(leads)
        .where(eq(leads.id, params.data.id))
        .limit(1);

      if (!lead) {
        return notFound(reply, 'Lead não encontrado.');
      }

      const { page, limit } = query.data;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select({
            id: crmActivities.id,
            leadId: crmActivities.leadId,
            clientId: crmActivities.clientId,
            userId: crmActivities.userId,
            userName: users.name,
            type: crmActivities.type,
            title: crmActivities.title,
            description: crmActivities.description,
            metadata: crmActivities.metadata,
            occurredAt: crmActivities.occurredAt,
            createdAt: crmActivities.createdAt,
          })
          .from(crmActivities)
          .leftJoin(users, eq(crmActivities.userId, users.id))
          .where(eq(crmActivities.leadId, params.data.id))
          .orderBy(desc(crmActivities.occurredAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(crmActivities)
          .where(eq(crmActivities.leadId, params.data.id)),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/leads/:id/activities',
    {
      preHandler: [authenticate, requirePermission('crm.activities.create')],
    },
    async (request, reply) => {
      const params = leadIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createActivitySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [lead] = await db
        .select({ id: leads.id })
        .from(leads)
        .where(eq(leads.id, params.data.id))
        .limit(1);

      if (!lead) {
        return notFound(reply, 'Lead não encontrado.');
      }

      const userId = currentUserId(request);

      const [activity] = await db
        .insert(crmActivities)
        .values({
          ...body.data,
          leadId: params.data.id,
          userId,
          occurredAt: body.data.occurredAt
            ? new Date(body.data.occurredAt)
            : new Date(),
        })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'crm.activity.created',
        entityType: 'crm_activity',
        entityId: String(activity.id),
        newData: activity,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: activity });
    },
  );
}
