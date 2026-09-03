import type { agentDirectorGoals } from '../../../db/schema/index.js';
import type { ExecutiveReviewRow } from '../reviews/review-service.js';
import type { InitiativeRow } from '../goals/initiatives-service.js';

export type GoalRow = typeof agentDirectorGoals.$inferSelect;

/**
 * Agentes v2.3 (correio.md seção 5) — evidência determinística da
 * memória, montada pelo BACKEND a partir da Executive Review/Goal/
 * Initiative REAIS, nunca pelo LLM. É o objeto persistido verbatim em
 * `agent_strategic_memories.evidence` e também o que vira o bloco
 * "CURRENT EVIDENCE" do prompt do extractor (`prompt.ts`) — o LLM só
 * pode ler isto, nunca escrevê-lo.
 */
export interface StrategicMemoryEvidence {
  goal: { id: number; title: string; domain: string };
  initiative: { id: number; title: string; rationale: string };
  review: {
    id: number;
    outcome: string | null;
    summary: string | null;
    assessment: string | null;
    expectedResult: string | null;
    actualResult: string | null;
    recommendationType: string | null;
  };
}

export function buildStrategicMemoryEvidence(params: { goal: GoalRow; initiative: InitiativeRow; review: ExecutiveReviewRow }): StrategicMemoryEvidence {
  const { goal, initiative, review } = params;

  return {
    goal: { id: goal.id, title: goal.title, domain: goal.domain },
    initiative: { id: initiative.id, title: initiative.title, rationale: initiative.rationale },
    review: {
      id: review.id,
      outcome: review.outcome,
      summary: review.summary,
      assessment: review.assessment,
      expectedResult: review.expectedResult,
      actualResult: review.actualResult,
      recommendationType: review.recommendationType,
    },
  };
}

/** Formato mínimo e seguro de uma memória usada como contexto histórico (nunca a evidência bruta completa de outra review — seção 9/11). */
export interface RelevantMemorySummary {
  id: number;
  memoryType: string;
  domain: string;
  title: string;
  lesson: string;
  confidence: number | null;
  importance: string | null;
  createdAt: string;
}
