import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { can, canAll, canAny } from "./permissions";

describe("can", () => {
  test("true quando possui a permissão", () => {
    assert.equal(can(["clients.read", "clients.create"], "clients.create"), true);
  });

  test("false quando não possui a permissão", () => {
    assert.equal(can(["clients.read"], "clients.create"), false);
  });

  test("false com lista de permissões vazia", () => {
    assert.equal(can([], "clients.create"), false);
  });
});

describe("canAny", () => {
  test("true quando possui pelo menos uma das permissões", () => {
    assert.equal(canAny(["clients.read"], ["clients.create", "clients.read"]), true);
  });

  test("false quando não possui nenhuma das permissões", () => {
    assert.equal(canAny(["leads.read"], ["clients.create", "clients.update"]), false);
  });

  test("false quando a lista de permissões exigidas é vazia", () => {
    assert.equal(canAny(["clients.read"], []), false);
  });

  test("false quando a lista de permissões do usuário é vazia", () => {
    assert.equal(canAny([], ["clients.read"]), false);
  });
});

describe("canAll", () => {
  test("true quando possui todas as permissões", () => {
    assert.equal(canAll(["projects.read", "projects.manage"], ["projects.read", "projects.manage"]), true);
  });

  test("false quando falta pelo menos uma permissão", () => {
    assert.equal(canAll(["projects.read"], ["projects.read", "projects.manage"]), false);
  });

  test("true quando a lista de permissões exigidas é vazia (vacuamente verdadeiro)", () => {
    assert.equal(canAll(["clients.read"], []), true);
  });

  test("false quando a lista de permissões do usuário é vazia e há exigências", () => {
    assert.equal(canAll([], ["clients.read"]), false);
  });
});
