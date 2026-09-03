import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { settings } from '../../db/schema/index.js';

/**
 * Agentes v2.5.1 (correio.md seção 7) — "Se o projeto já possui
 * mecanismo apropriado de settings administrativos persistidos e
 * auditáveis, utilizar esse mecanismo": reaproveita a MESMA tabela
 * `settings` (key/value genérico) e o MESMO padrão de
 * `agents/jobs/global-switch.ts` (v1.3, kill switch de autonomia) —
 * nunca a tabela `agent_operational_settings` (v1.7, mais rica, com
 * catálogo/tipo/escopo por Job) porque este é um único flag global,
 * sem escopo por Job, exatamente o caso que `global-switch.ts` já
 * resolve.
 *
 * Direção do default DELIBERADAMENTE OPOSTA à do kill switch de
 * autonomia (que é `true` por padrão — autonomia assumida ligada até
 * alguém desligar): aqui o default é `false` — a supervisão automática
 * só liga com uma decisão administrativa explícita (seção 5), mesmo com
 * o timer do scheduler já criado no boot (`env.AGENT_OPERATIONAL_SUPERVISION_ENABLED`,
 * ver config/env.ts).
 */
export const OPERATIONAL_SUPERVISION_SETTING_KEY = 'agents_operational_supervision_enabled';

export async function isOperationalSupervisionEnabled(): Promise<boolean> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, OPERATIONAL_SUPERVISION_SETTING_KEY)).limit(1);

  if (!row) return false;
  return row.value === true;
}

export async function setOperationalSupervisionEnabled(enabled: boolean): Promise<void> {
  const [existing] = await db.select({ id: settings.id }).from(settings).where(eq(settings.key, OPERATIONAL_SUPERVISION_SETTING_KEY)).limit(1);

  if (existing) {
    await db.update(settings).set({ value: enabled, updatedAt: new Date() }).where(eq(settings.key, OPERATIONAL_SUPERVISION_SETTING_KEY));
    return;
  }

  await db.insert(settings).values({
    key: OPERATIONAL_SUPERVISION_SETTING_KEY,
    value: enabled,
    description: 'Quando true, o scheduler de Supervisão Operacional (Agentes v2.5.1) dispara runOperationalSupervision({dryRun:false}) a cada tick.',
  });
}
