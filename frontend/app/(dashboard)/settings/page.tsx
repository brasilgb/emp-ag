import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getCurrentUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Configurações" };

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  // O layout do grupo (dashboard) já garante que existe uma sessão válida
  // antes de renderizar esta página; getCurrentUser() é memoizado via
  // React.cache, então esta chamada não gera uma segunda requisição ao
  // backend.
  const user = await getCurrentUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">Informações da sua conta.</p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>Dados da sessão autenticada no backend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <InfoRow label="Nome" value={user?.name ?? "--"} />
          <Separator />
          <InfoRow label="E-mail" value={user?.email ?? "--"} />
          <Separator />
          <InfoRow label="Papel" value={user?.role.name ?? "--"} />
        </CardContent>
      </Card>
    </div>
  );
}
