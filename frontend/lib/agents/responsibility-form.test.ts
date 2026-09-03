import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { escalationTargetsForPolicyChange, parseConditionsInput } from "./responsibility-form";

/*
 * Agentes v2.6 ("Fechamento antes do commit") — cobertura real do
 * EditResponsibilityDialog: validação de `conditions` e ajuste de
 * targets ao trocar `escalationPolicy`.
 */
describe("parseConditionsInput", () => {
  test("JSON de objeto válido é convertido corretamente", () => {
    assert.deepEqual(parseConditionsInput("{}"), {});
    assert.deepEqual(parseConditionsInput('{"minSeverity": "warning"}'), { minSeverity: "warning" });
  });

  test("JSON inválido (sintaxe quebrada) lança erro", () => {
    assert.throws(() => parseConditionsInput("{invalido"), /JSON válido/);
  });

  test("JSON válido mas não-objeto (array, string, número) lança erro", () => {
    assert.throws(() => parseConditionsInput("[]"), /JSON válido/);
    assert.throws(() => parseConditionsInput('"texto"'), /JSON válido/);
    assert.throws(() => parseConditionsInput("42"), /JSON válido/);
    assert.throws(() => parseConditionsInput("null"), /JSON válido/);
  });
});

describe("escalationTargetsForPolicyChange", () => {
  const current = { agentId: "7", userId: "12" };

  test("none: esvazia ambos os targets", () => {
    assert.deepEqual(escalationTargetsForPolicyChange("none", current), { agentId: "", userId: "" });
  });

  test("agent: mantém agentId, esvazia userId", () => {
    assert.deepEqual(escalationTargetsForPolicyChange("agent", current), { agentId: "7", userId: "" });
  });

  test("human: mantém userId, esvazia agentId", () => {
    assert.deepEqual(escalationTargetsForPolicyChange("human", current), { agentId: "", userId: "12" });
  });

  test("agent_then_human: mantém ambos os targets", () => {
    assert.deepEqual(escalationTargetsForPolicyChange("agent_then_human", current), { agentId: "7", userId: "12" });
  });
});
