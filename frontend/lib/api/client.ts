import "server-only";

import { getApiBaseUrl } from "./config";
import { ApiError, type ApiErrorBody } from "./errors";

interface RequestOptions extends Omit<RequestInit, "body"> {
  token?: string;
  body?: unknown;
}

/**
 * Camada central de acesso ao backend. Responsável por montar a URL a
 * partir de NEXT_PUBLIC_API_URL, anexar o header Authorization quando um
 * token é informado, serializar/parsear JSON e normalizar erros em
 * `ApiError`. Nenhum componente ou Route Handler deve chamar `fetch`
 * diretamente contra o backend — sempre passar por `apiClient`.
 */
async function request<T>(
  path: string,
  { token, body, headers, ...init }: RequestOptions = {},
): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;

  const response = await fetch(url, {
    ...init,
    method: init.method ?? (body !== undefined ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // As respostas do backend refletem estado de sessão/usuário; nunca
    // devem ser cacheadas pelo Next.js.
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => undefined)
    : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, payload as ApiErrorBody);
  }

  return payload as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
};
