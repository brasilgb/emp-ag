import { proxyToBackend } from "@/lib/api/proxy";

// Agentes v4.2 (correio.md "Operational SLA Analytics & Performance
// Visibility") — mesmo padrão BFF de todo o resto de `agents/operations`:
// proxy fino (query string repassada intacta), nenhuma lógica aqui.
export async function GET(request: Request) {
  return proxyToBackend(request, "/agents/operations/sla-analytics");
}
