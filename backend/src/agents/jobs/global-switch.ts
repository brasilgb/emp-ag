import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { settings } from '../../db/schema/index.js';

// Agentes v1.3 (correio.md seção 14 — kill switch global): reaproveita a
// tabela `settings` já existente no schema (key/value genérico) em vez de
// criar uma tabela/config nova só para este flag — "não criar
// configuração duplicada caso arquitetura já possua equivalente". Só
// afeta triggers automáticos (schedule/internal_event, ver
// agents/jobs/job-runner.ts); execução manual continua sujeita apenas às
// permissions normais.
export const AUTONOMOUS_EXECUTION_SETTING_KEY = 'agents_autonomous_execution_enabled';

export async function isAutonomousExecutionEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, AUTONOMOUS_EXECUTION_SETTING_KEY))
    .limit(1);

  // Sem linha configurada ainda → default seguro é ligado (mesmo
  // comportamento de antes deste flag existir); só desligar explicitamente
  // via setAutonomousExecutionEnabled(false) bloqueia triggers automáticos.
  if (!row) {
    return true;
  }

  return row.value === true;
}

export async function setAutonomousExecutionEnabled(enabled: boolean): Promise<void> {
  const [existing] = await db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.key, AUTONOMOUS_EXECUTION_SETTING_KEY))
    .limit(1);

  if (existing) {
    await db
      .update(settings)
      .set({ value: enabled, updatedAt: new Date() })
      .where(eq(settings.key, AUTONOMOUS_EXECUTION_SETTING_KEY));

    return;
  }

  await db.insert(settings).values({
    key: AUTONOMOUS_EXECUTION_SETTING_KEY,
    value: enabled,
    description: 'Quando false, Jobs automáticos (schedule/internal_event) não iniciam novos Runs (correio.md v1.3 seção 14).',
  });
}
