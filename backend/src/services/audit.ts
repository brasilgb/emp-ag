import { db } from '../db/index.js';
import { auditLogs } from '../db/schema/index.js';

interface AuditInput {
  userId?: number | null;

  actorType: 'user' | 'agent' | 'system' | 'n8n' | 'worker';

  actorId?: string | null;

  action: string;

  entityType?: string | null;
  entityId?: string | null;

  oldData?: unknown;
  newData?: unknown;
  metadata?: unknown;

  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function audit(input: AuditInput) {
  await db.insert(auditLogs).values({
    userId: input.userId ?? null,

    actorType: input.actorType,
    actorId: input.actorId ?? null,

    action: input.action,

    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,

    oldData: input.oldData,
    newData: input.newData,
    metadata: input.metadata,

    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}
