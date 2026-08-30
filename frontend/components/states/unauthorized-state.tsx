import { LockKeyhole } from "lucide-react";

import { EmptyState } from "./empty-state";

export function UnauthorizedState() {
  return (
    <EmptyState
      icon={LockKeyhole}
      title="Sessão expirada"
      description="Sua sessão não é válida ou expirou. Faça login novamente para continuar."
    />
  );
}
