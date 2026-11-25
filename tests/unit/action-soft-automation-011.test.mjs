import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeCharacter, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { registerHandler } from "../../scripts/socket.mjs";

const M = "sf2e-tactical-starship-combat";

async function scenario(overrides = {}) {
  installFoundryMock();
  foundry.utils.flattenObject = (value) => value;
  await loadContentFromDisk();
  const crew = makeCharacter({ id: "operator", name: "Operator", owners: ["p1"] });
  const ship = makeShip({
    id: "aurora",
    name: "Aurora",
    owners: ["p1"],
    stations: [{ id: "pilot", name: "Pilot's Console", type: "pilot", grade: "commercial", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, name: crew.name, role: "crew", stationId: "pilot", userId: "p1" }]
  });
  makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 1, detection: { party: "identified" } }] });
  const action = {
    id: "soft-test",
    name: "Soft Test",
    station: "pilot",
    cost: [1, 2],
    targeting: { type: "self" },
    text: "Original action rules.",
    effects: [
      { type: "applyEffect", target: "self", effect: { slug: "soft-test", label: "Soft effect", duration: { unit: "round", value: 1 } } }
    ],
    ...overrides
  };
  const requests = [];
  registerHandler("executeAction", async ({ payload }) => {
    requests.push(payload);
    return { ok: true };
  });
  const { runAction } = await import("../../scripts/ui/action-runner.mjs");
  return { action, crew, ship, requests, ctx: { ship, crew, station: ship.flags[M].starship.stations[0] }, runAction };
}

test("only meaningful automatic changes require soft confirmation", async () => {
  installFoundryMock();
  const { requiresActionConfirmation } = await import("../../scripts/ui/action-runner.mjs");
  assert.equal(typeof requiresActionConfirmation, "function");
  assert.equal(requiresActionConfirmation({ effects: [{ type: "applyEffect" }] }), true);
  assert.equal(requiresActionConfirmation({ effects: [{ type: "manual", text: "Suggest only" }] }), false);
  assert.equal(requiresActionConfirmation({ id: "deploy-drone", effects: [{ type: "manual" }] }), true);
  assert.equal(requiresActionConfirmation({ builtin: "area-fire" }), true);
  assert.equal(requiresActionConfirmation({ builtin: "strike", targeting: { type: "starship" } }), false);
});

test("confirm executes once with edited options and shows source plus known consequences", async () => {
  const { action, requests, ctx, runAction } = await scenario();
  let prompts = 0;
  let confirmation;
  foundry.applications.api.DialogV2.prompt = async () => {
    prompts++;
    return { actions: 2 };
  };
  foundry.applications.api.DialogV2.confirm = async (config) => {
    confirmation = config;
    return "confirm";
  };
  await runAction(action, ctx);
  assert.equal(prompts, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.actions, 2);
  assert.ok(confirmation, "meaningful changes must open a confirmation dialog");
  assert.match(confirmation.content, /Original action rules\./);
  assert.match(confirmation.content, /Consequences:/);
  assert.match(confirmation.content, /Soft effect/);
  assert.ok(confirmation.buttons.some((button) => button.action === "edit"));
  assert.equal(confirmation.no.default, true, "cancel is the safe default focus");
  assert.equal(globalThis.__writes.length, 0);
  assert.equal(game.messages.size, 0);
});

test("cancel and dialog dismissal leave requests and game state untouched", async () => {
  for (const choice of ["cancel", null]) {
    const { action, requests, ctx, runAction } = await scenario();
    foundry.applications.api.DialogV2.prompt = async () => ({ actions: 1 });
    foundry.applications.api.DialogV2.confirm = async () => choice;
    await runAction(action, ctx);
    assert.equal(requests.length, 0);
    assert.equal(globalThis.__writes.length, 0);
    assert.equal(game.messages.size, 0);
  }
});

test("edit reopens action options and only the confirmed edited request is sent", async () => {
  const { action, requests, ctx, runAction } = await scenario();
  const choices = ["edit", "confirm"];
  const options = [{ actions: 1 }, { actions: 2 }];
  let prompts = 0;
  foundry.applications.api.DialogV2.prompt = async () => options[prompts++];
  foundry.applications.api.DialogV2.confirm = async () => choices.shift();
  await runAction(action, ctx);
  assert.equal(prompts, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.actions, 2);
});

test("manual-only suggestions stay automatic without a confirmation dialog", async () => {
  const { action, requests, ctx, runAction } = await scenario({
    effects: [{ type: "manual", text: "Suggest only" }]
  });
  foundry.applications.api.DialogV2.prompt = async () => ({ actions: 1 });
  foundry.applications.api.DialogV2.confirm = async () => assert.fail("manual suggestions must not confirm");
  await runAction(action, ctx);
  assert.equal(requests.length, 1);
});

test("a confirmed request that fails validation creates no document, resource, target or effect changes", async () => {
  const { ship, crew, requests, ctx, runAction } = await scenario({ id: "repair-hull-drone", cost: 2 });
  registerHandler("executeAction", async ({ payload }) => {
    requests.push(payload);
    throw new Error("validation failed");
  });
  foundry.applications.api.DialogV2.prompt = async () => ({});
  foundry.applications.api.DialogV2.confirm = async () => "confirm";
  const before = structuredClone(ship.flags[M]);
  await runAction({ id: "repair-hull-drone", name: "Repair Hull", station: "drone-console", cost: 2, text: "Repair rules." }, ctx);
  assert.equal(requests.length, 1);
  assert.equal(globalThis.__writes.length, 0);
  assert.equal(game.messages.size, 0);
  assert.deepEqual(ship.flags[M], before);
  assert.ok(globalThis.__notes.some(([level, message]) => level === "error" && /validation failed/.test(message)));
  assert.equal(crew.uuid, "Actor.operator");
});

test("confirmation preserves warn and strict rule-enforcement settings", async () => {
  const { action, requests, ctx, runAction } = await scenario();
  const { strictRulesFor } = await import("../../scripts/actions/action-engine.mjs");
  for (const mode of ["warn", "strict"]) {
    await game.settings.set(M, "ruleEnforcement", mode);
    foundry.applications.api.DialogV2.prompt = async () => ({ actions: 1 });
    foundry.applications.api.DialogV2.confirm = async () => "cancel";
    await runAction(action, ctx);
    assert.equal(game.settings.get(M, "ruleEnforcement"), mode);
    assert.equal(strictRulesFor(false), mode === "strict");
  }
  assert.equal(requests.length, 0);
});
