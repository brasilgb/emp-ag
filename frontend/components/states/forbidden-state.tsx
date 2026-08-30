import { ShieldAlert } from "lucide-react";

import { EmptyState } from "./empty-state";

export function ForbiddenState() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Acesso não permitido"
      description="Seu perfil não possui permissão para acessar este recurso."
    />
  );
}
