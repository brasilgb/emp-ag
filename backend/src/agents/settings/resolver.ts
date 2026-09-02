import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalSettings } from '../../db/schema/index.js';
import type { Tx } from '../../routes/agents/helpers.js';

import { AGENT_OPERATIONAL_SETTINGS, SETTING_KEYS, type SettingKey, validateSettingValue } from './catalog.js';

export type SettingSource = 'job' | 'global' | 'default';

export interface ResolvedSetting {
  key: SettingKey;
  /** Valor persistido no escopo mais específico aplicável (job, se houver Job e override; senão global); null quando não há override em nenhum escopo. */
  configuredValue: number | null;
  effectiveValue: number;
  source: SettingSource;
  defaultValue: number;
}

export type SettingsSnapshot = Record<SettingKey, ResolvedSetting>;

/**
 * "Ponte de compatibilidade" documentada (correio.md não conhece o
 * schema do projeto — decisão de implementação): rate.autonomyLimit e
 * rate.autonomyWindowSeconds já tinham override por Job desde a v1.5
 * (colunas agent_jobs.autonomy_rate_limit_override/
 * autonomy_rate_window_override_seconds), testado e em produção antes da
 * v1.7 existir. Em vez de duplicar/migrar dados silenciosamente, o
 * resolver trata essas colunas como uma origem "job" alternativa,
 * consultada quando não há linha correspondente na tabela nova — nunca
 * as duas fontes ao mesmo tempo, e a tabela nova sempre vence se
 * presente (permite migração gradual sem quebrar overrides existentes).
 */
const LEGACY_JOB_COLUMN_KEYS: readonly SettingKey[] = ['rate.autonomyLimit', 'rate.autonomyWindowSeconds'];

export interface LegacyJobOverrides {
  autonomyRateLimitOverride: number | null;
  autonomyRateWindowOverrideSeconds: number | null;
}

function legacyValueFor(key: SettingKey, legacy: LegacyJobOverrides | undefined): number | null {
  if (!legacy) return null;
  if (key === 'rate.autonomyLimit') return legacy.autonomyRateLimitOverride;
  if (key === 'rate.autonomyWindowSeconds') return legacy.autonomyRateWindowOverrideSeconds;
  return null;
}

/**
 * Extrai um número válido de uma linha persistida, ou `null` se o valor
 * estiver corrompido/fora de faixa — fail-safe (correio.md "Em caso de
 * valor inválido... usar a configuração mais restritiva aplicável"):
 * nunca usamos um valor persistido inválido, sempre caímos para o
 * próximo escopo (job → global → default), que é sempre o valor com que
 * o sistema já rodava antes desta linha existir — a opção mais segura
 * disponível, sem precisar decidir "mais restritivo" por chave (uma
 * lógica direcional própria seria mais um lugar para um bug de segurança
 * se invertida).
 */
function safeNumberFromRow(key: SettingKey, raw: unknown): number | null {
  const validation = validateSettingValue(key, raw);
  return validation.ok ? validation.value : null;
}

/**
 * Agentes v1.7 ("Hierarquia das configurações" / "AgentOperationalConfigResolver")
 * — ponto único de leitura de configuração operacional. Sempre 2 queries
 * (linhas globais + linhas do Job, ambas com IN nas 6 chaves), nunca uma
 * por chave. Chamado uma única vez no início de cada Run (job-runner.ts)
 * — o resultado (`SettingsSnapshot`) é um retrato coerente usado durante
 * toda a avaliação daquele Run, nunca reconsultado no meio (correio.md
 * "Importante: consistência temporal").
 */
export async function resolveSettingsSnapshot(params: {
  jobId: number | null;
  legacyJobOverrides?: LegacyJobOverrides;
  tx?: Tx;
}): Promise<SettingsSnapshot> {
  const executor = params.tx ?? db;

  const globalRows = await executor
    .select()
    .from(agentOperationalSettings)
    .where(and(eq(agentOperationalSettings.scope, 'global'), inArray(agentOperationalSettings.key, SETTING_KEYS)));

  const jobRows = params.jobId
    ? await executor
        .select()
        .from(agentOperationalSettings)
        .where(
          and(
            eq(agentOperationalSettings.scope, 'job'),
            eq(agentOperationalSettings.scopeId, params.jobId),
            inArray(agentOperationalSettings.key, SETTING_KEYS),
          ),
        )
    : [];

  const globalByKey = new Map(globalRows.map((row) => [row.key as SettingKey, row]));
  const jobByKey = new Map(jobRows.map((row) => [row.key as SettingKey, row]));

  const snapshot = {} as SettingsSnapshot;

  for (const key of SETTING_KEYS) {
    const definition = AGENT_OPERATIONAL_SETTINGS[key];

    const jobRow = jobByKey.get(key);
    const jobValue = jobRow ? safeNumberFromRow(key, jobRow.value) : null;

    const legacyValue = LEGACY_JOB_COLUMN_KEYS.includes(key) ? legacyValueFor(key, params.legacyJobOverrides) : null;
    // Tabela nova sempre vence sobre a coluna legada quando ambas existem.
    const effectiveJobValue = jobValue ?? (legacyValue !== null ? safeNumberFromRow(key, legacyValue) : null);

    if (effectiveJobValue !== null) {
      snapshot[key] = {
        key,
        configuredValue: effectiveJobValue,
        effectiveValue: effectiveJobValue,
        source: 'job',
        defaultValue: definition.defaultValue,
      };
      continue;
    }

    const globalRow = globalByKey.get(key);
    const globalValue = globalRow ? safeNumberFromRow(key, globalRow.value) : null;

    if (globalValue !== null) {
      snapshot[key] = {
        key,
        configuredValue: globalValue,
        effectiveValue: globalValue,
        source: 'global',
        defaultValue: definition.defaultValue,
      };
      continue;
    }

    snapshot[key] = {
      key,
      configuredValue: null,
      effectiveValue: definition.defaultValue,
      source: 'default',
      defaultValue: definition.defaultValue,
    };
  }

  return snapshot;
}

export function effectiveValue(snapshot: SettingsSnapshot, key: SettingKey): number {
  return snapshot[key].effectiveValue;
}

/** Resolve uma única chave, escopo global (usado pela API de leitura fora do contexto de um Run). */
export async function resolveGlobalSetting(key: SettingKey): Promise<ResolvedSetting> {
  const snapshot = await resolveSettingsSnapshot({ jobId: null });
  return snapshot[key];
}

/** Resolve uma única chave para um Job específico (API de leitura de overrides do Job). */
export async function resolveJobSetting(key: SettingKey, jobId: number, legacyJobOverrides?: LegacyJobOverrides): Promise<ResolvedSetting> {
  const snapshot = await resolveSettingsSnapshot({ jobId, legacyJobOverrides });
  return snapshot[key];
}
