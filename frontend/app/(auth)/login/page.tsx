import type { Metadata } from "next";

import { LoginForm } from "@/components/forms/login-form";

export const metadata: Metadata = {
  title: "Entrar",
};

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-1 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          A
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Acessar o painel</h1>
        <p className="text-sm text-muted-foreground">
          Entre com suas credenciais para continuar.
        </p>
      </div>

      <LoginForm />
    </div>
  );
}
