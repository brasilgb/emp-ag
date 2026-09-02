import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyToBackend(request, `/agents/jobs/${id}/autonomy`);
}
