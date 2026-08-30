import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ id: string; taskId: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const { id, taskId } = await params;
  return proxyToBackend(request, `/projects/${id}/tasks/${taskId}/history`);
}
