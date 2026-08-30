"use client";

import Link from "next/link";
import { CalendarClock, User } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { StageSelect } from "@/components/crm/stage-select";
import { useAuth } from "@/lib/auth/use-auth";
import { formatCurrency, formatDate, LEAD_SOURCE_LABELS } from "@/lib/crm/format";
import type { PipelineStage, PipelineStageLead } from "@/types/crm";

export function KanbanCard({
  lead,
  stages,
  onMoveStage,
  isMoving,
}: {
  lead: PipelineStageLead;
  stages: Pick<PipelineStage, "id" | "name">[];
  onMoveStage: (stageId: number) => void;
  isMoving: boolean;
}) {
  const { can } = useAuth();

  return (
    <Card className="gap-2 py-3">
      <CardContent className="space-y-2 px-3">
        <Link href={`/leads/${lead.id}`} className="block text-sm font-medium hover:underline">
          {lead.name}
        </Link>
        {lead.companyName ? <p className="text-xs text-muted-foreground">{lead.companyName}</p> : null}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatCurrency(lead.estimatedValue)}</span>
          <span>{lead.probability}%</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <User className="size-3" />
          {lead.ownerName ?? "Sem responsável"}
        </div>

        {lead.nextActionAt ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3" />
            {formatDate(lead.nextActionAt)}
            {lead.nextActionDescription ? ` · ${lead.nextActionDescription}` : ""}
          </div>
        ) : null}

        <p className="text-[11px] text-muted-foreground">{LEAD_SOURCE_LABELS[lead.source]}</p>

        <StageSelect
          stages={stages}
          value={lead.pipelineStageId}
          onChange={onMoveStage}
          disabled={isMoving || !can("leads.update")}
        />
      </CardContent>
    </Card>
  );
}
