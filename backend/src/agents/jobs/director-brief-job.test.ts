import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentActionPlanItems, agentJobs, agents, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../llm/factory.js';
import type { LLMProvider, LLMResponse } from '../llm/types.js';
import { registerAllTools } from '../tools/index.js';

import { DIRECTOR_DAILY_REVIEW_OBJECTIVE } from '../director/workflows/catalog.js';
import { runAgentJob } from './job-runner.js';

/*
 * Agentes v1.8 (correio.md secao 11/23) - "um Job recorrente deve
 * conseguir gerar o briefing usando a infraestrutura existente de
 * Jobs/Runs". Nenhum mecanismo novo: um Job comum (agent_jobs), com o
 * objetivo sugerido pelo correio.md, cujo Planner (mockado aqui, real em
 * producao com AGENT_LLM_ENABLED=true) escolhe a tool
 * director.generate_daily_brief - a coleta em si continua 100%
 * deterministica (agents/director/operations-service.ts).
 */
function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

describe('Agentes v1.8 - Job recorrente do Diretor (briefing via Jobs/Runs)', () => {
  registerAllTools();
  const runId = Date.now();

  let ceoUserId: number;
  let directorAgentId: number;
  const createdJobIds: number[] = [];

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    assert.ok(ceoEmail);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(director);
    directorAgentId = director.id;
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    if (createdJobIds.length > 0) await db.delete(agentJobs).where(inArray(agentJobs.id, createdJobIds));
    await database.end();
    redis.disconnect();
  });

  test('Job com o objetivo sugerido do briefing diário roda via runAgentJob e produz o briefing determinístico como resultado da tool', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: DIRECTOR_DAILY_REVIEW_OBJECTIVE,
        summary: 'Briefing operacional diário',
        actions: [
          {
            id: 'action-1',
            agent: 'director',
            tool: 'director.generate_daily_brief',
            arguments: {},
            reason: 'Gerar o briefing operacional diário da agência.',
            confidence: 0.95,
          },
        ],
      }),
    );

    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Briefing diário ${runId}`,
        objective: DIRECTOR_DAILY_REVIEW_OBJECTIVE,
        agentId: directorAgentId,
        createdBy: ceoUserId,
        status: 'active',
        triggerType: 'schedule',
        scheduleConfig: { frequency: 'daily', hour: 8, minute: 0 },
      })
      .returning();
    createdJobIds.push(job.id);

    // trigger 'schedule' — o mesmo caminho que o Scheduler v1.3 usaria
    // (correio.md seção 11: "O Scheduler v1.3 deverá conseguir
    // executá-lo"), nenhum mecanismo de execução novo.
    const result = await runAgentJob(job.id, { type: 'schedule' });
    assert.ok(result.ok, `Run deveria completar: ${JSON.stringify(result)}`);
    assert.equal(result.run.status, 'completed');

    const [item] = await db
      .select()
      .from(agentActionPlanItems)
      .where(eq(agentActionPlanItems.planId, result.run.actionPlanId!));
    assert.ok(item);
    assert.equal(item.tool, 'director.generate_daily_brief');
    assert.equal(item.executionStatus, 'completed');

    const toolResult = item.result as { success: boolean; data: { status: string; summary: unknown; domains: unknown } };
    assert.equal(toolResult.success, true);
    // Prova que o resultado é o briefing determinístico real (mesma
    // estrutura de agents/director/operations-service.ts), não texto
    // livre gerado pelo LLM — o LLM só decidiu QUAL tool chamar.
    assert.ok(['ok', 'partial'].includes(toolResult.data.status));
    assert.ok(toolResult.data.summary);
    assert.ok(toolResult.data.domains);
  });
});
