import { proxyToBackend } from "@/lib/api/proxy";

// Agentes v3.9 (correio.md "Operational Ownership Workload & Human
// Coordination Views") — mesmo padrão BFF de todo o resto de
// `supervision-insights`: proxy fino, nenhuma lógica aqui.
export async function GET(request: Request) {
  return proxyToBackend(request, "/agents/operations/supervision-insights/ownership-workload");
}
