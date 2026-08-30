import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ id: string; milestoneId: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, milestoneId } = await params;
  return proxyToBackend(request, `/projects/${id}/milestones/${milestoneId}`);
}
