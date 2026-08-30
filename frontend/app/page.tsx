import { redirect } from "next/navigation";

// O proxy (proxy.ts) já redireciona usuários sem sessão para /login antes
// de a requisição chegar aqui — esta rota só é alcançada por quem já está
// autenticado, então basta encaminhar para o painel.
export default function RootPage() {
  redirect("/dashboard");
}
