import type { FastifyInstance } from 'fastify';
import { desc, eq, isNotNull, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentInterpretations, agentMessages, users } from '../../db/schema/index.js';
import { INTERPRETATION_ERROR_TYPES } from '../../agents/llm/error-classification.js';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { interpretationIdParamSchema, interpretationReviewSchema } from '../../schemas/agents.js';

import { badRequest, currentUserId, notFound } from './helpers.js';

// Seção 30/30-bis: as quatro categorias que importam para quem está
// avaliando o LLM Interpreter, derivadas só de deterministicTool/llmTool
// (nunca do booleano `matched`, que existe por razões históricas de
// armazenamento — ver computeMatched() em llm/shadow.ts). Só se aplica a
// linhas comparáveis (`matched IS NOT NULL`, i.e. o LLM chegou a dar uma
// resposta estruturada); timeout/provider_error/invalid_output ficam de
// fora tanto daqui quanto do `WHERE` que alimenta esta função — nunca
// viram nenhuma das quatro.
//
// - match: os dois concordam em uma tool real.
// - deterministic_unknown_llm_recognized: determinístico não reconheceu
//   nada, mas o LLM achou uma tool válida — o tipo de divergência mais
//   interessante para validar antes de ativar fallback (seção 29), nunca
//   deve ser apresentado como um mismatch qualquer.
// - mismatch: os dois reconheceram algo, mas coisas diferentes — ou só um
//   dos dois reconheceu algo (o outro ficando null) e não é o caso acima.
// - both_unknown: nenhum dos dois reconheceu nada. NÃO é um match (apesar
//   de "concordarem" em não saber) nem um mismatch — fica de fora do
//   cálculo de match rate (ver a query de stats abaixo e o
//   computeMatched() corrigido em llm/shadow.ts).
export type InterpretationCategory = 'match' | 'mismatch' | 'deterministic_unknown_llm_recognized' | 'both_unknown';

export function classifyInterpretation(row: {
  deterministicTool: string | null;
  llmTool: string | null;
}): InterpretationCategory {
  const { deterministicTool, llmTool } = row;

  if (deterministicTool === null && llmTool === null) {
    return 'both_unknown';
  }

  if (deterministicTool === null && llmTool !== null) {
    return 'deterministic_unknown_llm_recognized';
  }

  if (deterministicTool !== null && llmTool === deterministicTool) {
    return 'match';
  }

  return 'mismatch';
}

// Espelha classifyInterpretation() em SQL, para agregar matches/mismatches/
// bothUnknown via FILTER sem carregar todas as interpretações em memória
// (mesmo racional do comentário de interpreterRoutes abaixo). Qualquer
// mudança na função TS acima precisa ser replicada aqui.
const CATEGORY_CASE = sql`
  case
    when ${agentInterpretations.deterministicTool} is null and ${agentInterpretations.llmTool} is null
      then 'both_unknown'
    when ${agentInterpretations.deterministicTool} is null and ${agentInterpretations.llmTool} is not null
      then 'deterministic_unknown_llm_recognized'
    when ${agentInterpretations.deterministicTool} is not null
      and ${agentInterpretations.llmTool} = ${agentInterpretations.deterministicTool}
      then 'match'
    else 'mismatch'
  end
`;

