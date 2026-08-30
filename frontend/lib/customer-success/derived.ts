/**
 * "Follow-up vencido" é sempre derivado (next_contact_at no passado e a
 * conta não está inativa) — nunca um estado persistido, mesma filosofia de
 * isOverdue em Suporte/Financeiro.
 */
export function isFollowUpDue(
  account: { nextContactAt: string | null; status: string },
  now: Date = new Date(),
): boolean {
  if (!account.nextContactAt || account.status === "inactive") return false;

  const dueAt = new Date(account.nextContactAt);
  if (Number.isNaN(dueAt.getTime())) return false;

  return dueAt.getTime() <= now.getTime();
}

/**
 * Faixas visuais do health score (0-100) — só para exibição (cor/label),
 * nunca reinterpreta o valor manual armazenado.
 */
export type HealthTier = "healthy" | "neutral" | "critical";

export function healthTier(healthScore: number): HealthTier {
  if (healthScore >= 70) return "healthy";
  if (healthScore >= 40) return "neutral";
  return "critical";
}
