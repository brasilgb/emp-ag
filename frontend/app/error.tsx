"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/states/error-state";

/**
 * Tratamento global de erros para toda a árvore de rotas dentro do layout
 * raiz (login + painel). Erros que ocorram no próprio layout raiz são
 * cobertos por app/global-error.tsx.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <ErrorState
        title="Algo deu errado"
        description="Ocorreu um erro inesperado na aplicação. Tente novamente."
        onRetry={reset}
      />
    </div>
  );
}
