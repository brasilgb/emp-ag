import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ auditLogId: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const { auditLogId } = await params;
  return proxyToBackend(request, `/agents/operations/supervision-insights/incidents/${auditLogId}/review`);
}

export async function PATCH(request: Request, { params }: Params) {
  const { auditLogId } = await params;
  return proxyToBackend(request, `/agents/operations/supervision-insights/incidents/${auditLogId}/review`);
}
