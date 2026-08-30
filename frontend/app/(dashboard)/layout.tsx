import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth/dal";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Checagem "segura": confirma com o backend que a sessão ainda é válida
  // (a checagem "otimista" já aconteceu no proxy.ts, com base apenas na
  // presença do cookie).
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return <AppShell user={user}>{children}</AppShell>;
}
