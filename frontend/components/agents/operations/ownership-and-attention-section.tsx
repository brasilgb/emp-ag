"use client";

import { useState } from "react";

import { AttentionQueueSection } from "./attention-queue-section";
import { OwnershipWorkloadSection } from "./ownership-workload-section";

/**
 * Agentes v3.9 (correio.md "Operational Ownership Workload & Human
 * Coordination Views", seção 7) — dono do único estado de filtro de
 * responsável compartilhado entre "Ownership" e "Needs Attention": clicar
 * num responsável na tabela de workload aplica o MESMO filtro
 * `assigneeUserId` já usado pela fila (nunca uma segunda listagem
 * paralela de incidentes). `page.tsx` é Server Component — este wrapper
 * client-side é o que permite as duas seções compartilharem estado.
 */
export function OwnershipAndAttentionSection() {
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  return (
    <div className="space-y-4">
      <OwnershipWorkloadSection onSelectAssignee={(userId) => setAssigneeFilter(String(userId))} />
      <AttentionQueueSection assigneeFilter={assigneeFilter} onAssigneeFilterChange={setAssigneeFilter} />
    </div>
  );
}
