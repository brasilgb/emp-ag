import "server-only";

/**
 * URL base do backend. Usada apenas no servidor Next.js (Route Handlers,
 * Server Components, camada de sessão) — o navegador nunca chama o backend
 * diretamente, todas as requisições passam pelas rotas internas em /api/*.
 * Isso evita problemas de CORS (o backend Fastify não expõe cabeçalhos CORS)
 * e mantém o JWT fora do JavaScript do cliente.
 *
 * Mesmo sendo de uso exclusivamente server-side, a variável usa o prefixo
 * NEXT_PUBLIC_ propositalmente, conforme solicitado. Ver README/entrega para
 * detalhes dessa decisão.
 */
export function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;

  if (!url) {
    throw new Error(
      "Variável de ambiente NEXT_PUBLIC_API_URL não configurada.",
    );
  }

  return url.replace(/\/+$/, "");
}
