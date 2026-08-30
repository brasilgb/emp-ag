export interface ApiErrorBody {
  error?: string;
  message?: string;
}

/**
 * Erro normalizado para respostas não-2xx do backend, usado pela camada de
 * API do servidor (lib/api/client.ts). Preserva o status HTTP e o código de
 * erro retornado pelo backend para que Route Handlers e a DAL possam decidir
 * como reagir (401 → sessão inválida, 403 → sem permissão, etc.).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, body?: ApiErrorBody) {
    super(body?.message ?? "Erro ao comunicar com o servidor.");
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error;
  }
}
