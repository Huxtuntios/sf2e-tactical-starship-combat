import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deployMine } from "../../scripts/actions/drone-actions.mjs";
import { actionsForStation } from "../../scripts/content/loader.mjs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

const moduleId = "sf2e-tactical-starship-combat";
const types = JSON.parse(readFileSync("data/equipment/misc.json")).drones;
const data = () => ({ drones: [{ id: "d1", stationId: "s", tscVersion: 1, ref: "pyrotechnics-drone", deployed: true }] });

test("mine: same zone, round, idempotency, model and combat-bound map", () => {
  installFoundryMock();
  const combat = makeStarshipCombat({ objects: [{ key: "Actor.ship", zone: 3 }] });
  const d = data();
  const args = { stationId: "s", droneId: "d1", mineId: "m1", shipUuid: "Actor.ship", crewUuid: "Actor.pc", combat };
  assert.equal(deployMine(d, args), true);
  assert.equal(deployMine(d, args), false);
  assert.deepEqual(d.drones[0].mines[0], {
    id: "m1",
    droneId: "d1",
    shipUuid: "Actor.ship",
    operatorUuid: "Actor.pc",
    combatId: combat.id,
    zone: 3,
    state: "armed"
  });
  assert.throws(() => deployMine(d, { ...args, mineId: "m2" }), /mineZone/);
  combat.flags[moduleId].tsc.objects[0].zone = 4;
  assert.throws(() => deployMine(d, { ...args, mineId: "m2" }), /mineRound/);
  combat.round = 2;
  assert.equal(deployMine(d, { ...args, mineId: "m2" }), true);
  d.drones[0].ref = "repair-drone";
  assert.throws(() => deployMine(d, { ...args, mineId: "m3" }), /legacy/);
  d.drones[0].ref = "pyrotechnics-drone";
  d.drones[0].deployed = false;
  assert.throws(() => deployMine(d, { ...args, mineId: "m3" }), /legacy/);
  d.drones[0].deployed = true;
  const nextCombat = makeStarshipCombat({ objects: [{ key: "Actor.ship", zone: 5 }], round: 3 });
  assert.throws(() => deployMine(d, { ...args, combat: nextCombat, mineId: "m3" }), /mineOldMap/);
});

test("mine action: appears only for a deployed pyrotechnics drone; authorized action persists once", async () => {
  installFoundryMock();
  const content = await loadContentFromDisk();
  content.drones = types;
  const actor = makeCharacter({ id: "pilot", name: "Pilot", owners: ["p1"] });
  const ship = makeShip({
    id: "s1",
    name: "Ship",
    owners: ["p1"],
    stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: actor.uuid }],
    crew: [{ actorUuid: actor.uuid, role: "crew", stationId: "s" }],
    extra: data()
  });
  makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  const { readStarship } = await import("../../scripts/starship/starship-state.mjs");
  const current = readStarship(ship);
  const available = (d) =>
    actionsForStation("drone-console", "commercial", () => 0, { data: d, station: d.stations[0] }).some(
      (a) => a.id === "deploy-starship-mine"
    );
  assert.equal(available(current), true);
  assert.equal(available({ ...current, drones: [{ ...current.drones[0], deployed: false }] }), false);
  assert.equal(available({ ...current, drones: { old: true } }), false);
  const { executeAction } = await import("../../scripts/actions/action-engine.mjs");
  const { historyEntries } = await import("../../scripts/history/history.mjs");
  const req = {
    shipUuid: ship.uuid,
    crewUuid: actor.uuid,
    stationId: "s",
    actionId: "deploy-starship-mine",
    options: { droneId: "d1", mineId: "m1" }
  };
  await assert.rejects(executeAction({ ...req, user: game.users.get("p2") }));
  assert.equal((await executeAction({ ...req, user: game.users.get("p1") })).changed, true);
  assert.equal(readStarship(ship).drones[0].mines[0].zone, 3);
  const writes = globalThis.__writes.length,
    messages = game.messages.size,
    history = historyEntries(ship.uuid).length;
  assert.equal((await executeAction({ ...req, user: game.users.get("p1") })).changed, false);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  assert.equal(historyEntries(ship.uuid).length, history);
  assert.equal(historyEntries(ship.uuid)[0].flags[moduleId].history.undoable, false);
});
