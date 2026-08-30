import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  approvalState,
  autonomyLevelBadgeVariant,
  autonomyLevelLabel,
  executionStatusLabel,
  formatChatResponse,
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
