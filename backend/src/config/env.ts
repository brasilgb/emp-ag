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
};
