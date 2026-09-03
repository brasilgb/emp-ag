import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  approvalState,
  autonomyLevelBadgeVariant,
  autonomyLevelLabel,
  canProposeActionForDecision,
  canProposeActionForInitiative,
  daysOpen,
  daysRemaining,
  decisionImpactLabel,
  decisionStatusLabel,
  decisionUrgencyLabel,
  executionStatusLabel,
  formatChatResponse,
  goalHealthLabel,
  goalPriorityLabel,
  goalStatusLabel,
  formatAgeSeconds,
  initiativeExecutionStateLabel,
  memoryImportanceLabel,
  memoryStatusLabel,
  memoryTypeLabel,
  recommendationTypeLabel,
  recoveryResultLabel,
  reviewOutcomeLabel,
  workflowTypeLabel,
  initiativeStatusLabel,
  isCriticalSetting,
  isDecisionClosed,
  isGoalClosed,
  isInitiativeClosed,
  signalEntityHref,
} from "./derived";

const NOW = new Date("2026-08-30T12:00:00.000Z");

describe("executionStatusLabel", () => {
  test("traduz cada status conhecido", () => {
    assert.equal(executionStatusLabel("waiting_approval"), "Aguardando aprovação");
    assert.equal(executionStatusLabel("completed"), "Concluída");
    assert.equal(executionStatusLabel("failed"), "Falhou");
  });
});

describe("autonomyLevelLabel / autonomyLevelBadgeVariant", () => {
  test("traduz cada nível de autonomia", () => {
    assert.equal(autonomyLevelLabel("read"), "Somente leitura");
    assert.equal(autonomyLevelLabel("approval_required"), "Requer aprovação");
  });

  test("approval_required é sempre destacado como destructive", () => {
    assert.equal(autonomyLevelBadgeVariant("approval_required"), "destructive");
    assert.equal(autonomyLevelBadgeVariant("read"), "outline");
  });
});

describe("approvalState", () => {
  test("pending distante do vencimento continua pending", () => {
    const state = approvalState(
      { status: "pending", expiresAt: "2026-08-31T12:00:00.000Z" },
      NOW,
    );
    assert.equal(state, "pending");
  });

  test("pending a menos de 2h do vencimento vira expiring_soon", () => {
    const state = approvalState(
      { status: "pending", expiresAt: "2026-08-30T13:30:00.000Z" },
      NOW,
    );
    assert.equal(state, "expiring_soon");
  });

  test("pending com expires_at já passado vira expired", () => {
    const state = approvalState(
      { status: "pending", expiresAt: "2026-08-30T10:00:00.000Z" },
      NOW,
    );
    assert.equal(state, "expired");
  });

  test("status decidido (approved/rejected) não é reinterpretado", () => {
    assert.equal(approvalState({ status: "approved", expiresAt: null }, NOW), "approved");
    assert.equal(approvalState({ status: "rejected", expiresAt: "2020-01-01T00:00:00.000Z" }, NOW), "rejected");
  });
});

describe("formatChatResponse", () => {
  test("com agente e tool, gera legenda discreta de transparência", () => {
    const formatted = formatChatResponse({
      agent: { slug: "finance", name: "Agente Financeiro" },
      tool: "finance.get_summary",
      message: "A receber: R$ 100,00.",
    });

    assert.equal(formatted.text, "A receber: R$ 100,00.");
    assert.equal(formatted.transparency, "Agente Financeiro · Consultou: finance.get_summary");
  });

  test("sem agente (intenção desconhecida), sem transparência e com fallback", () => {
    const formatted = formatChatResponse({ agent: null, tool: null, message: "" });

    assert.equal(formatted.transparency, null);
    assert.match(formatted.text, /Não consegui identificar/);
  });
});

// Agentes v1.7 — Agent Management & Operational Configuration.
describe("isCriticalSetting", () => {
  test("circuit breaker e autonomy.maxDepth exigem confirmação de UI", () => {
    assert.equal(isCriticalSetting("circuit.failureThreshold"), true);
    assert.equal(isCriticalSetting("circuit.cooldownSeconds"), true);
    assert.equal(isCriticalSetting("autonomy.maxDepth"), true);
  });

  test("chain/rate limit não são tratados como críticos", () => {
    assert.equal(isCriticalSetting("chain.maxRunsPerAutonomyChain"), false);
    assert.equal(isCriticalSetting("rate.autonomyLimit"), false);
    assert.equal(isCriticalSetting("rate.autonomyWindowSeconds"), false);
  });
});