export async function interpreterRoutes(app: FastifyInstance) {
  app.get(
    '/interpreter/stats',
    {
      preHandler: [authenticate, requirePermission('agent.executions.read')],
    },
    async () => {
      const [counts] = await db
        .select({
          total: sql<number>`count(*)`,
          // matches/mismatches usam CATEGORY_CASE (deterministic_tool x
          // llm_tool), não o booleano `matched` bruto — both_unknown fica
          // de fora dos dois, então nunca entra no denominador do match
          // rate abaixo (correção pedida: both_unknown não é match nem
          // mismatch).
          matches: sql<number>`count(*) filter (where ${agentInterpretations.matched} is not null and (${CATEGORY_CASE}) = 'match')`,
          mismatches: sql<number>`count(*) filter (where ${agentInterpretations.matched} is not null and (${CATEGORY_CASE}) = 'mismatch')`,
          bothUnknown: sql<number>`count(*) filter (where ${agentInterpretations.matched} is not null and (${CATEGORY_CASE}) = 'both_unknown')`,
          deterministicUnknownLlmRecognized: sql<number>`count(*) filter (where ${agentInterpretations.matched} is not null and (${CATEGORY_CASE}) = 'deterministic_unknown_llm_recognized')`,
          averageConfidence: sql<string | null>`avg(${agentInterpretations.llmConfidence}) filter (
            where ${agentInterpretations.llmConfidence} is not null
          )`,
          averageLatencyMs: sql<string | null>`avg(${agentInterpretations.latencyMs}) filter (
            where ${agentInterpretations.latencyMs} is not null
          )`,
          timeouts: sql<number>`count(*) filter (where ${agentInterpretations.error} ->> 'type' = 'timeout')`,
          // "Erros" continua significando falha real (infra/output/tool
          // inválidos) — low_confidence e clarification são classificados
          // no mesmo campo `error` (seção 30-bis) mas são resultados
          // válidos/esperados do modelo, não falhas, então ficam fora
          // desta contagem (aparecem só em errorsByType).
          errors: sql<number>`count(*) filter (
            where ${agentInterpretations.error} is not null
              and (${agentInterpretations.error} ->> 'type') not in ('low_confidence', 'clarification')
          )`,
          // Seção 30 — feedback humano é só avaliação, nunca conta como
          // "erro" de infraestrutura nem entra em matches/mismatches.
          reviewed: sql<number>`count(*) filter (where ${agentInterpretations.humanVerdict} is not null)`,
          humanCorrect: sql<number>`count(*) filter (where ${agentInterpretations.humanVerdict} = 'correct')`,
          humanIncorrect: sql<number>`count(*) filter (where ${agentInterpretations.humanVerdict} = 'incorrect')`,
          ...Object.fromEntries(
            INTERPRETATION_ERROR_TYPES.map((type) => [
              `errorType_${type}`,
              sql<number>`count(*) filter (where ${agentInterpretations.error} ->> 'type' = ${type})`,
            ]),
          ),
        })
        .from(agentInterpretations);

      const comparable = Number(counts.matches) + Number(counts.mismatches);
      const reviewed = Number(counts.reviewed);
      const humanCorrect = Number(counts.humanCorrect);
      const humanIncorrect = Number(counts.humanIncorrect);

      const errorsByType = Object.fromEntries(
        INTERPRETATION_ERROR_TYPES.map((type) => [type, Number(counts[`errorType_${type}` as keyof typeof counts])]),
      ) as Record<(typeof INTERPRETATION_ERROR_TYPES)[number], number>;

      const recentRows = await db
        .select({
          id: agentInterpretations.id,
          conversationId: agentInterpretations.conversationId,
          userMessage: agentMessages.content,
          deterministicAgent: agentInterpretations.deterministicAgent,
          deterministicTool: agentInterpretations.deterministicTool,
          llmAgent: agentInterpretations.llmAgent,
          llmTool: agentInterpretations.llmTool,
          llmConfidence: agentInterpretations.llmConfidence,
          matched: agentInterpretations.matched,
          mode: agentInterpretations.mode,
          // Já sanitizado na origem (llm/error-classification.ts, seção
          // 30-bis) antes de chegar em agent_interpretations — nunca API
          // key/headers/credenciais, e é exatamente o que vai para o
          // frontend sem transformação adicional.
          error: agentInterpretations.error,
          createdAt: agentInterpretations.createdAt,
          humanVerdict: agentInterpretations.humanVerdict,
          reviewedByUserId: agentInterpretations.reviewedByUserId,
          reviewedByUserName: users.name,
          reviewedAt: agentInterpretations.reviewedAt,
        })
        .from(agentInterpretations)
        .leftJoin(agentMessages, eq(agentInterpretations.messageId, agentMessages.id))
        .leftJoin(users, eq(agentInterpretations.reviewedByUserId, users.id))
        // Só interpretações comparáveis (o LLM chegou a responder algo
        // estruturado) — timeouts e erros de provider não têm categoria e
        // ficam fora desta lista (continuam contados em
        // `timeouts`/`errors`/`errorsByType` acima).
        .where(isNotNull(agentInterpretations.matched))
        .orderBy(desc(agentInterpretations.createdAt))
        .limit(20);

      const recentInterpretations = recentRows.map((row) => ({
        ...row,
        category: classifyInterpretation(row),
      }));

      return {
        llmEnabled: env.AGENT_LLM_ENABLED,
        shadowMode: env.AGENT_LLM_SHADOW_MODE,
        provider: env.AGENT_LLM_PROVIDER,
        model: env.AGENT_LLM_MODEL,
        total: Number(counts.total),
        matches: Number(counts.matches),
        mismatches: Number(counts.mismatches),
        // both_unknown nunca entra aqui — nem no numerador, nem no
        // denominador (correção pedida: "não deve entrar no cálculo de
        // match rate").
        bothUnknown: Number(counts.bothUnknown),
        deterministicUnknownLlmRecognized: Number(counts.deterministicUnknownLlmRecognized),
        matchRate: comparable > 0 ? Number((Number(counts.matches) / comparable).toFixed(4)) : null,
        averageConfidence: counts.averageConfidence !== null ? Number(Number(counts.averageConfidence).toFixed(3)) : null,
        averageLatencyMs: counts.averageLatencyMs !== null ? Math.round(Number(counts.averageLatencyMs)) : null,
        timeouts: Number(counts.timeouts),
        errors: Number(counts.errors),
        errorsByType,
        reviewed,
        humanCorrect,
        humanIncorrect,
        humanAccuracy: reviewed > 0 ? Number((humanCorrect / reviewed).toFixed(4)) : null,
        recentInterpretations,
      };
    },
  );

  // Seção 30: feedback humano simples sobre uma interpretação já
  // registrada — só grava human_verdict/reviewed_by_user_id/reviewed_at.
  // Nunca reexecuta o interpreter, nunca toca prompt/router/model (seção
  // 31): é avaliação, não retreinamento.
  app.post(
    '/interpreter/:id/review',
    {
      preHandler: [authenticate, requirePermission('agent.executions.manage')],
    },
    async (request, reply) => {
      const params = interpretationIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = interpretationReviewSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const [updated] = await db
        .update(agentInterpretations)
        .set({
          humanVerdict: body.data.verdict,
          reviewedByUserId: userId,
          reviewedAt: new Date(),
        })
        .where(eq(agentInterpretations.id, params.data.id))
        .returning();

      if (!updated) {
        return notFound(reply, 'Interpretação não encontrada.');
      }

      return {
        data: {
          id: updated.id,
          humanVerdict: updated.humanVerdict,
          reviewedByUserId: updated.reviewedByUserId,
          reviewedAt: updated.reviewedAt,
        },
      };
    },
  );
}
