import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { slaState } from "./derived";

const NOW = new Date("2026-08-29T12:00:00.000Z");

describe("slaState", () => {
  test("dentro do prazo quando falta mais de 2h", () => {
    assert.equal(
      slaState({ status: "open", slaDueAt: "2026-08-29T18:00:00.000Z" }, NOW),
      "on_track",
    );
  });

  test("próximo do vencimento quando falta 2h ou menos", () => {
    assert.equal(
      slaState({ status: "open", slaDueAt: "2026-08-29T13:30:00.000Z" }, NOW),
      "near_due",
    );
  });

  test("atrasado quando sla_due_at já passou", () => {
    assert.equal(
      slaState({ status: "open", slaDueAt: "2026-08-29T10:00:00.000Z" }, NOW),
      "overdue",
    );
  });

  test("null quando o ticket está em status terminal, mesmo vencido", () => {
    assert.equal(
      slaState({ status: "resolved", slaDueAt: "2026-08-29T10:00:00.000Z" }, NOW),
      null,
    );
    assert.equal(
      slaState({ status: "closed", slaDueAt: "2026-08-29T10:00:00.000Z" }, NOW),
      null,
    );
    assert.equal(
      slaState({ status: "cancelled", slaDueAt: "2026-08-29T10:00:00.000Z" }, NOW),
      null,
    );
  });

  test("null quando não há sla_due_at", () => {
    assert.equal(slaState({ status: "open", slaDueAt: null }, NOW), null);
  });
});
