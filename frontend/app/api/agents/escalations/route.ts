import { proxyToBackend } from "@/lib/api/proxy";

// Agentes v2.6 (correio.md seção 19) — só GET: nenhum endpoint de
// criação livre existe no backend (a única origem real de uma
// Escalation é a integração interna com o Operational Supervisor).
export async function GET(request: Request) {
  return proxyToBackend(request, "/agents/escalations");
}
