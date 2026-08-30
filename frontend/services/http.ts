/**
 * Cliente HTTP central usado no navegador. Toda chamada de um componente de
 * cliente passa por aqui, sempre contra rotas internas /api/* (nunca contra
 * o backend diretamente) — ver services/auth-service.ts e o restante dos
 * services/ para o motivo (CORS + cookie HttpOnly).
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  return "Erro inesperado.";
}

function extractCode(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "error" in payload) {
    const code = (payload as { error?: unknown }).error;
    if (typeof code === "string") return code;
  }

  return undefined;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiClientError(0, "Não foi possível se conectar ao servidor.");
  }

  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    throw new ApiClientError(response.status, extractMessage(payload), extractCode(payload));
  }

  return payload as T;
}

/**
 * Mensagem de erro para exibir ao usuário (ex.: em um toast). 403 é tratado
 * à parte de propósito — é sempre "sem permissão", nunca um erro genérico
 * de servidor, mesmo que o backend mande outra mensagem no corpo.
 */
export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) {
      return "Você não tem permissão para executar esta ação.";
    }
    return error.message;
  }

  return fallback;
}

export function toQueryString<T extends Record<string, string | number | boolean | undefined>>(
  params: T,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }

  const qs = query.toString();
  return qs ? `?${qs}` : "";
}
