import { proxyToBackend } from "@/lib/api/proxy";

export async function GET(request: Request) {
  return proxyToBackend(request, "/customer-success/accounts");
}

export async function POST(request: Request) {
  return proxyToBackend(request, "/customer-success/accounts");
}
