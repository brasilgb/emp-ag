import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isProjectOverdue, isTaskOverdue } from "./derived";

const TODAY = new Date(2026, 7, 29); // 29/ago/2026 (mês 0-indexado)

describe("isTaskOverdue", () => {
  test("atrasada quando vencida e status em aberto", () => {
    assert.equal(isTaskOverdue({ dueDate: "2026-08-01", status: "todo" }, TODAY), true);
  });

  test("não atrasada quando concluída, mesmo vencida", () => {
    assert.equal(isTaskOverdue({ dueDate: "2026-08-01", status: "done" }, TODAY), false);
  });

  test("não atrasada quando cancelada, mesmo vencida", () => {
    assert.equal(isTaskOverdue({ dueDate: "2026-08-01", status: "cancelled" }, TODAY), false);
  });

  test("não atrasada quando vence hoje", () => {
    assert.equal(isTaskOverdue({ dueDate: "2026-08-29", status: "todo" }, TODAY), false);
  });

  test("não atrasada quando vence no futuro", () => {
    assert.equal(isTaskOverdue({ dueDate: "2026-09-01", status: "todo" }, TODAY), false);
  });

  test("nunca atrasada quando dueDate é nulo", () => {
    assert.equal(isTaskOverdue({ dueDate: null, status: "todo" }, TODAY), false);
  });
});

describe("isProjectOverdue", () => {
  test("atrasado quando vencido e status em aberto", () => {
    assert.equal(isProjectOverdue({ dueDate: "2026-08-01", status: "in_progress" }, TODAY), true);
  });

  test("não atrasado quando concluído, mesmo vencido", () => {
    assert.equal(isProjectOverdue({ dueDate: "2026-08-01", status: "completed" }, TODAY), false);
  });

  test("não atrasado quando cancelado, mesmo vencido", () => {
    assert.equal(isProjectOverdue({ dueDate: "2026-08-01", status: "cancelled" }, TODAY), false);
  });

  test("nunca atrasado quando dueDate é nulo", () => {
    assert.equal(isProjectOverdue({ dueDate: null, status: "in_progress" }, TODAY), false);
  });
});
