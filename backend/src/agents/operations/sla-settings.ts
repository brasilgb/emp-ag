import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { settings } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import { OPERATIONAL_SEVERITIES } from './health-types.js';
import type { OperationalSeverity } from './health-types.js';

/**
 * Agentes v4.1 (correio.md "Operational Incident Aging & SLA
 * Visibility", seção 1/3) — descoberta feita ANTES de criar qualquer
 * persistência: nenhuma das duas estruturas de settings já existentes
 * era um encaixe correto.
 *
 * - `agent_operational_settings` (v1.7, catálogo/resolver com
 *   escopo global/job) é EXPLICITAMENTE escopada, no próprio
 *   docblock de `agents/settings/catalog.ts`, às 6 chaves do
 *   Autonomy Guard ("prioridade explícita para autonomia") — SLA de
 *   incidente não tem escopo por Job (não é uma configuração "por
 *   Job", é global por severidade) e misturar os dois catálogos sob o
 *   mesmo namespace de API (`/agents/settings/...`) confundiria duas
 *   responsabilidades distintas sem necessidade.
 * - A tabela genérica `settings` (key/jsonb) — reaproveitada aqui,
 *   MESMO padrão já usado por `scheduler-settings.ts` (v2.5.1) para
 *   "um único flag/config global, sem escopo por Job": um único valor
 *   jsonb (`{ info, warning, critical }`) sob UMA chave, nunca uma
 *   linha por severidade (correio.md seção 3: "não criar um motor
 *   genérico de políticas se o requisito puder ser atendido por uma
 *   configuração pequena e fechada").
 *
 * **Nenhuma migration criada** — `settings` já existe desde a v1.x.
 *
 * Defaults (minutos por severidade) alinhados DELIBERADAMENTE aos
 * mesmos limites já estabelecidos por `AGING_BUCKETS` (v3.7,
 * `supervision-insights-service.ts`: `<1h`/`1h-4h`/`4h-24h`/`>24h`) —
 * nunca um número novo inventado sem relação com o que a UI já usa:
 * severidade `critical` herda o limite mais apertado já em uso (1h),
 * `warning` o intermediário (4h), `info` o mais frouxo (24h). Continua
 * 100% editável via `getOperationalSlaMinutesBySeverity`/
 * `setOperationalSlaMinutesBySeverity` — nunca "silencioso": o valor
 * usado é sempre o que está persistido (ou este default documentado,
 * visível via GET).
 */
export const SLA_SETTING_KEY = 'agents_operational_sla_minutes_by_severity';

export type OperationalSlaMinutesBySeverity = Record<OperationalSeverity, number>;

export const DEFAULT_SLA_MINUTES_BY_SEVERITY: OperationalSlaMinutesBySeverity = {
  critical: 60, // 1h — mesmo limite de AGING_BUCKETS '<1h'
  warning: 240, // 4h — mesmo limite de AGING_BUCKETS '1h-4h'..'4h-24h'
  info: 1440, // 24h — mesmo limite de AGING_BUCKETS '4h-24h'..'>24h'
};

function isValidMinutesMap(value: unknown): value is OperationalSlaMinutesBySeverity {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return OPERATIONAL_SEVERITIES.every((severity) => typeof record[severity] === 'number' && Number.isFinite(record[severity]) && (record[severity] as number) > 0);
}

export async function getOperationalSlaMinutesBySeverity(): Promise<OperationalSlaMinutesBySeverity> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SLA_SETTING_KEY)).limit(1);

  if (!row || !isValidMinutesMap(row.value)) return DEFAULT_SLA_MINUTES_BY_SEVERITY;
  return row.value;
}

export type SetSlaMinutesResult = { ok: true; value: OperationalSlaMinutesBySeverity } | { ok: false; message: string };

/**
 * Validação (correio.md seção 3: "os valores concretos não devem ser
 * inventados silenciosamente" — aqui, nunca aceitos sem checagem):
 * inteiro positivo, no máximo 30 dias (43200min) — nenhum SLA "sem
 * prazo" nesta versão (correio.md seção 17 proíbe "prioridade
 * automática"/"job periódico"; um valor finito e pequeno mantém a
 * política simples e auditável).
 */
function validateMinutes(value: unknown): { ok: true; value: number } | { ok: false; message: string } {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return { ok: false, message: 'Cada valor de SLA deve ser um número inteiro finito de minutos.' };
  if (value < 1 || value > 43200) return { ok: false, message: 'Cada valor de SLA deve estar entre 1 e 43200 minutos (30 dias).' };
  return { ok: true, value };
}

export async function setOperationalSlaMinutesBySeverity(input: Partial<OperationalSlaMinutesBySeverity>, actorUserId: number): Promise<SetSlaMinutesResult> {
  const previous = await getOperationalSlaMinutesBySeverity();
  const next: OperationalSlaMinutesBySeverity = { ...previous };

  for (const severity of OPERATIONAL_SEVERITIES) {
    const provided = input[severity];
    if (provided === undefined) continue;
    const validated = validateMinutes(provided);
    if (!validated.ok) return { ok: false, message: `${severity}: ${validated.message}` };
    next[severity] = validated.value;
  }

  const [existing] = await db.select({ id: settings.id }).from(settings).where(eq(settings.key, SLA_SETTING_KEY)).limit(1);

  if (existing) {
    await db.update(settings).set({ value: next, updatedAt: new Date() }).where(eq(settings.key, SLA_SETTING_KEY));
  } else {
    await db.insert(settings).values({
      key: SLA_SETTING_KEY,
      value: next,
      description: 'SLA operacional (minutos até o prazo) por severidade de incidente — Agentes v4.1.',
    });
  }

  // Auditoria (correio.md seção 13: "cada alteração deve ser auditada
  // com ator, valor anterior, valor novo, timestamp, contexto
  // suficiente") — só ao ALTERAR a configuração, nunca ao ler/calcular
  // SLA (seção 13: "leitura e cálculo de SLA não geram audit log").
  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.operations.sla_settings.updated',
    entityType: 'agent_operational_sla_settings',
    entityId: null,
    metadata: { previous, next },
  });

  return { ok: true, value: next };
}
