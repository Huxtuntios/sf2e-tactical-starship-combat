import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";
import { AZTEC_ID, aztecsActive, canConvertToStarship, isAztecVehicle } from "../../scripts/integrations/aztecs.mjs";
import { CAUSODES_IDS, canConvert, checkCausodesConflict, isCausodesActor } from "../../scripts/integrations/causodes.mjs";
import { HOLODOCK_ID, holodockActive, openHolodock } from "../../scripts/integrations/holodock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";

test("Aztec siege protection applies only to vehicles carrying its exact flag", () => {
  installFoundryMock();
  const flags = { [AZTEC_ID]: { isSiegeWeapon: true } };
  const siege = { type: "vehicle", flags };
  const npc = { type: "npc", flags };

  assert.equal(isAztecVehicle(siege), true);
  assert.equal(canConvertToStarship(siege), false);
  assert.equal(isAztecVehicle(npc), false);
  assert.equal(canConvertToStarship(npc), true);
  assert.equal(canConvertToStarship({ type: "vehicle", flags: {} }), true);
  assert.equal(canConvertToStarship(null), true);
});

test("Aztec capability detection requires an active module without changing actor data", () => {
  installFoundryMock();
  game.modules.set(AZTEC_ID, { active: false });
  assert.equal(aztecsActive(), false);
  game.modules.get(AZTEC_ID).active = true;
  assert.equal(aztecsActive(), true);
});

test("HoloDock 1.0.1 opens only its zero-argument open API and ignores unsupported names", () => {
  installFoundryMock();
  const calls = [];
  game.modules.set(HOLODOCK_ID, { active: true });
  game.holodock = {
    openDashboard(...args) {
      calls.push(["openDashboard", args]);
      return "unsupported";
    },
    open(...args) {
      calls.push(["open", args]);
      return "opened";
    },
    openProfile(...args) {
      calls.push(["openProfile", args]);
      return "unsupported";
    },
    openShip(...args) {
      calls.push(["openShip", args]);
      return "unsupported";
    }
  };

  assert.equal(openHolodock({ uuid: "Actor.ship" }), "opened");
  assert.deepEqual(calls, [["open", []]]);
  assert.equal(holodockActive(), true);
});

test("HoloDock falls back to the module API and reports missing or partial APIs", () => {
  installFoundryMock();
  game.modules.set(HOLODOCK_ID, { active: true, api: { open: () => "module-api" } });
  assert.equal(openHolodock(), "module-api");

  delete game.modules.get(HOLODOCK_ID).api;
  game.holodock = { getProfiles: () => [] };
  assert.equal(openHolodock(), undefined);
  assert.equal(globalThis.__notes.length, 1);
  assert.equal(globalThis.__notes[0][0], "info");
  assert.match(globalThis.__notes[0][1], /exposes no open function/);

  delete game.holodock;
  openHolodock();
  assert.equal(globalThis.__notes.at(-1)[0], "warn");
  assert.match(globalThis.__notes.at(-1)[1], /not installed/);
});

test("a failing HoloDock open call never falls through to unsupported APIs", (t) => {
  installFoundryMock();
  t.mock.method(console, "warn", () => {});
  let unsupportedCalls = 0;
  game.modules.set(HOLODOCK_ID, { active: true });
  game.holodock = {
    open() {
      throw new Error("open failed");
    },
    openDashboard() {
      unsupportedCalls += 1;
    }
  };

  assert.equal(openHolodock(), undefined);
  assert.equal(unsupportedCalls, 0);
  assert.equal(globalThis.__notes.length, 1);
  assert.equal(globalThis.__notes[0][0], "info");
  assert.match(globalThis.__notes[0][1], /exposes no open function/);
});

test("Causodes actor types stay separate and conflict checks never share engine state", async (t) => {
  installFoundryMock();
  t.mock.method(console, "warn", () => {});
  const causodesState = Object.freeze({ marker: "causodes" });
  globalThis.ShipCombat = causodesState;
  t.after(() => {
    delete globalThis.ShipCombat;
  });

  for (const type of ["causodes-shipcombat-sf2e.ship", "causodes-shipcombat-sf2e.npcShip", "causodes-shipcombat-sf2e.shipOrdnance"]) {
    assert.equal(isCausodesActor({ type }), true);
    assert.equal(canConvert({ type }), false);
  }
  for (const type of ["vehicle", "npc", "character"]) {
    assert.equal(isCausodesActor({ type }), false);
    assert.equal(canConvert({ type }), true);
  }

  for (const id of CAUSODES_IDS) game.modules.set(id, { active: true });
  await game.settings.set(MODULE_ID, "causodesConflict", "warn");
  assert.equal(checkCausodesConflict(), true);
  assert.equal(globalThis.__notes.at(-1)[0], "warn");
  assert.match(globalThis.__notes.at(-1)[1], /Do not run both ship engines/);
  assert.equal(globalThis.ShipCombat, causodesState);

  globalThis.__notes.length = 0;
  await game.settings.set(MODULE_ID, "causodesConflict", "ignore");
  assert.equal(checkCausodesConflict(), true);
  assert.deepEqual(globalThis.__notes, []);

  game.user = game.users.get("p1");
  await game.settings.set(MODULE_ID, "causodesConflict", "warn");
  assert.equal(checkCausodesConflict(), true);
  assert.deepEqual(globalThis.__notes, []);
});

test("Causodes conflict detection is inert when neither module is active", () => {
  installFoundryMock();
  game.modules.set(CAUSODES_IDS[0], { active: false });
  game.modules.set(CAUSODES_IDS[1], { active: false });
  assert.equal(checkCausodesConflict(), false);
  assert.deepEqual(globalThis.__notes, []);
});
