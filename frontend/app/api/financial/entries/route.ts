import { proxyToBackend } from "@/lib/api/proxy";

export async function GET(request: Request) {
  return proxyToBackend(request, "/financial/entries");
}

export async function POST(request: Request) {
  return proxyToBackend(request, "/financial/entries");
}
