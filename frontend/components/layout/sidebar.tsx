"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/use-auth";

import { NAV_ITEMS } from "./nav-items";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can, canAny } = useAuth();

  // Só filtra o que aparece na sidebar — é UX, não segurança. Um item sem
  // `permission` é sempre exibido; a rota continua acessível por URL direta
  // mesmo escondida aqui (quem barra de verdade é o backend).
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.permission) return true;
    return Array.isArray(item.permission) ? canAny(item.permission) : can(item.permission);
  });

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-background">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-5">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
          A
        </div>
        <span className="text-sm font-semibold tracking-tight">Agência</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {visibleItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
