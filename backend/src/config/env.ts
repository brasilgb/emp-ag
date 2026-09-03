const required = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variável obrigatória ausente: ${name}`);
  }

  return value;
};

const boolFlag = (name: string, fallback: boolean): boolean => {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return value === 'true';
};

// Agentes v1.5 — Autonomous Safety & Governance (correio.md seção 27).
// Mesmo estilo dos getters acima (nunca Zod aqui — env.ts não usa Zod em
// nenhum lugar real do projeto, apesar da sugestão do correio.md; o
// bounds-check é feito à mão, falhando alto (fail-fast) como required()).
const positiveIntEnv = (name: string, fallback: number, min = 1): number => {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`Variável ${name} inválida: deve ser um inteiro >= ${min} (recebido: "${raw}").`);
  }

  return parsed;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',

  PORT: Number(process.env.PORT ?? 8000),
  HOST: process.env.HOST ?? '0.0.0.0',

  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: required('REDIS_URL'),

  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '8h',

  // Agentes v1.1 — LLM Interpreter + Shadow Mode (seção 5). Todos
  // opcionais com default seguro: com AGENT_LLM_ENABLED=false (default),
  // nenhuma chamada de LLM acontece e o sistema se comporta exatamente
  // como a v1. Nunca versionar AGENT_LLM_API_KEY (fica de fora do
  // required() de propósito — sua ausência não deve derrubar o boot).
  //
  // Definidos como getters (em vez de valores capturados uma vez no
  // import) de propósito: os testes de backend/src/routes/agents/llm.test.ts
  // e backend/src/agents/llm/interpreter.test.ts precisam ligar/desligar
  // AGENT_LLM_ENABLED/SHADOW_MODE por teste (mutando process.env
  // diretamente) sem reiniciar o processo — em produção o valor nunca
  // muda depois do boot, então o custo de reler process.env a cada
  // acesso é irrelevante.
  get AGENT_LLM_ENABLED(): boolean {
    return boolFlag('AGENT_LLM_ENABLED', false);
  },
  // true (default): shadow mode — o LLM só é medido, nunca decide a
  // resposta. false: fallback mode (seção 14) — o LLM passa a ser
  // consultado quando o roteador determinístico não reconhece a
  // intenção. Ativar isso é uma decisão explícita do operador, nunca
  // automática (seção 34).
  get AGENT_LLM_SHADOW_MODE(): boolean {
    return boolFlag('AGENT_LLM_SHADOW_MODE', true);
  },
  get AGENT_LLM_PROVIDER(): string {
    return process.env.AGENT_LLM_PROVIDER ?? 'gemini';
  },
  get AGENT_LLM_MODEL(): string {
    return process.env.AGENT_LLM_MODEL ?? 'gemini-2.0-flash';
  },
  get AGENT_LLM_API_KEY(): string {
    return process.env.AGENT_LLM_API_KEY ?? '';
  },
  // Key própria do provider OpenAI — separada de AGENT_LLM_API_KEY (que é
  // do Gemini) de propósito: cada provider lê só a sua, nunca uma key
  // genérica compartilhada entre providers diferentes. Nunca versionar
  // (mesmo racional do comentário acima).
  get OPENAI_API_KEY(): string {
    return process.env.OPENAI_API_KEY ?? '';
  },
  get AGENT_LLM_TIMEOUT_MS(): number {
    return Number(process.env.AGENT_LLM_TIMEOUT_MS ?? 5000);
  },
  get AGENT_LLM_MIN_CONFIDENCE(): number {
    return Number(process.env.AGENT_LLM_MIN_CONFIDENCE ?? 0.8);
  },
  get AGENT_LLM_CONTEXT_MESSAGES(): number {
    return Number(process.env.AGENT_LLM_CONTEXT_MESSAGES ?? 10);
  },

  // Agentes v1.3 — Jobs/scheduler (correio.md seção 20). Desligado por
  // default: nenhum Job roda sozinho a menos que alguém ligue
  // explicitamente — mesmo racional de AGENT_LLM_ENABLED. server.ts é o
  // único lugar que lê este flag para iniciar o setInterval; buildApp()
  // (usado pelos testes) nunca inicia o scheduler.
  get AGENT_JOBS_SCHEDULER_ENABLED(): boolean {
    return boolFlag('AGENT_JOBS_SCHEDULER_ENABLED', false);
  },
  get AGENT_JOBS_SCHEDULER_INTERVAL_MS(): number {
    return Number(process.env.AGENT_JOBS_SCHEDULER_INTERVAL_MS ?? 60000);
  },

  // Agentes v1.4 — Event Engine (correio.md seções 14/16). Mesmo racional
  // de desligado-por-default do scheduler de Jobs — server.ts é o único
  // lugar que lê AGENT_EVENTS_PROCESSOR_ENABLED, nunca buildApp()/testes.
  get AGENT_EVENTS_PROCESSOR_ENABLED(): boolean {
    return boolFlag('AGENT_EVENTS_PROCESSOR_ENABLED', false);
  },
  get AGENT_EVENTS_POLL_INTERVAL_MS(): number {
    return Number(process.env.AGENT_EVENTS_POLL_INTERVAL_MS ?? 5000);
  },
  get AGENT_EVENTS_MAX_ATTEMPTS(): number {
    return Number(process.env.AGENT_EVENTS_MAX_ATTEMPTS ?? 5);
  },
  get AGENT_EVENTS_RETRY_BASE_SECONDS(): number {
    return Number(process.env.AGENT_EVENTS_RETRY_BASE_SECONDS ?? 30);
  },
  get AGENT_EVENTS_PROCESSING_TIMEOUT_SECONDS(): number {
    return Number(process.env.AGENT_EVENTS_PROCESSING_TIMEOUT_SECONDS ?? 300);
  },

  // Agentes v1.5 — Autonomous Safety & Governance (correio.md seções
  // 5/7/8/9/27). Todos com default seguro; só o operador ligando limites
  // menores (ex.: smoke test) muda o comportamento — nunca automático.
  get AGENT_MAX_AUTONOMY_DEPTH(): number {
    return positiveIntEnv('AGENT_MAX_AUTONOMY_DEPTH', 8);
  },
  get AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN(): number {
    return positiveIntEnv('AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN', 25);
  },
  get AGENT_JOB_AUTONOMY_RATE_LIMIT(): number {
    return positiveIntEnv('AGENT_JOB_AUTONOMY_RATE_LIMIT', 20);
  },
  get AGENT_JOB_AUTONOMY_RATE_WINDOW_SECONDS(): number {
    return positiveIntEnv('AGENT_JOB_AUTONOMY_RATE_WINDOW_SECONDS', 300);
  },
  get AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD(): number {
    return positiveIntEnv('AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD', 5);
  },
  get AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS(): number {
    return positiveIntEnv('AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS', 300);
  },

  // Agentes v2.4 — Workflow Recovery (correio.md seção 4). Idade mínima
  // (em segundos) de um estado transitório (`Initiative.status='active'`
  // sem Action Plan, `agent_executive_reviews.status='draft'`,
  // `agent_strategic_memories.status='draft'`) para ser considerado
  // "stale" — nunca um workflow em andamento normal, só um claim que
  // sobreviveu ao processo que o criou. Default 900s (15min): folgado o
  // bastante para nunca colidir com o pior caso real do próprio sistema
  // (AGENT_LLM_TIMEOUT_MS=5s + polling de até 30s em qualquer claim —
  // ver `initiatives-execution-service.ts`/`reviews/review-service.ts`/
  // `memory/memory-service.ts` — então 900s tem margem de ~18x mesmo no
  // pior caso). Limite mínimo de 60s (`min=60`): nunca tão curto a ponto
  // de confundir um claim genuinamente em andamento com um órfão.
  // getter (não valor capturado no import) pelo mesmo motivo de
  // AGENT_LLM_ENABLED: os testes de `agents/recovery/*.test.ts` precisam
  // de um threshold curto, mutando `process.env` por teste, sem reiniciar
  // o processo.
  get AGENT_WORKFLOW_STALE_AFTER_SECONDS(): number {
    return positiveIntEnv('AGENT_WORKFLOW_STALE_AFTER_SECONDS', 900, 60);
  },
};
