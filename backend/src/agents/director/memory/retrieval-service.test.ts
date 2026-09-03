import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorGoals, agentDirectorInitiatives, agentStrategicMemories, users } from '../../../db/schema/index.js';
import { database } from '../../../services/database.js';
import { redis } from '../../../services/redis.js';

import { getRelevantStrategicMemories } from './retrieval-service.js';

/*
 * Agentes v2.3 (correio.md seção 23, itens 13/14/15) — recuperação
 * determinística: filtragem por domínio, respeito ao limite explícito, e
 * memórias arquivadas/draft nunca entrando no contexto normal.
 */
describe('Agentes v2.3 - Strategic Memory (retrieval-service)', () => {
  const runId = Date.now() % 1_000_000;
  // varchar(20) — precisa caber "<domain>-outro" também (usado no teste 13).
  const domain = `t${runId}`;

  let ceoUserId: number;
  let goalId: number;
  let initiativeId: number;
  const memoryIds: number[] = [];

  // Este módulo só exercita `getRelevantStrategicMemories`, que lê
  // direto de `agent_strategic_memories` — não precisa de uma Executive
  // Review real por linha (`sourceReviewId` é nullable no schema
  // justamente para permitir memórias sem review de origem em versões
  // futuras). Insere a memória diretamente, sem passar pelo claim/LLM.
  async function insertMemory(overrides: Partial<typeof agentStrategicMemories.$inferInsert> = {}) {
    const [memory] = await db
      .insert(agentStrategicMemories)
      .values({
        memoryType: 'initiative_outcome',
        domain,
        title: 'Memória de teste',
        summary: 'Resumo',
        lesson: 'Lição',
        outcome: 'successful',
        confidence: '0.700',
        importance: 'medium',
        tags: [],
        sourceGoalId: goalId,
        sourceInitiativeId: initiativeId,
        sourceReviewId: null,
        status: 'active',
        evidence: {},
        createdBy: ceoUserId,
        ...overrides,
      })
      .returning();
    memoryIds.push(memory!.id);
    return memory!;
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({
        title: `Goal p/ Retrieval ${runId}`,
        description: 'desc',
        domain: 'crm',
        status: 'active',
        priority: 'medium',
        createdBy: ceoUserId,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        targetDate: new Date('2026-12-01T00:00:00.000Z'),
        targetType: 'milestone',
      })
      .returning();
    goalId = goal!.id;

    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({ goalId, title: 'Initiative p/ Retrieval', description: 'desc', domain: 'crm', status: 'completed', priority: 'medium', rationale: 'r', origin: 'manual', createdBy: ceoUserId })
      .returning();
    initiativeId = initiative!.id;
  });

  after(async () => {
    for (const id of memoryIds) await db.delete(agentStrategicMemories).where(eq(agentStrategicMemories.id, id));
    await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiativeId));
    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));

    await database.end();
    redis.disconnect();
  });

  test('13: memória histórica pode ser recuperada por domínio', async () => {
    await insertMemory({ title: 'Memória do domínio certo' });
    await insertMemory({ domain: `${domain}-outro`, title: 'Memória de outro domínio' });

    const results = await getRelevantStrategicMemories({ domain });
    assert.ok(results.length >= 1);
    assert.ok(results.every((memory) => memory.domain === domain));
  });

  test('14: limite de quantidade recuperada é respeitado (default e customizado, capado no máximo)', async () => {
    for (let index = 0; index < 8; index += 1) {
      await insertMemory({ title: `Memória em massa ${index}`, importance: index % 2 === 0 ? 'high' : 'low' });
    }

    const defaultResult = await getRelevantStrategicMemories({ domain });
    assert.ok(defaultResult.length <= 5, 'limite padrão é 5');

    const custom = await getRelevantStrategicMemories({ domain, limit: 3 });
    assert.equal(custom.length, 3);

    const overMax = await getRelevantStrategicMemories({ domain, limit: 999 });
    assert.ok(overMax.length <= 10, 'nunca excede MAX_RELEVANT_MEMORIES_LIMIT mesmo pedindo mais');
  });

  test('15: memória arquivada (ou draft) nunca entra no contexto normal', async () => {
    const archived = await insertMemory({ title: 'Memória arquivada', status: 'archived' });
    const draft = await insertMemory({ title: 'Memória draft', status: 'draft' });

    const results = await getRelevantStrategicMemories({ domain });
    assert.ok(!results.some((memory) => memory.id === archived.id), 'arquivada nunca deveria aparecer');
    assert.ok(!results.some((memory) => memory.id === draft.id), 'draft nunca deveria aparecer');
  });

  test('importância > confiança > recência determinam a ordem', async () => {
    const low = await insertMemory({ title: 'Baixa importância', importance: 'low', confidence: '0.990' });
    const high = await insertMemory({ title: 'Alta importância', importance: 'high', confidence: '0.100' });

    const results = await getRelevantStrategicMemories({ domain, limit: 10 });
    const highIndex = results.findIndex((memory) => memory.id === high.id);
    const lowIndex = results.findIndex((memory) => memory.id === low.id);
    assert.ok(highIndex >= 0 && lowIndex >= 0);
    assert.ok(highIndex < lowIndex, 'importância "high" deveria vir antes de "low", mesmo com confiança menor');
  });
});
