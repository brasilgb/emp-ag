import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyToBackend(request, `/crm/clients/${id}/contacts`);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyToBackend(request, `/crm/clients/${id}/contacts`);
}
