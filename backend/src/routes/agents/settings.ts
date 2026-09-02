import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentJobs, agentOperationalSettings } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import { SETTING_KEYS, getSettingDefinition, validateSettingValue, type SettingKey } from '../../agents/settings/catalog.js';
import { resolveSettingsSnapshot, type ResolvedSetting } from '../../agents/settings/resolver.js';
import {
  jobIdParamSchema,
  jobSettingKeyParamSchema,
  setSettingBodySchema,
  settingKeyParamSchema,
} from '../../agents/settings/schemas.js';

import { badRequest, currentUserId, notFound } from './helpers.js';

/**
 * Agentes v1.7 (correio.md "Backend - endpoints") - API administrativa de
 * configuracao operacional. `read` visualiza configuracao efetiva;
 * `manage` escreve. Nunca aceita key arbitraria (settingKeyParamSchema
 * rejeita antes de chegar aqui). DELETE remove o override persistido e
 * volta a configuracao herdada/default - nunca apaga o conceito/catalogo
 * da configuracao (que vive em codigo, nao no banco).
 */
export async function agentSettingsRoutes(app: FastifyInstance) {
  // ---- Escopo global ----

  app.get(
    '/settings',
    { preHandler: [authenticate, requirePermission('agents.settings.read')] },
    async () => {
      const snapshot = await resolveSettingsSnapshot({ jobId: null });
      const data = SETTING_KEYS.map((key) => withMetadata(snapshot[key]));
      return { data };
    },
  );

  app.get(
    '/settings/:key',
    { preHandler: [authenticate, requirePermission('agents.settings.read')] },
    async (request, reply) => {
      const params = settingKeyParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const key = params.data.key as SettingKey;
      const snapshot = await resolveSettingsSnapshot({ jobId: null });
      return { data: withMetadata(snapshot[key]) };
    },
  );

  app.patch(
    '/settings/:key',
    { preHandler: [authenticate, requirePermission('agents.settings.manage')] },
    async (request, reply) => {
      const params = settingKeyParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = setSettingBodySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const key = params.data.key as SettingKey;
      const validation = validateSettingValue(key, body.data.value);
      if (!validation.ok) {
        return reply.code(400).send({ error: 'invalid_request', message: validation.message });
      }

      const before = await resolveSettingsSnapshot({ jobId: null });
      const previous = before[key];

      const userId = currentUserId(request);

      await db
        .insert(agentOperationalSettings)
        .values({
          key,
          scope: 'global',
          scopeId: null,
          value: validation.value,
          valueType: 'number',
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [agentOperationalSettings.key],
          set: { value: validation.value, updatedBy: userId, updatedAt: new Date() },
          targetWhere: eq(agentOperationalSettings.scope, 'global'),
        });

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: previous.source === 'global' ? 'agents.settings.updated' : 'agents.settings.override_created',
        entityType: 'agent_operational_setting',
        entityId: key,
        metadata: { key, scope: 'global', scopeId: null, previousValue: previous.effectiveValue, newValue: validation.value },
      });

      const after = await resolveSettingsSnapshot({ jobId: null });
      return { data: withMetadata(after[key]) };
    },
  );

  app.delete(
    '/settings/:key',
    { preHandler: [authenticate, requirePermission('agents.settings.manage')] },
    async (request, reply) => {
      const params = settingKeyParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const key = params.data.key as SettingKey;
      const before = await resolveSettingsSnapshot({ jobId: null });
      const previous = before[key];

      const userId = currentUserId(request);

      await db
        .delete(agentOperationalSettings)
        .where(and(eq(agentOperationalSettings.key, key), eq(agentOperationalSettings.scope, 'global')));

      if (previous.source === 'global') {
        await audit({
          userId,
          actorType: 'user',
          actorId: String(userId),
          action: 'agents.settings.override_removed',
          entityType: 'agent_operational_setting',
          entityId: key,
          metadata: { key, scope: 'global', scopeId: null, previousValue: previous.effectiveValue },
        });
      }

      const after = await resolveSettingsSnapshot({ jobId: null });
      return { data: withMetadata(after[key]) };
    },
  );

  // ---- Escopo Job (override) ----

  app.get(
    '/jobs/:id/settings',
    { preHandler: [authenticate, requirePermission('agents.settings.read')] },
    async (request, reply) => {
      const params = jobIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const job = await loadJob(params.data.id);
      if (!job) return notFound(reply, 'Job nao encontrado.');

      const snapshot = await resolveSettingsSnapshot({ jobId: job.id, legacyJobOverrides: legacyOverridesOf(job) });
      const data = SETTING_KEYS.map((key) => withMetadata(snapshot[key]));
      return { data };
    },
  );

  app.patch(
    '/jobs/:id/settings/:key',
    { preHandler: [authenticate, requirePermission('agents.settings.manage')] },
    async (request, reply) => {
      const params = jobSettingKeyParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const job = await loadJob(params.data.id);
      if (!job) return notFound(reply, 'Job nao encontrado.');

      const body = setSettingBodySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const key = params.data.key as SettingKey;
      const definition = getSettingDefinition(key);

      if (!definition.scopes.includes('job')) {
        return reply.code(400).send({ error: 'invalid_request', message: `"${key}" nao suporta override por Job.` });
      }

      const validation = validateSettingValue(key, body.data.value);
      if (!validation.ok) {
        return reply.code(400).send({ error: 'invalid_request', message: validation.message });
      }

      const before = await resolveSettingsSnapshot({ jobId: job.id, legacyJobOverrides: legacyOverridesOf(job) });
      const previous = before[key];

      const userId = currentUserId(request);

      await db
        .insert(agentOperationalSettings)
        .values({
          key,
          scope: 'job',
          scopeId: job.id,
          value: validation.value,
          valueType: 'number',
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [agentOperationalSettings.key, agentOperationalSettings.scopeId],
          set: { value: validation.value, updatedBy: userId, updatedAt: new Date() },
          targetWhere: eq(agentOperationalSettings.scope, 'job'),
        });

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: previous.source === 'job' ? 'agents.settings.updated' : 'agents.settings.override_created',
        entityType: 'agent_operational_setting',
        entityId: key,
        metadata: { key, scope: 'job', scopeId: job.id, previousValue: previous.effectiveValue, newValue: validation.value },
      });

      const after = await resolveSettingsSnapshot({ jobId: job.id, legacyJobOverrides: legacyOverridesOf(job) });
      return { data: withMetadata(after[key]) };
    },
  );

  app.delete(
    '/jobs/:id/settings/:key',
    { preHandler: [authenticate, requirePermission('agents.settings.manage')] },
    async (request, reply) => {
      const params = jobSettingKeyParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const job = await loadJob(params.data.id);
      if (!job) return notFound(reply, 'Job nao encontrado.');

      const key = params.data.key as SettingKey;
      const before = await resolveSettingsSnapshot({ jobId: job.id, legacyJobOverrides: legacyOverridesOf(job) });
      const previous = before[key];

      const userId = currentUserId(request);

      await db
        .delete(agentOperationalSettings)
        .where(
          and(
            eq(agentOperationalSettings.key, key),
            eq(agentOperationalSettings.scope, 'job'),
            eq(agentOperationalSettings.scopeId, job.id),
          ),
        );

      // DELETE precisa significar "voltar a herdar" de verdade (correio.md
      // "Backend - endpoints") - se ainda existisse valor na coluna legada
      // (rate.autonomyLimit/autonomyWindowSeconds), o resolver continuaria
      // usando-a como override "job" mesmo depois de remover a linha nova,
      // o que contradiria a semantica de DELETE. Zeramos a coluna legada
      // tambem quando a chave e uma das dela.
      if (key === 'rate.autonomyLimit') {
        await db.update(agentJobs).set({ autonomyRateLimitOverride: null }).where(eq(agentJobs.id, job.id));
      } else if (key === 'rate.autonomyWindowSeconds') {
        await db.update(agentJobs).set({ autonomyRateWindowOverrideSeconds: null }).where(eq(agentJobs.id, job.id));
      }

      if (previous.source === 'job') {
        await audit({
          userId,
          actorType: 'user',
          actorId: String(userId),
          action: 'agents.settings.override_removed',
          entityType: 'agent_operational_setting',
          entityId: key,
          metadata: { key, scope: 'job', scopeId: job.id, previousValue: previous.effectiveValue },
        });
      }

      const after = await resolveSettingsSnapshot({ jobId: job.id });
      return { data: withMetadata(after[key]) };
    },
  );
}

async function loadJob(id: number) {
  const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, id)).limit(1);
  return job ?? null;
}

function legacyOverridesOf(job: typeof agentJobs.$inferSelect) {
  return {
    autonomyRateLimitOverride: job.autonomyRateLimitOverride,
    autonomyRateWindowOverrideSeconds: job.autonomyRateWindowOverrideSeconds,
  };
}

function withMetadata(resolved: ResolvedSetting) {
  const definition = getSettingDefinition(resolved.key);
  return {
    ...resolved,
    type: definition.type,
    min: definition.min,
    max: definition.max,
    description: definition.description,
    scopes: definition.scopes,
  };
}
