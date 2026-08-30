"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { WifiOff } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema, type LoginInput } from "@/lib/validation/login-schema";
import { ApiClientError, login } from "@/services/auth-service";

type FormStatus = "idle" | "invalid_credentials" | "connection_error";

export function LoginForm() {
  const router = useRouter();
  const [status, setStatus] = useState<FormStatus>("idle");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    setStatus("idle");

    try {
      await login(values);
      // Recarrega os Server Components (layout do dashboard) para que o
      // cookie de sessão recém-criado seja lido no próximo request.
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setStatus("invalid_credentials");
        return;
      }

      setStatus("connection_error");
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {status === "invalid_credentials" ? (
            <Alert variant="destructive">
              <AlertTitle>Credenciais inválidas</AlertTitle>
              <AlertDescription>
                Verifique seu e-mail e senha e tente novamente.
              </AlertDescription>
            </Alert>
          ) : null}

          {status === "connection_error" ? (
            <Alert variant="destructive">
              <WifiOff />
              <AlertTitle>Falha de conexão</AlertTitle>
              <AlertDescription>
                Não foi possível falar com o servidor. Verifique sua conexão e
                tente novamente.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="voce@empresa.com"
              aria-invalid={!!errors.email}
              disabled={isSubmitting}
              {...register("email")}
            />
            {errors.email ? (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              disabled={isSubmitting}
              {...register("password")}
            />
            {errors.password ? (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
