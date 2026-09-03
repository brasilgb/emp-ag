import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyToBackend(request, `/agents/responsibilities/${id}`);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyToBackend(request, `/agents/responsibilities/${id}`);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyToBackend(request, `/agents/responsibilities/${id}`);
}
