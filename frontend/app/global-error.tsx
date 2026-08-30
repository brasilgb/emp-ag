"use client";

import { useEffect } from "react";

// Cobre erros que aconteçam no próprio layout raiz (app/layout.tsx), onde
// app/error.tsx não se aplica. Como substitui o layout raiz inteiro, precisa
// declarar <html>/<body> e evita depender de globals.css — por isso usa
// estilos inline, garantindo que o fallback sempre renderize corretamente.
export default function GlobalError({
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
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafafa", color: "#171717" }}>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 360, textAlign: "center" }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Erro inesperado</h1>
            <p style={{ fontSize: 14, color: "#525252", marginBottom: 16 }}>
              A aplicação encontrou um erro crítico. Tente recarregar a página.
            </p>
            <button
              onClick={reset}
              style={{
                height: 36,
                padding: "0 16px",
                borderRadius: 8,
                border: "none",
                background: "#171717",
                color: "#fff",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Recarregar
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