// Agentes v1.8 — Director Operations & Business Workflows.
describe("signalEntityHref", () => {
  test("lead/project/financial_entry/support_ticket/customer_success_account/agent_job usam entityId direto", () => {
    assert.equal(signalEntityHref({ entityType: "lead", entityId: 5, metadata: {} }), "/leads/5");
    assert.equal(signalEntityHref({ entityType: "project", entityId: 7, metadata: {} }), "/projects/7");
    assert.equal(signalEntityHref({ entityType: "financial_entry", entityId: 9, metadata: {} }), "/financial/9");
    assert.equal(signalEntityHref({ entityType: "support_ticket", entityId: 3, metadata: {} }), "/support/3");
    assert.equal(
      signalEntityHref({ entityType: "customer_success_account", entityId: 2, metadata: {} }),
      "/customer-success/2",
    );
    assert.equal(signalEntityHref({ entityType: "agent_job", entityId: 11, metadata: {} }), "/agents/jobs/11");
  });

  test("task usa metadata.projectId, nunca o id da própria tarefa (não existe página de tarefa isolada)", () => {
    assert.equal(signalEntityHref({ entityType: "task", entityId: 42, metadata: { projectId: 8 } }), "/projects/8");
  });

  test("task sem metadata.projectId não gera link quebrado", () => {
    assert.equal(signalEntityHref({ entityType: "task", entityId: 42, metadata: {} }), null);
  });

  test("entityType desconhecido ou ausente nunca gera link", () => {
    assert.equal(signalEntityHref({ entityType: "agent_approval", entityId: 1, metadata: {} }), null);
    assert.equal(signalEntityHref({ metadata: {} }), null);
  });
});

// Agentes v1.9 — Director Decision Queue.
describe("decisionStatusLabel / decisionImpactLabel / decisionUrgencyLabel", () => {
  test("todo status/impact/urgency conhecido tem rótulo em pt-BR", () => {
    assert.equal(decisionStatusLabel("open"), "Aberto");
    assert.equal(decisionStatusLabel("awaiting_approval"), "Aguardando aprovação");
    assert.equal(decisionImpactLabel("high"), "Alto");
    assert.equal(decisionUrgencyLabel("immediate"), "Imediata");
  });

  test("valor desconhecido faz fallback para o próprio valor (nunca undefined)", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(decisionStatusLabel("nunca_existiu"), "nunca_existiu");
  });
});

describe("isDecisionClosed / canProposeActionForDecision", () => {
  test("resolved e dismissed são os únicos estados terminais", () => {
    assert.equal(isDecisionClosed("resolved"), true);
    assert.equal(isDecisionClosed("dismissed"), true);
    assert.equal(isDecisionClosed("open"), false);
    assert.equal(isDecisionClosed("awaiting_approval"), false);
  });

  test("só é possível propor ação a partir de open/acknowledged (mesma regra do backend)", () => {
    assert.equal(canProposeActionForDecision("open"), true);
    assert.equal(canProposeActionForDecision("acknowledged"), true);
    assert.equal(canProposeActionForDecision("action_planned"), false);
    assert.equal(canProposeActionForDecision("awaiting_approval"), false);
    assert.equal(canProposeActionForDecision("resolved"), false);
    assert.equal(canProposeActionForDecision("dismissed"), false);
  });
});

describe("daysOpen", () => {
  test("now controlado, nunca Date.now() implícito", () => {
    assert.equal(daysOpen("2026-08-25T12:00:00.000Z", NOW), 5);
  });

  test("nunca retorna negativo (relógio do servidor levemente à frente)", () => {
    assert.equal(daysOpen("2026-08-31T12:00:00.000Z", NOW), 0);
  });

  test("menos de 24h ainda conta como 0 dias (arredonda para baixo)", () => {
    assert.equal(daysOpen("2026-08-30T01:00:00.000Z", NOW), 0);
  });
});

