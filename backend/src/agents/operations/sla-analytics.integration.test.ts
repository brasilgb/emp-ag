import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalIncidentReviews, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { computeIncidentSla } from './supervision-insights-service.js';
import { getOperationalSlaAnalytics } from './sla-analytics-service.js';
import { DEFAULT_SLA_MINUTES_BY_SEVERITY } from './sla-settings.js';

/**
 * Agentes v4.2 (correio.md "Operational SLA Analytics & Performance
 * Visibility", "19. Testes backend — Integração") — roda contra o
 * Postgres de teste real, com fixtures inseridas DIRETAMENTE em
 * `audit_logs`/`agent_operational_incident_reviews` (mesma técnica de
 * `incident-sla.integration.test.ts`, v4.1) — com `createdAt`/`reviewedAt`
 * EXPLICITAMENTE controlados (nunca `new Date()` implícito) porque os
 * cenários exigem relações temporais determinísticas (detectedAt →
 * deadline → closedAt) sem depender de `sleep` real nem de alterar a
 * configuração global de SLA (mantida no default:
 * critical=60min/warning=240min/info=1440min).
 *
 * Isolamento temporal (`nextAnchor` abaixo): a MAIORIA dos testes usa
 * asserções de EXATA igualdade (`completedWithinSla === 1`, não apenas
 * `>= 1`) — uma janela `[from, to]` relativa ao tempo REAL de execução
 * seria vulnerável a contaminação por incidentes genuínos criados por
 * OUTROS arquivos de teste deste mesmo processo (`operations.test.ts`,
 * `supervisor-*.test.ts` etc. disparam incidentes reais o tempo todo).
 * Por isso cada teste (exceto o de "open SLA", que precisa do relógio
 * real — ver comentário no teste 8) ancora suas fixtures numa janela de 7
 * dias no passado distante (~25 anos atrás), única por teste — nenhum
 * incidente real do resto da suíte jamais cai lá.
 */
