import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ id: string; key: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, key } = await params;
  return proxyToBackend(request, `/agents/jobs/${id}/settings/${key}`);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, key } = await params;
  return proxyToBackend(request, `/agents/jobs/${id}/settings/${key}`);
}
