import { proxyToBackend } from "@/lib/api/proxy";

export async function POST(request: Request) {
  return proxyToBackend(request, "/agents/execute");
}
