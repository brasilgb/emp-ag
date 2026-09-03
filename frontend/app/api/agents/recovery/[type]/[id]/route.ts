import { proxyToBackend } from "@/lib/api/proxy";

interface Params {
  params: Promise<{ type: string; id: string }>;
}

export async function POST(request: Request, { params }: Params) {
  const { type, id } = await params;
  return proxyToBackend(request, `/agents/recovery/${type}/${id}`);
}
