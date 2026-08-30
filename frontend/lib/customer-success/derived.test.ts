import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { healthTier, isFollowUpDue } from "./derived";

const NOW = new Date("2026-08-29T12:00:00.000Z");

describe("isFollowUpDue", () => {
  test("vencido quando next_contact_at está no passado", () => {
    assert.equal(
      isFollowUpDue({ nextContactAt: "2026-08-28T12:00:00.000Z", status: "active" }, NOW),
      true,
    );
  });

  test("não vencido quando next_contact_at está no futuro", () => {
    assert.equal(
      isFollowUpDue({ nextContactAt: "2026-08-30T12:00:00.000Z", status: "active" }, NOW),
      false,
    );
  });

  test("nunca vencido quando a conta está inativa", () => {
    assert.equal(
      isFollowUpDue({ nextContactAt: "2026-08-01T12:00:00.000Z", status: "inactive" }, NOW),
      false,
    );
  });

  test("não vencido quando não há next_contact_at", () => {
    assert.equal(isFollowUpDue({ nextContactAt: null, status: "active" }, NOW), false);
  });
});

describe("healthTier", () => {
  test("healthy quando >= 70", () => {
    assert.equal(healthTier(70), "healthy");
    assert.equal(healthTier(100), "healthy");
  });

  test("neutral quando entre 40 e 69", () => {
    assert.equal(healthTier(40), "neutral");
    assert.equal(healthTier(69), "neutral");
  });

  test("critical quando < 40", () => {
    assert.equal(healthTier(0), "critical");
    assert.equal(healthTier(39), "critical");
  });
});