// Agentes v2.0 — Director Goals, Initiatives & Executive Planning.
describe("goalStatusLabel / goalHealthLabel / goalPriorityLabel / initiativeStatusLabel", () => {
  test("todo valor conhecido tem rótulo em pt-BR", () => {
    assert.equal(goalStatusLabel("active"), "Ativo");
    assert.equal(goalHealthLabel("at_risk"), "Em risco");
    assert.equal(goalPriorityLabel("critical"), "Crítica");
    assert.equal(initiativeStatusLabel("proposed"), "Proposta");
  });

  test("valor desconhecido faz fallback para o próprio valor", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(goalStatusLabel("nunca_existiu"), "nunca_existiu");
  });
});

describe("isGoalClosed / isInitiativeClosed / canProposeActionForInitiative", () => {
  test("achieved/missed/cancelled são os únicos estados terminais de Goal", () => {
    assert.equal(isGoalClosed("achieved"), true);
    assert.equal(isGoalClosed("missed"), true);
    assert.equal(isGoalClosed("cancelled"), true);
    assert.equal(isGoalClosed("draft"), false);
    assert.equal(isGoalClosed("active"), false);
    assert.equal(isGoalClosed("paused"), false);
  });

  test("completed/cancelled são os únicos estados terminais de Initiative", () => {
    assert.equal(isInitiativeClosed("completed"), true);
    assert.equal(isInitiativeClosed("cancelled"), true);
    assert.equal(isInitiativeClosed("proposed"), false);
    assert.equal(isInitiativeClosed("approved"), false);
    assert.equal(isInitiativeClosed("active"), false);
    assert.equal(isInitiativeClosed("blocked"), false);
  });

  test("só é possível propor ação a partir de approved (mesma regra do backend)", () => {
    assert.equal(canProposeActionForInitiative("approved"), true);
    assert.equal(canProposeActionForInitiative("proposed"), false);
    assert.equal(canProposeActionForInitiative("active"), false);
    assert.equal(canProposeActionForInitiative("completed"), false);
  });
});

describe("daysRemaining", () => {
  test("now controlado, nunca Date.now() implícito", () => {
    assert.equal(daysRemaining("2026-09-10T12:00:00.000Z", NOW), 11);
  });

  test("prazo já vencido retorna negativo (dias de atraso)", () => {
    assert.equal(daysRemaining("2026-08-20T12:00:00.000Z", NOW), -10);
  });
});

// Agentes v2.1 — Initiative Execution & Progress Tracking.
describe("initiativeExecutionStateLabel", () => {
  test("todo estado conhecido tem rótulo em pt-BR", () => {
    assert.equal(initiativeExecutionStateLabel("not_started"), "Não iniciada");
    assert.equal(initiativeExecutionStateLabel("waiting_approval"), "Aguardando aprovação");
    assert.equal(initiativeExecutionStateLabel("running"), "Em execução");
    assert.equal(initiativeExecutionStateLabel("blocked"), "Bloqueada");
    assert.equal(initiativeExecutionStateLabel("failed"), "Com falha");
    assert.equal(initiativeExecutionStateLabel("completed"), "Concluída");
  });

  test("valor desconhecido faz fallback para o próprio valor", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(initiativeExecutionStateLabel("nunca_existiu"), "nunca_existiu");
  });
});

// Agentes v2.2 — Executive Review & Strategic Feedback Loop.
describe("reviewOutcomeLabel", () => {
  test("todo outcome conhecido tem rótulo em pt-BR", () => {
    assert.equal(reviewOutcomeLabel("successful"), "Bem-sucedido");
    assert.equal(reviewOutcomeLabel("partially_successful"), "Parcialmente bem-sucedido");
    assert.equal(reviewOutcomeLabel("unsuccessful"), "Sem sucesso");
    assert.equal(reviewOutcomeLabel("inconclusive"), "Inconclusivo");
    assert.equal(reviewOutcomeLabel("blocked"), "Bloqueado");
  });

  test("valor desconhecido faz fallback para o próprio valor", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(reviewOutcomeLabel("nunca_existiu"), "nunca_existiu");
  });
});

