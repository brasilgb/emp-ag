import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ auditLogId: string }>;
}

// Agentes v3.8 (correio.md "Operational Incident Ownership &
// Assignment") — mesmo padrão BFF de `review/route.ts` (v3.6): proxy
// fino, nenhuma lógica aqui. PATCH cobre assign/reassign; DELETE cobre
// unassign.
export async function GET(request: Request, { params }: Params) {
  const { auditLogId } = await params;
  return proxyToBackend(request, `/agents/operations/supervision-insights/incidents/${auditLogId}/assignment`);
}

export async function PATCH(request: Request, { params }: Params) {
  const { auditLogId } = await params;
  return proxyToBackend(request, `/agents/operations/supervision-insights/incidents/${auditLogId}/assignment`);
}

export async function DELETE(request: Request, { params }: Params) {
  const { auditLogId } = await params;
  return proxyToBackend(request, `/agents/operations/supervision-insights/incidents/${auditLogId}/assignment`);
}
