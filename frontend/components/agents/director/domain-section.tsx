import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { formatDateTime } from "@/lib/agents/format";
import { signalDomainLabel, signalEntityHref } from "@/lib/agents/derived";
import type { OperationalSignal, SignalDomain } from "@/types/agents";

import { SignalSeverityBadge } from "../status-badge";
import { ProposeActionButton } from "./propose-action-button";

/**
 * Agentes v1.8 (correio.md seção 15) — cada seção de domínio: lista dos
 * principais sinais, com link para a entidade quando existir rota e o
 * botão de propor ação. Nunca uma mutação direta na UI.
 */
export function DomainSection({ domain, signals }: { domain: SignalDomain; signals: OperationalSignal[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          {signalDomainLabel(domain)} <span className="text-xs">({signals.length})</span>
        </h3>
      </CardHeader>
      <CardContent className="p-0">
        {signals.length === 0 ? (
          <EmptyState title="Nada precisando de atenção" className="py-8" />
        ) : (
          <ul className="divide-y">
            {signals.map((signal) => {
              const href = signalEntityHref(signal);

              return (
                <li key={signal.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SignalSeverityBadge severity={signal.severity} />
                    <span className="text-sm font-medium">{signal.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{signal.description}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{formatDateTime(signal.detectedAt)}</span>
                    <div className="flex items-center gap-3">
                      {href ? (
                        <Link href={href} className="text-xs text-primary underline underline-offset-2">
                          Abrir
                        </Link>
                      ) : null}
                      {domain !== "agents" ? <ProposeActionButton signalId={signal.id} /> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
