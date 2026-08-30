/** Diretório mínimo de usuários (GET /api/users) — usado só para popular
 * seletores de responsável/atribuído. Nunca inclui dados sensíveis. */
export interface DirectoryUser {
  id: number;
  name: string;
  email: string;
  role: string;
}
