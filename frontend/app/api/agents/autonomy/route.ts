import { proxyToBackend } from "@/lib/api/proxy";

export async function GET(request: Request) {
  return proxyToBackend(request, "/agents/autonomy");
}

export async function PATCH(request: Request) {
  return proxyToBackend(request, "/agents/autonomy");
}
