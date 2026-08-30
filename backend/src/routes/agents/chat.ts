import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { TemplateResponseComposer } from '../../agents/composer/template-composer.js';
import { DeterministicInterpreter } from '../../agents/interpreter/deterministic-interpreter.js';
import { executeTool } from '../../agents/execution/pipeline.js';
import { runShadowOrFallback } from '../../agents/llm/shadow.js';
import { DeterministicRouter } from '../../agents/router/deterministic-router.js';
import { agentRateLimit } from '../../agents/security/rate-limit.js';
import { db } from '../../db/index.js';
import { agentConversations, agentMessages, agents } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import { chatSchema } from '../../schemas/agents.js';

import { badRequest, currentUserId, notFound } from './helpers.js';

const router = new DeterministicRouter();
const interpreter = new DeterministicInterpreter();
const composer = new TemplateResponseComposer();

// Seção 35 (v1): mensagem fixa quando nem o determinístico nem (em modo
// fallback) o LLM reconhecem a intenção — nunca inventar uma resposta.
const UNKNOWN_INTENT_MESSAGE =
  'Não consegui identificar com segurança qual área deve tratar esta solicitação.';

function draftTitle(message: string): string {
  return message.length > 80 ? `${message.slice(0, 77)}...` : message;
}

async function getAgentBySlug(slug: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  return agent ?? null;
}