describe("recommendationTypeLabel", () => {
  test("todo tipo conhecido tem rótulo em pt-BR, nunca sugerindo decisão automática", () => {
    assert.equal(recommendationTypeLabel("none"), "Nenhuma ação necessária");
    assert.equal(recommendationTypeLabel("continue"), "Continuar estratégia atual");
    assert.equal(recommendationTypeLabel("adjust"), "Ajustar estratégia");
    assert.equal(recommendationTypeLabel("new_initiative"), "Propor nova iniciativa");
    assert.equal(recommendationTypeLabel("escalate"), "Escalar para decisão do CEO");
  });

  test("valor desconhecido faz fallback para o próprio valor", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(recommendationTypeLabel("nunca_existiu"), "nunca_existiu");
  });
});

// Agentes v2.3 — Strategic Learning & Organizational Memory.
describe("memoryTypeLabel", () => {
  test("todo tipo conhecido tem rótulo em pt-BR", () => {
    assert.equal(memoryTypeLabel("initiative_outcome"), "Resultado de iniciativa");
    assert.equal(memoryTypeLabel("strategic_lesson"), "Lição estratégica");
    assert.equal(memoryTypeLabel("decision_outcome"), "Resultado de decisão");
    assert.equal(memoryTypeLabel("recurring_pattern"), "Padrão recorrente");
  });

  test("valor desconhecido faz fallback para o próprio valor", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(memoryTypeLabel("nunca_existiu"), "nunca_existiu");
  });
});

describe("memoryStatusLabel", () => {
  test("todo status conhecido tem rótulo em pt-BR", () => {
    assert.equal(memoryStatusLabel("draft"), "Gerando...");
    assert.equal(memoryStatusLabel("active"), "Ativa");
    assert.equal(memoryStatusLabel("superseded"), "Substituída");
    assert.equal(memoryStatusLabel("archived"), "Arquivada");
  });

  test("valor desconhecido faz fallback para o próprio valor", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(memoryStatusLabel("nunca_existiu"), "nunca_existiu");
  });
});

describe("memoryImportanceLabel", () => {
  test("todo nível conhecido tem rótulo em pt-BR", () => {
    assert.equal(memoryImportanceLabel("low"), "Baixa");
    assert.equal(memoryImportanceLabel("medium"), "Média");
    assert.equal(memoryImportanceLabel("high"), "Alta");
  });

  test("valor desconhecido faz fallback para o próprio valor", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(memoryImportanceLabel("nunca_existiu"), "nunca_existiu");
  });
});

// Agentes v2.4 — Workflow Recovery, Reconciliation & Operational Resilience.
describe("recoveryResultLabel", () => {
  test("todo resultado conhecido tem rótulo em pt-BR", () => {
    assert.equal(recoveryResultLabel("recovered"), "Recuperado");
    assert.equal(recoveryResultLabel("retried"), "Nova tentativa");
    assert.equal(recoveryResultLabel("reverted"), "Revertido");
    assert.equal(recoveryResultLabel("marked_failed"), "Marcado como falho");
    assert.equal(recoveryResultLabel("manual_attention"), "Atenção manual");
    assert.equal(recoveryResultLabel("skipped"), "Ignorado (nada a fazer)");
  });

  test("valor desconhecido faz fallback para o próprio valor", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(recoveryResultLabel("nunca_existiu"), "nunca_existiu");
  });
});

describe("workflowTypeLabel", () => {
  test("todo tipo conhecido tem rótulo", () => {
    assert.equal(workflowTypeLabel("initiative"), "Initiative");
    assert.equal(workflowTypeLabel("executive_review"), "Executive Review");
    assert.equal(workflowTypeLabel("strategic_memory"), "Strategic Memory");
  });

  test("valor desconhecido faz fallback para o próprio valor", () => {
    // @ts-expect-error — testando o fallback de valor não mapeado.
    assert.equal(workflowTypeLabel("nunca_existiu"), "nunca_existiu");
  });
});

describe("formatAgeSeconds", () => {
  test("formata segundos/minutos/horas/dias no maior recorte apropriado", () => {
    assert.equal(formatAgeSeconds(30), "30s");
    assert.equal(formatAgeSeconds(59), "59s");
    assert.equal(formatAgeSeconds(60), "1min");
    assert.equal(formatAgeSeconds(3599), "59min");
    assert.equal(formatAgeSeconds(3600), "1h");
    assert.equal(formatAgeSeconds(86399), "23h");
    assert.equal(formatAgeSeconds(86400), "1d");
    assert.equal(formatAgeSeconds(172800), "2d");
  });
});
