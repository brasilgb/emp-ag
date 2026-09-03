import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { agentActionPlans } from './agent-action-plans.js';
import { agentOperationalFollowUps } from './agent-operational-follow-ups.js';
import { agentResponsibilities } from './agent-responsibilities.js';
import { agents } from './agents.js';
import { users } from './users.js';

/**
 * Agentes v2.8 (correio.md "3. Novo conceito: Operational Action
 * Proposal") — "existe uma possível ação operacional necessária para
 * resolver ou avançar este FollowUp" — NUNCA "esta ação está autorizada
 * para execução" (nenhuma coluna aqui carrega autorização; `status`
 * nunca vale `execute`/`approval_required`/`blocked`/`shadow` — essas
 * decisões pertencem exclusivamente ao Policy Evaluator, seção 9).
 *
 * Estados (seção 5, modelo simplificado — avaliado e adotado: "não
 * existe edição progressiva da proposta" antes da submissão, então
 * `draft` foi descartado): `submitted | planned | completed | failed |
 * cancelled`. `submitted` é o estado de criação — um registro puro,
 * sem nenhum efeito colateral (seção 6: "a criação da proposta não
 * executa nada"). `planned` só é alcançado via `POST
 * /agents/action-proposals/:id/submit`, que de fato invoca o pipeline
 * oficial (`followups/action-proposals-service.ts`).
 *
 * `objective`/`title`/`description`: só texto descritivo fornecido pelo
 * humano (seção 20: "o humano descreve o objetivo, o Planner
 * estrutura") — nunca tool/handler/permission/policy, que são conceitos
 * internos do pipeline, nunca expostos aqui.
 *
 * `ownerAgentId`/`responsibilityId`: cópias congeladas de
 * `followUp.ownerAgentId`/`followUp.responsibilityId` no momento da
 * criação (seção 4) — nunca recalculadas.
 *
 * `actionPlanId`: FK para `agent_action_plans`, populada só após
 * `submit` bem-sucedido (seção 7/12). `onDelete: 'restrict'` — Action
 * Plans não são excluídos por nenhuma rota real do sistema, então
 * `restrict` é a opção mais segura para preservar histórico (seção 18
 * dos "critérios bloqueantes" da v2.6/v2.7, mantido).
 *
 * `failureReason`: reaproveitado tanto para falha do pipeline
 * (`planning_failed`/`plan_too_large`/etc., seção 14) quanto para o
 * motivo de um cancelamento humano (seção 18) — um único campo "motivo
 * de não-conclusão", evita uma coluna redundante só para cancelamento.
 *
 * Deliberadamente SEM `UNIQUE(follow_up_id)` (seção 15: "um mesmo
 * FollowUp pode exigir várias ações ao longo de sua vida" — cada
 * proposta é um ato operacional distinto, nunca deduplicado pelo
 * FollowUp inteiro) e SEM coluna `metadata` (seção 3: "somente se
 * realmente necessário" — nenhuma necessidade concreta identificada).
 *
 * Fechamento v2.8 (correio.md "ponto de consistência 1") — CHECK
 * `agent_operational_action_proposals_planned_requires_plan`: prova, na
 * camada mais forte disponível (o próprio banco, mesmo princípio já
 * usado em `agent_approvals`/`agent_responsibilities`), que uma proposta
 * NUNCA fica `status='planned'` sem um `action_plan_id` real vinculado —
 * qualquer tentativa de escrever essa combinação (inclusive um bug
 * futuro na camada de serviço) é rejeitada pelo Postgres, não apenas
 * "esperada" pela lógica da aplicação. `action-proposals-service.ts`
 * garante isso na prática: a transição para `planned` só acontece no
 * MESMO UPDATE que grava `actionPlanId`; qualquer falha entre a
 * reivindicação atômica e esse ponto (falha do Planner OU exceção
 * inesperada) é capturada e resolve para `failed`, nunca deixa a
 * proposta presa em `planned` sem plano.
 */
export const agentOperationalActionProposals = pgTable(
  'agent_operational_action_proposals',
  {
    id: serial('id').primaryKey(),

    followUpId: integer('follow_up_id')
      .notNull()
      .references(() => agentOperationalFollowUps.id, { onDelete: 'restrict' }),
    responsibilityId: integer('responsibility_id')
      .notNull()
      .references(() => agentResponsibilities.id, { onDelete: 'restrict' }),
    ownerAgentId: integer('owner_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),

    title: varchar('title', { length: 200 }).notNull(),
    objective: text('objective').notNull(),
    description: text('description'),

    // status: submitted | planned | completed | failed | cancelled.
    status: varchar('status', { length: 20 }).notNull().default('submitted'),

    actionPlanId: integer('action_plan_id').references(() => agentActionPlans.id, { onDelete: 'restrict' }),

    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // Seção 8 — identidade explicitamente rastreável de quem submeteu
    // (nunca CEO/sistema/Supervisor automaticamente); populado só quando
    // `submit` de fato vence a corrida de concorrência (seção 16).
    submittedBy: integer('submitted_by').references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    plannedAt: timestamp('planned_at', { withTimezone: true }),

    completedAt: timestamp('completed_at', { withTimezone: true }),

    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: integer('cancelled_by').references(() => users.id, { onDelete: 'set null' }),

    failureReason: text('failure_reason'),
  },
  (table) => [
    index('agent_operational_action_proposals_follow_up_idx').on(table.followUpId),
    index('agent_operational_action_proposals_status_idx').on(table.status),
    index('agent_operational_action_proposals_action_plan_idx').on(table.actionPlanId),
    index('agent_operational_action_proposals_created_at_idx').on(table.createdAt),
    check(
      'agent_operational_action_proposals_planned_requires_plan',
      sql`(${table.status} <> 'planned') OR (${table.actionPlanId} IS NOT NULL)`,
    ),
  ],
);
