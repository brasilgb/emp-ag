import { env } from '../../config/env.js';

/**
 * Agentes v1.7 (correio.md "Documentacao da configuracao") - catalogo
 * unico das configuracoes operacionais suportadas. Fonte de verdade para
 * validacao, defaults e metadata da API - nunca duplicado em backend e
 * frontend (o frontend consulta a API, que usa este catalogo).
 *
 * Escopo desta versao (correio.md "Configuracoes inicialmente
 * suportadas" - prioridade explicita para autonomia): as 6 chaves
 * ligadas ao Autonomy Guard (agents/autonomy/guard.ts) que hoje so tem
 * default via env, global e imutavel em runtime. Nao incluidas aqui
 * (classificacao completa no relatorio de entrega):
 *
 * - AGENT_LLM_* - ativacao deliberada de LLM/shadow mode, decisao de
 *   infraestrutura/custo, nao "limite operacional" de autonomia;
 * - AGENT_JOBS_SCHEDULER_ENABLED, AGENT_EVENTS_PROCESSOR_ENABLED,
 *   POLL_INTERVAL_MS - ligam/desligam infraestrutura do proprio processo;
 * - MAX_ACTIONS_PER_PLAN - constante de seguranca (teto estrutural do
 *   planner), nunca editavel pela UI;
 * - MAX_REQUESTS (rate limit de API HTTP) e MAX_EVENTS_PER_TICK (tuning
 *   de worker) - fora do escopo "autonomia" priorizado por esta versao.
 *
 * Limites (min/max) derivados do comportamento real do projeto, nao
 * copiados cegamente do exemplo do correio.md:
 *
 * - circuit.failureThreshold/cooldownSeconds: mesma faixa sugerida
 *   pelo correio.md (1..20 falhas, 1s..24h de cooldown) - nenhum uso real
 *   no projeto hoje justifica algo diferente.
 * - autonomy.maxDepth: default atual e 8 (env.ts) - um teto de 10,
 *   como sugerido no correio.md, cortaria o proprio default de producao;
 *   usamos 0..20 para manter headroom real acima do default existente.
 * - chain.maxRunsPerAutonomyChain: default atual e 25 - teto de 200
 *   (multiplo generoso do default, sem permitir cadeias
 *   "ilimitadas na pratica").
 * - rate.autonomyLimit/autonomyWindowSeconds: default atual 20/300s
 *   - teto de 1000 execucoes / 24h de janela, mesma logica.
 */
export type SettingValueType = 'number' | 'boolean';

export interface SettingDefinition {
  key: string;
  type: SettingValueType;
  /**
   * Valor usado quando nao ha override job nem global. Getter (nao um
   * campo capturado) de proposito: env.ts ja expoe os defaults como
   * getters que leem `process.env` a cada acesso — varios testes
   * existentes (ex.: job-runner.autonomy.test.ts) mutam
   * `process.env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD` em runtime
   * por teste. Se este catalogo capturasse o valor uma unica vez no
   * import do modulo (antes de qualquer teste rodar), o resolver nunca
   * veria essas mudancas — bug real encontrado e corrigido antes de
   * escrever os testes da v1.7, nao depois.
   */
  readonly defaultValue: number;
  min: number;
  max: number;
  description: string;
  /** Nome do getter em config/env.ts que hoje fornece o default - so para rastreabilidade no relatorio/API, nunca lido dinamicamente por string. */
  previousSource: string;
  scopes: readonly ('global' | 'job')[];
}

export const AGENT_OPERATIONAL_SETTINGS = {
  'circuit.failureThreshold': {
    key: 'circuit.failureThreshold',
    type: 'number',
    get defaultValue() {
      return env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD;
    },
    min: 1,
    max: 20,
    description: 'Falhas autonomas consecutivas ate o circuit breaker abrir para um Job.',
    previousSource: 'AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD',
    scopes: ['global', 'job'],
  },
  'circuit.cooldownSeconds': {
    key: 'circuit.cooldownSeconds',
    type: 'number',
    get defaultValue() {
      return env.AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS;
    },
    min: 1,
    max: 86400,
    description: 'Tempo (segundos) que o circuit breaker permanece aberto antes de permitir uma tentativa controlada (half_open).',
    previousSource: 'AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS',
    scopes: ['global', 'job'],
  },
  'autonomy.maxDepth': {
    key: 'autonomy.maxDepth',
    type: 'number',
    get defaultValue() {
      return env.AGENT_MAX_AUTONOMY_DEPTH;
    },
    min: 0,
    max: 20,
    description: 'Profundidade maxima de uma cadeia autonoma (hops) antes de bloquear com autonomy_depth_exceeded.',
    previousSource: 'AGENT_MAX_AUTONOMY_DEPTH',
    scopes: ['global', 'job'],
  },
  'chain.maxRunsPerAutonomyChain': {
    key: 'chain.maxRunsPerAutonomyChain',
    type: 'number',
    get defaultValue() {
      return env.AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN;
    },
    min: 1,
    max: 200,
    description: 'Numero maximo de Runs que uma unica cadeia causal autonoma pode gerar (chain budget).',
    previousSource: 'AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN',
    scopes: ['global', 'job'],
  },
  'rate.autonomyLimit': {
    key: 'rate.autonomyLimit',
    type: 'number',
    get defaultValue() {
      return env.AGENT_JOB_AUTONOMY_RATE_LIMIT;
    },
    min: 1,
    max: 1000,
    description: 'Execucoes autonomas (nao-manuais) permitidas por Job dentro da janela de rate limit.',
    previousSource: 'AGENT_JOB_AUTONOMY_RATE_LIMIT (+ coluna legada agent_jobs.autonomy_rate_limit_override)',
    scopes: ['global', 'job'],
  },
  'rate.autonomyWindowSeconds': {
    key: 'rate.autonomyWindowSeconds',
    type: 'number',
    get defaultValue() {
      return env.AGENT_JOB_AUTONOMY_RATE_WINDOW_SECONDS;
    },
    min: 1,
    max: 86400,
    description: 'Duracao (segundos) da janela de rate limit autonomo por Job.',
    previousSource: 'AGENT_JOB_AUTONOMY_RATE_WINDOW_SECONDS (+ coluna legada agent_jobs.autonomy_rate_window_override_seconds)',
    scopes: ['global', 'job'],
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof AGENT_OPERATIONAL_SETTINGS;

export const SETTING_KEYS = Object.keys(AGENT_OPERATIONAL_SETTINGS) as SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return Object.prototype.hasOwnProperty.call(AGENT_OPERATIONAL_SETTINGS, value);
}

export function getSettingDefinition(key: SettingKey): SettingDefinition {
  return AGENT_OPERATIONAL_SETTINGS[key];
}

/**
 * Validacao de valor contra o catalogo (correio.md "Validation") - nunca
 * aceita chave desconhecida, tipo errado, fora de faixa, Infinity, NaN ou
 * negativo quando nao fizer sentido. Unico ponto de validacao, usado
 * tanto pelas rotas quanto pelos testes.
 */
export function validateSettingValue(key: SettingKey, value: unknown): { ok: true; value: number } | { ok: false; message: string } {
  const definition = AGENT_OPERATIONAL_SETTINGS[key];

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: `Valor de "${key}" deve ser um numero finito.` };
  }

  if (!Number.isInteger(value)) {
    return { ok: false, message: `Valor de "${key}" deve ser um numero inteiro.` };
  }

  if (value < definition.min || value > definition.max) {
    return { ok: false, message: `Valor de "${key}" deve estar entre ${definition.min} e ${definition.max} (recebido: ${value}).` };
  }

  return { ok: true, value };
}
