import { proxyToBackend } from "@/lib/api/proxy";

// Agentes v3.7 (correio.md "Operational Incident Review Queue & Attention
// Management") — mesmo padrão BFF de todo o resto de `supervision-insights`
// (ver `incidents/route.ts`/`overview/route.ts`): proxy fino, nenhuma
// lógica aqui.
export async function GET(request: Request) {
  return proxyToBackend(request, "/agents/operations/supervision-insights/needs-attention");
}
