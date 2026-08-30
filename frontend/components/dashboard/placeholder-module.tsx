import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

interface PlaceholderModuleProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Stub visual para módulos ainda não implementados (CRM, Clientes, Leads,
 * Projetos, Financeiro, Suporte, Agentes). Garante que a navegação e o
 * layout do módulo já existam, sem antecipar endpoints ou regras de negócio
 * que ainda não existem no backend.
 */
export function PlaceholderModule({ title, description, icon: Icon }: PlaceholderModuleProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Icon className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Módulo em construção</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Esta área já está navegável, mas os dados e as funcionalidades
              completas serão implementados nas próximas etapas.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
