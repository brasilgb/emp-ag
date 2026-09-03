"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/use-auth";

const ITEMS = [
  { href: "/agents", label: "Agentes", permission: "agents.read" },
  { href: "/agents/director", label: "Mesa do Diretor", permission: "agents.read" },
  { href: "/agents/director/memories", label: "Aprendizados", permission: "agents.read" },
  { href: "/agents/chat", label: "Chat", permission: "agents.use" },
  { href: "/agents/plans", label: "Planos de Ação", permission: "agents.plan.read" },
  { href: "/agents/jobs", label: "Jobs", permission: "agents.jobs.read" },
  { href: "/agents/events", label: "Events", permission: "agents.events.read" },
  { href: "/agents/event-rules", label: "Event Rules", permission: "agents.event_rules.read" },
  { href: "/agents/approvals", label: "Aprovações", permission: "agents.approve" },
  { href: "/agents/executions", label: "Execuções", permission: "agent.executions.read" },
  { href: "/agents/interpreter", label: "LLM Interpreter", permission: "agent.executions.read" },
  { href: "/agents/operations", label: "Operações", permission: "agents.operations.read" },
  { href: "/agents/incidents", label: "Incidentes", permission: "agents.incidents.read" },
  { href: "/agents/audit", label: "Auditoria", permission: "agents.audit.read" },
  { href: "/agents/settings", label: "Configurações", permission: "agents.settings.read" },
] as const;

// Navegação interna do módulo Agentes (seções 38-41) — mesmo princípio de
// UX-only da Sidebar: um item escondido aqui continua acessível por URL
// direta, quem barra de verdade é o backend.
export function AgentsSubNav() {
  const pathname = usePathname();
  const { can } = useAuth();

  const visibleItems = ITEMS.filter((item) => can(item.permission));

  return (
    <nav className="flex flex-wrap gap-1 border-b pb-2">
      {visibleItems.map((item) => {
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