export async function chatRoutes(app: FastifyInstance) {
  app.post(
    '/chat',
    {
      preHandler: [authenticate, agentRateLimit('chat'), requirePermission('agents.use')],
    },
    async (request, reply) => {
      const body = chatSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      // Resolve/cria a conversa (seção 33, passo 1).
      let conversation: typeof agentConversations.$inferSelect;

      if (body.data.conversationId) {
        [conversation] = await db
          .select()
          .from(agentConversations)
          .where(eq(agentConversations.id, body.data.conversationId))
          .limit(1);

        if (!conversation || conversation.userId !== userId) {
          return notFound(reply, 'Conversa não encontrada.');
        }
      } else {
        [conversation] = await db
          .insert(agentConversations)
          .values({ userId, title: draftTitle(body.data.message) })
          .returning();
      }

      // Salva a mensagem do usuário (seção 33, passo 2).
      const [userMessageRow] = await db
        .insert(agentMessages)
        .values({
          conversationId: conversation.id,
          role: 'user',
          content: body.data.message,
        })
        .returning();

      // Router determinístico: intenção → departamento/agente (seção 33,
      // passo 3; seção 19 da v1).
      const route = router.route(body.data.message);
      const routedAgent = route ? await getAgentBySlug(route.agentSlug) : null;

      // Interpreter determinístico: dentro do agente já resolvido, decide
      // a tool + params (2º nível, ver agents/interpreter).
      const interpretation =
        route && routedAgent ? interpreter.interpret(body.data.message, route.agentSlug) : null;

      const deterministicAgent = route?.agentSlug ?? null;
      const deterministicTool = interpretation?.toolHandler ?? null;

      // v1.1: LLM em shadow (mede, nunca decide) ou fallback (só quando o
      // determinístico não reconheceu — seção 15) — no-op se
      // AGENT_LLM_ENABLED=false, comportamento idêntico à v1.
      const llmOutcome = await runShadowOrFallback({
        conversationId: conversation.id,
        messageId: userMessageRow.id,
        userMessage: body.data.message,
        userId,
        deterministicAgent,
        deterministicTool,
      });

      async function saveAssistantMessage(params: {
        agentId: number | null;
        content: string;
        metadata?: Record<string, unknown>;
      }) {
        await db.insert(agentMessages).values({
          conversationId: conversation.id,
          agentId: params.agentId,
          role: 'assistant',
          content: params.content,
          metadata: params.metadata,
        });

        await db
          .update(agentConversations)
          .set({ updatedAt: new Date() })
          .where(eq(agentConversations.id, conversation.id));
      }

      // Caminho determinístico reconheceu — sempre vence, mesmo se o LLM
      // (shadow ou fallback) discordar (seção 12/15).
      if (deterministicTool && routedAgent && interpretation) {
        const outcome = await executeTool({
          userId,
          agentSlug: route!.agentSlug,
          toolHandler: interpretation.toolHandler,
          input: interpretation.input,
          conversationId: conversation.id,
        });

        const composed = composer.compose({
          agentName: routedAgent.name,
          toolHandler: interpretation.toolHandler,
          result:
            outcome.status === 'completed'
              ? outcome.result!
              : {
                  success: false,
                  summary:
                    outcome.status === 'waiting_approval'
                      ? 'Esta ação exige aprovação humana antes de ser executada. Solicitação registrada.'
                      : (outcome.error?.message ?? 'Não foi possível concluir a solicitação.'),
                  data: null,
                },
        });

        await saveAssistantMessage({
          agentId: routedAgent.id,
          content: composed,
          metadata: { toolHandler: interpretation.toolHandler, executionId: outcome.executionId, source: 'deterministic' },
        });

        return reply.code(200).send({
          conversationId: conversation.id,
          agent: { slug: routedAgent.slug, name: routedAgent.name },
          tool: interpretation.toolHandler,
          message: composed,
          data: outcome.status === 'completed' ? outcome.result!.data : null,
          executionId: outcome.executionId,
          status: outcome.status,
        });
      }

      // Determinístico não reconheceu. Em modo fallback, o LLM pode ter
      // executado uma tool ou pedido esclarecimento (seção 14/17).
      if (llmOutcome.fallbackExecution) {
        const execution = llmOutcome.fallbackExecution;
        const llmAgentRow = llmOutcome.llm?.agent ? await getAgentBySlug(llmOutcome.llm.agent) : null;
        const agentName = llmAgentRow?.name ?? llmOutcome.llm?.agent ?? 'Agente';

        const composed = composer.compose({
          agentName,
          toolHandler: llmOutcome.llm!.tool!,
          result:
            execution.status === 'completed'
              ? execution.result!
              : {
                  success: false,
                  summary:
                    execution.status === 'waiting_approval'
                      ? 'Esta ação exige aprovação humana antes de ser executada. Solicitação registrada.'
                      : (execution.error?.message ?? 'Não foi possível concluir a solicitação.'),
                  data: null,
                },
        });

        await saveAssistantMessage({
          agentId: llmAgentRow?.id ?? null,
          content: composed,
          metadata: {
            toolHandler: llmOutcome.llm!.tool,
            executionId: execution.executionId,
            source: 'llm_fallback',
          },
        });

        return reply.code(200).send({
          conversationId: conversation.id,
          agent: llmAgentRow ? { slug: llmAgentRow.slug, name: llmAgentRow.name } : null,
          tool: llmOutcome.llm!.tool,
          message: composed,
          data: execution.status === 'completed' ? execution.result!.data : null,
          executionId: execution.executionId,
          status: execution.status,
        });
      }

      if (llmOutcome.fallbackClarification) {
        await saveAssistantMessage({
          agentId: null,
          content: llmOutcome.fallbackClarification,
          metadata: { source: 'llm_fallback_clarification' },
        });

        return reply.code(200).send({
          conversationId: conversation.id,
          agent: null,
          tool: null,
          message: llmOutcome.fallbackClarification,
          data: null,
          clarificationRequired: true,
        });
      }

      // Nem determinístico nem (se em fallback) o LLM reconheceram —
      // resposta fixa, nunca inventada (seção 35).
      await saveAssistantMessage({
        agentId: routedAgent?.id ?? null,
        content: UNKNOWN_INTENT_MESSAGE,
        metadata: { source: 'unknown' },
      });

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'agent.chat.unknown_intent',
        metadata: { conversationId: conversation.id, message: body.data.message },
      });

      return reply.code(200).send({
        conversationId: conversation.id,
        agent: routedAgent ? { slug: routedAgent.slug, name: routedAgent.name } : null,
        tool: null,
        message: UNKNOWN_INTENT_MESSAGE,
        data: null,
      });
    },
  );
}
