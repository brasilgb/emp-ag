import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ key: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const { key } = await params;
  return proxyToBackend(request, `/agents/settings/${key}`);
}

export async function PATCH(request: Request, { params }: Params) {
  const { key } = await params;
  return proxyToBackend(request, `/agents/settings/${key}`);
}

export async function DELETE(request: Request, { params }: Params) {
  const { key } = await params;
  return proxyToBackend(request, `/agents/settings/${key}`);
}
