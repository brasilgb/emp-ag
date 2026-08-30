import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { canRegisterPayment, isEntryOverdue } from "./derived";

const TODAY = new Date(2026, 7, 29); // 29/ago/2026 (mês 0-indexado)

describe("isEntryOverdue", () => {
  test("atrasado quando vencido e status pending", () => {
    assert.equal(isEntryOverdue({ dueDate: "2026-08-01", status: "pending" }, TODAY), true);
  });

  test("não atrasado quando pago, mesmo vencido", () => {
    assert.equal(isEntryOverdue({ dueDate: "2026-08-01", status: "paid" }, TODAY), false);
  });

  test("não atrasado quando cancelado, mesmo vencido", () => {
    assert.equal(isEntryOverdue({ dueDate: "2026-08-01", status: "cancelled" }, TODAY), false);
  });

  test("não atrasado quando vence hoje", () => {
    assert.equal(isEntryOverdue({ dueDate: "2026-08-29", status: "pending" }, TODAY), false);
  });

  test("não atrasado quando vence no futuro", () => {
    assert.equal(isEntryOverdue({ dueDate: "2026-09-01", status: "pending" }, TODAY), false);
  });
});

describe("canRegisterPayment", () => {
  test("permite quando pending com saldo restante", () => {
    assert.equal(canRegisterPayment({ status: "pending", remainingAmount: "100.00" }), true);
  });

  test("bloqueia quando cancelado", () => {
    assert.equal(canRegisterPayment({ status: "cancelled", remainingAmount: "100.00" }), false);
  });

  test("bloqueia quando saldo já quitado", () => {
    assert.equal(canRegisterPayment({ status: "paid", remainingAmount: "0.00" }), false);
  });
});