describe('Agentes v4.2 - sla-analytics-service (integração)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const entityType = `sla_analytics_test_${suffix}`;

  let ceoUserId: number;
  let assigneeAId: number;
  let assigneeBId: number;
  const auditLogIds: number[] = [];
  const userIds: number[] = [];
  let entitySeq = 0;

  // ~25 anos atrás, derivado do `Date.now()` real desta execução (nunca
  // colide com incidentes reais de outros testes, nem com uma execução
  // anterior desta mesma suíte — ver docblock acima).
  const ANCHOR_BASE_MS = Date.now() - 25 * 365 * 24 * 60 * 60 * 1000;
  let anchorSlot = 0;
  function nextAnchor(): Date {
    anchorSlot += 1;
    // 7 dias de separação por slot — nenhuma janela de teste (a mais
    // larga usada abaixo é de poucas horas) pode encostar na do próximo.
    return new Date(ANCHOR_BASE_MS + anchorSlot * 7 * 24 * 60 * 60 * 1000);
  }

  async function insertIncidentAt(detectedAt: Date, severity: 'info' | 'warning' | 'critical' = 'critical') {
    entitySeq += 1;
    const [row] = await db
      .insert(auditLogs)
      .values({
        actorType: 'system',
        action: 'agents.operations.incident.detected',
        entityType,
        entityId: `e${entitySeq}-${suffix}`,
        createdAt: detectedAt,
        metadata: { incidentType: 'operational_degradation', severity, response: 'observe', dryRun: false, reason: 'fixture v4.2' },
      })
      .returning();
    auditLogIds.push(row!.id);
    return row!;
  }

  async function closeIncidentAt(auditLogId: number, status: 'resolved' | 'dismissed', closedAt: Date) {
    await db.insert(agentOperationalIncidentReviews).values({
      incidentAuditLogId: auditLogId,
      status,
      reviewedBy: ceoUserId,
      reviewedAt: closedAt,
      note: null,
      createdAt: closedAt,
      updatedAt: closedAt,
    });
  }

  async function acknowledgeIncidentAt(auditLogId: number, ackAt: Date) {
    await db.insert(agentOperationalIncidentReviews).values({
      incidentAuditLogId: auditLogId,
      status: 'acknowledged',
      reviewedBy: ceoUserId,
      reviewedAt: ackAt,
      note: null,
      createdAt: ackAt,
      updatedAt: ackAt,
    });
    await db.insert(auditLogs).values({
      userId: ceoUserId,
      actorType: 'user',
      action: 'agents.operations.incident_review.changed',
      entityType: 'agent_operational_incident_review',
      entityId: String(auditLogId),
      createdAt: ackAt,
      metadata: { incidentAuditLogId: auditLogId, previousStatus: 'unreviewed', newStatus: 'acknowledged', hasNote: false },
    });
  }

  async function assignIncidentAt(auditLogId: number, assigneeUserId: number | null, previousAssigneeUserId: number | null, at: Date) {
    await db.insert(auditLogs).values({
      userId: ceoUserId,
      actorType: 'user',
      action: assigneeUserId === null ? 'agents.operations.incident.unassigned' : previousAssigneeUserId === null ? 'agents.operations.incident.assigned' : 'agents.operations.incident.reassigned',
      entityType: 'agent_operational_incident_assignment',
      entityId: String(auditLogId),
      createdAt: at,
      metadata: { incidentAuditLogId: auditLogId, previousAssigneeUserId, assigneeUserId, performedByUserId: ceoUserId },
    });
  }

  function minutesAfter(minutes: number, base: Date): Date {
    return new Date(base.getTime() + minutes * 60 * 1000);
  }

  function minutesAgo(minutes: number, from: Date): Date {
    return new Date(from.getTime() - minutes * 60 * 1000);
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [assigneeA] = await db.insert(users).values({ name: `SLA Analytics A ${suffix}`, email: `sla-analytics-a-${suffix}@example.com`, passwordHash: 'x', roleId: ceoUser.roleId, isActive: true }).returning();
    assigneeAId = assigneeA!.id;
    userIds.push(assigneeAId);

    const [assigneeB] = await db.insert(users).values({ name: `SLA Analytics B ${suffix}`, email: `sla-analytics-b-${suffix}@example.com`, passwordHash: 'x', roleId: ceoUser.roleId, isActive: true }).returning();
    assigneeBId = assigneeB!.id;
    userIds.push(assigneeBId);
  });

  after(async () => {
    await db.delete(agentOperationalIncidentReviews).where(inArray(agentOperationalIncidentReviews.incidentAuditLogId, auditLogIds));
    await db.delete(auditLogs).where(inArray(auditLogs.id, auditLogIds));
    // Audits de review/assignment sintéticos inseridos diretamente (não
    // referenciados por `auditLogIds`, que só guarda os `incident.detected`)
    // — removidos por entityId reaproveitando o mesmo vínculo
    // determinístico (`entityId = String(auditLogId)`), nunca por texto.
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, auditLogIds.map(String)));
    await db.delete(users).where(inArray(users.id, userIds));
    await database.end();
    redis.disconnect();
  });

  test('1: incidente fechado dentro do SLA entra em completedWithinSla, nunca em completedOutsideSla', async () => {
    const base = nextAnchor();
    const detectedAt = base;
    const closedAt = minutesAfter(5, base); // deadline = detectedAt + 60min (critical) — bem dentro
    const incident = await insertIncidentAt(detectedAt, 'critical');
    await closeIncidentAt(incident.id, 'resolved', closedAt);

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(10, base) });
    assert.equal(analytics.sla.completedWithinSla, 1);
    assert.equal(analytics.sla.completedOutsideSla, 0);
    assert.equal(analytics.sla.breachRate, 0);
  });

  test('2: incidente fechado fora do SLA entra em completedOutsideSla, nunca em completedWithinSla', async () => {
    const base = nextAnchor();
    const detectedAt = base;
    const closedAt = minutesAfter(120, base); // deadline (critical, 60min) já passou há 60min
    const incident = await insertIncidentAt(detectedAt, 'critical');
    await closeIncidentAt(incident.id, 'resolved', closedAt);

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(130, base) });
    assert.equal(analytics.sla.completedOutsideSla, 1);
    assert.equal(analytics.sla.completedWithinSla, 0);
    assert.equal(analytics.sla.breachRate, 1);
  });

  test('3: status resolved conta para resolution/sla exatamente como dismissed (correio.md seção 7)', async () => {
    const base = nextAnchor();
    const detectedAt = base;
    const closedAt = minutesAfter(5, base);
    const incident = await insertIncidentAt(detectedAt, 'warning');
    await closeIncidentAt(incident.id, 'dismissed', closedAt);

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(10, base), severity: 'warning' });
    assert.equal(analytics.incidents.closed, 1);
    assert.equal(analytics.resolution.count, 1);
    assert.equal(analytics.sla.completedWithinSla, 1);
  });

  test('4: acknowledgement correto — acknowledgementSeconds = acknowledgedAt - detectedAt (transição real)', async () => {
    const base = nextAnchor();
    const detectedAt = base;
    const ackAt = minutesAfter(5, base);
    const incident = await insertIncidentAt(detectedAt, 'info');

    const window = { from: minutesAgo(1, base), to: minutesAfter(10, base), severity: 'info' as const };
    const beforeAck = await getOperationalSlaAnalytics(window);
    assert.equal(beforeAck.acknowledgement.count, 0, 'sem acknowledge ainda — não deveria contar');

    await acknowledgeIncidentAt(incident.id, ackAt);
    const afterAck = await getOperationalSlaAnalytics(window);
    assert.equal(afterAck.acknowledgement.count, 1);
    assert.equal(afterAck.acknowledgement.averageSeconds, 5 * 60);
    assert.equal(afterAck.acknowledgement.medianSeconds, 5 * 60);
  });

  test('5: incidente sem acknowledgement não entra em média/mediana de acknowledgement', async () => {
    const base = nextAnchor();
    await insertIncidentAt(base, 'critical');

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(10, base), severity: 'critical' });
    assert.equal(analytics.acknowledgement.count, 0);
    assert.equal(analytics.acknowledgement.averageSeconds, null);
    assert.equal(analytics.acknowledgement.medianSeconds, null);
  });

  test('6: intervalo temporal — incidente detectado FORA de [from, to] não entra nas métricas de entrada', async () => {
    const base = nextAnchor();
    await insertIncidentAt(base, 'critical');

    // Janela que NÃO cobre `base` (começa 200min depois dela).
    const outside = await getOperationalSlaAnalytics({ from: minutesAfter(200, base), to: minutesAfter(210, base), severity: 'critical' });
    assert.equal(outside.incidents.detected, 0, 'incidente detectado antes de `from` não deveria contar');

    // A mesma fixture, numa janela que a cobre, conta exatamente 1.
    const inside = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(1, base), severity: 'critical' });
    assert.equal(inside.incidents.detected, 1);
  });

  test('6b: incidente fechado DENTRO do período mas detectado ANTES dele conta em closed, não em detected (coorte de saída ≠ coorte de entrada)', async () => {
    const base = nextAnchor();
    const detectedAt = base;
    const closedAt = minutesAfter(500, base); // fechado bem depois da detecção
    const incident = await insertIncidentAt(detectedAt, 'warning');
    await closeIncidentAt(incident.id, 'resolved', closedAt);

    // Janela cobre só o FECHAMENTO, não a detecção.
    const closingWindow = await getOperationalSlaAnalytics({ from: minutesAfter(495, base), to: minutesAfter(505, base), severity: 'warning' });
    assert.equal(closingWindow.incidents.closed, 1, 'closedAt caiu na janela — deveria contar como fechado');
    assert.equal(closingWindow.incidents.detected, 0, 'detectedAt NÃO caiu na janela — não deveria inflar `detected`');

    // Janela cobre só a DETECÇÃO, não o fechamento.
    const detectionWindow = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(1, base), severity: 'warning' });
    assert.equal(detectionWindow.incidents.detected, 1);
    assert.equal(detectionWindow.incidents.closed, 0, 'closedAt NÃO caiu nesta janela — não deveria inflar `closed`');
  });

  test('7: severidades — bySeverity nunca mistura contagens entre severidades diferentes', async () => {
    const base = nextAnchor();
    const criticalIncident = await insertIncidentAt(base, 'critical');
    const infoIncident = await insertIncidentAt(minutesAfter(1, base), 'info');
    await closeIncidentAt(criticalIncident.id, 'resolved', minutesAfter(5, base));
    await closeIncidentAt(infoIncident.id, 'resolved', minutesAfter(6, base));

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(10, base) });
    assert.equal(analytics.bySeverity.critical.detected, 1);
    assert.equal(analytics.bySeverity.info.detected, 1);
    assert.equal(analytics.bySeverity.warning.detected, 0);
    assert.equal(analytics.bySeverity.critical.closed, 1);
    assert.equal(analytics.bySeverity.info.closed, 1);
    assert.equal(analytics.bySeverity.warning.closed, 0);
    for (const severity of ['info', 'warning', 'critical'] as const) {
      assert.ok(typeof analytics.bySeverity[severity].breachRate === 'number' || analytics.bySeverity[severity].breachRate === null);
    }
  });

  // Agentes v4.2 (correio.md seção 13) — `openSla` é deliberadamente uma
  // FOTOGRAFIA CORRENTE, sem filtro de período (ver docblock de
  // `getOpenSlaSnapshot`, sla-analytics-service.ts) — por isso, ao
  // contrário de todos os outros testes deste arquivo, este PRECISA do
  // relógio real (o serviço usa `new Date()` internamente para decidir
  // dentro/perto/fora do prazo). Asserções com `>=` (nunca `===`): outros
  // incidentes `critical` genuinamente abertos, criados por QUALQUER
  // outro teste do processo, também apareceriam aqui — o que é o
  // comportamento CORRETO do endpoint (fotografia real do sistema
  // inteiro), então a fixture deste teste só precisa GARANTIR um piso,
  // nunca um total exato.
  test('8: open SLA states — incidente ainda aberto aparece em withinSla/warning/breached conforme o prazo restante, nunca em completed', async () => {
    const now = new Date();
    // critical default = 60min. warning threshold = 20% do prazo restante
    // (SLA_WARNING_REMAINING_FRACTION, supervision-insights-service.ts) →
    // faltando <= 12min conta como warning.
    await insertIncidentAt(minutesAgo(5, now), 'critical'); // 55min restantes → within
    await insertIncidentAt(minutesAgo(50, now), 'critical'); // 10min restantes → warning
    await insertIncidentAt(minutesAgo(90, now), 'critical'); // já passou do prazo → breached

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(91, now), to: now, severity: 'critical' });
    assert.ok(analytics.openSla.withinSla >= 1, 'deveria contar o incidente dentro do prazo');
    assert.ok(analytics.openSla.warning >= 1, 'deveria contar o incidente em warning');
    assert.ok(analytics.openSla.breached >= 1, 'deveria contar o incidente já vencido');
  });

  test('9: consistência com SLA v4.1 — within/outside de um incidente fechado bate exatamente com computeIncidentSla', async () => {
    const base = nextAnchor();
    const detectedAt = base;
    const closedAt = minutesAfter(200, base); // bem fora do prazo (critical, 60min)
    const incident = await insertIncidentAt(detectedAt, 'critical');
    await closeIncidentAt(incident.id, 'resolved', closedAt);

    const reference = computeIncidentSla({
      severity: 'critical',
      detectedAt,
      reviewStatus: 'resolved',
      closedAt,
      assignedAt: null,
      lastActivityAt: closedAt,
      now: closedAt,
      slaMinutesBySeverity: DEFAULT_SLA_MINUTES_BY_SEVERITY,
    });
    assert.equal(reference.status, 'completed');
    assert.notEqual(reference.breachedAt, null, 'fixture construída para estar fora do prazo');

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(210, base) });
    assert.equal(analytics.sla.completedOutsideSla, 1);
    assert.equal(analytics.sla.completedWithinSla, 0);
  });

  test('16: ausência de N+1 — getOperationalSlaAnalytics custa o mesmo número de queries independente do volume de incidentes', async () => {
    async function countSelects(fn: () => Promise<unknown>): Promise<number> {
      let selectCount = 0;
      const originalSelect = db.select.bind(db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).select = (...args: unknown[]) => {
        selectCount += 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalSelect as any)(...args);
      };
      try {
        await fn();
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).select = originalSelect;
      }
      return selectCount;
    }

    const smallBase = nextAnchor();
    const smallIncident = await insertIncidentAt(smallBase, 'critical');
    await closeIncidentAt(smallIncident.id, 'resolved', minutesAfter(5, smallBase));
    const smallCount = await countSelects(() => getOperationalSlaAnalytics({ from: minutesAgo(1, smallBase), to: minutesAfter(10, smallBase) }));

    const largeBase = nextAnchor();
    const largeIncidents = await Promise.all(Array.from({ length: 8 }, (_, i) => insertIncidentAt(minutesAfter(i, largeBase), i % 2 === 0 ? 'critical' : 'warning')));
    await Promise.all(largeIncidents.map((incident, i) => (i % 3 === 0 ? closeIncidentAt(incident.id, 'resolved', minutesAfter(20, largeBase)) : Promise.resolve())));
    await Promise.all(largeIncidents.map((incident, i) => (i % 2 === 0 ? assignIncidentAt(incident.id, assigneeAId, null, minutesAfter(1, largeBase)) : Promise.resolve())));
    const largeCount = await countSelects(() => getOperationalSlaAnalytics({ from: minutesAgo(1, largeBase), to: minutesAfter(30, largeBase) }));

    assert.equal(smallCount, largeCount, `número de queries deveria ser constante (1 incidente: ${smallCount}; 9 incidentes: ${largeCount})`);
  });

  test('17: isolamento entre incidentes — o SLA/ack/assignment de um incidente nunca vaza para outro na mesma janela', async () => {
    const base = nextAnchor();
    const incidentA = await insertIncidentAt(base, 'critical');
    const incidentB = await insertIncidentAt(minutesAfter(1, base), 'critical');

    await acknowledgeIncidentAt(incidentA.id, minutesAfter(2, base)); // só A tem ack
    await closeIncidentAt(incidentB.id, 'resolved', minutesAfter(3, base)); // só B foi fechado
    await assignIncidentAt(incidentB.id, assigneeBId, null, minutesAfter(1, base));

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(10, base), severity: 'critical' });
    assert.equal(analytics.acknowledgement.count, 1, 'só A tem acknowledge — B não deveria contar');
    assert.equal(analytics.incidents.closed, 1, 'só B foi fechado — A não deveria contar como closed');

    const assigneeB = analytics.byAssignee.find((row) => row.userId === assigneeBId);
    assert.ok(assigneeB, 'B deveria aparecer no breakdown por responsável (foi o assignee no fechamento)');
    assert.equal(assigneeB!.closed, 1);
  });

  test('18: byAssignee usa o responsável NO MOMENTO DO FECHAMENTO, não o assignment corrente após reatribuição posterior', async () => {
    const base = nextAnchor();
    const detectedAt = base;
    const closedAt = minutesAfter(5, base);
    const incident = await insertIncidentAt(detectedAt, 'critical');

    await assignIncidentAt(incident.id, assigneeAId, null, minutesAfter(1, base)); // A assume antes do fechamento
    await closeIncidentAt(incident.id, 'resolved', closedAt); // A fecha
    await assignIncidentAt(incident.id, assigneeBId, assigneeAId, minutesAfter(10, base)); // reatribuído a B DEPOIS de já fechado (contexto histórico)

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(20, base), severity: 'critical' });
    const assigneeA = analytics.byAssignee.find((row) => row.userId === assigneeAId);
    const assigneeB = analytics.byAssignee.find((row) => row.userId === assigneeBId);
    assert.ok(assigneeA, 'A era o responsável no momento do fechamento — deveria aparecer');
    assert.equal(assigneeA!.closed, 1);
    assert.equal(assigneeB, undefined, 'B só foi atribuído DEPOIS do fechamento — nunca deveria herdar o desempenho');
  });

  test('19: incidente fechado sem NUNCA ter sido atribuído fica de fora do breakdown por responsável (autoria ambígua)', async () => {
    const base = nextAnchor();
    const incident = await insertIncidentAt(base, 'critical');
    await closeIncidentAt(incident.id, 'resolved', minutesAfter(5, base));

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(10, base), severity: 'critical' });
    assert.equal(analytics.sla.completedWithinSla + analytics.sla.completedOutsideSla, 1);
    const total = analytics.byAssignee.reduce((sum, row) => sum + row.closed, 0);
    assert.equal(total, 0, 'nenhum responsável inequívoco — não deveria aparecer no breakdown');
  });

  test('20: trend — soma diária bate com os totais agregados quando o período cabe em um único dia', async () => {
    const base = nextAnchor();
    const incident = await insertIncidentAt(base, 'warning');
    await closeIncidentAt(incident.id, 'resolved', minutesAfter(30, base));

    const analytics = await getOperationalSlaAnalytics({ from: minutesAgo(1, base), to: minutesAfter(60, base), severity: 'warning' });
    const detectedSum = analytics.trend.reduce((sum, point) => sum + point.detected, 0);
    const closedSum = analytics.trend.reduce((sum, point) => sum + point.closed, 0);
    assert.equal(detectedSum, analytics.incidents.detected);
    assert.equal(closedSum, analytics.incidents.closed);
    assert.ok(analytics.trend.length >= 1);
  });

  test('21: retorno vazio válido — período sem nenhum incidente nunca quebra e nunca produz NaN/Infinity', async () => {
    const base = nextAnchor();
    const analytics = await getOperationalSlaAnalytics({ from: base, to: minutesAfter(1, base), severity: 'critical' });
    assert.equal(analytics.incidents.detected, 0);
    assert.equal(analytics.incidents.closed, 0);
    assert.equal(analytics.sla.breachRate, null);
    assert.equal(analytics.acknowledgement.averageSeconds, null);
    assert.equal(analytics.resolution.averageSeconds, null);
    assert.deepEqual(analytics.byAssignee, []);
    for (const point of analytics.trend) {
      assert.ok(Number.isFinite(point.detected));
      assert.ok(Number.isFinite(point.closed));
    }
  });
});
