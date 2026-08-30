"use client";

import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/types/auth";

import { UserMenu } from "./user-menu";

export function Header({
  user,
  onOpenMobileNav,
}: {
  user: AuthUser;
  onOpenMobileNav: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMobileNav}
        aria-label="Abrir menu de navegação"
      >
        <Menu className="size-5" />
      </Button>

      <div className="flex-1" />

      <UserMenu user={user} />
    </header>
  );
}
