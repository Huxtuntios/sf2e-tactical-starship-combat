import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changeDrone, eligibleDroneMovements } from "../../scripts/engine/drone-state.mjs";
import { deployMine } from "../../scripts/actions/drone-actions.mjs";
import { stageDroneBlock } from "../../scripts/actions/drone-block.mjs";
import { installFoundryMock, loadContentFromDisk, makeCharacter, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

const definition = JSON.parse(readFileSync("data/stations/stations.json")).stations.find((s) => s.id === "drone-console");
const droneTypes = JSON.parse(readFileSync("data/equipment/misc.json")).drones;
const env = { definition, droneTypes, worldTime: 100 };
const drone = (id, deployed = false) => ({ id, ref: "repair-drone", stationId: "s", tscVersion: 1, deployed });
const base = () => ({ stations: [{ id: "s", type: "drone-console", grade: "commercial" }], drones: [drone("a")] });

test("over-capacity or unknown capacity blocks new deployment, not retrieval", () => {
  const data = base();
  data.drones.push(drone("b", true));
  const before = structuredClone(data);
  assert.throws(() => changeDrone(data, "deploy", { id: "a", stationId: "s" }, env), /capacity/);
  assert.deepEqual(data, before);
  assert.equal(changeDrone(data, "retrieve", { id: "b", stationId: "s" }, env), true);
  data.stations[0].grade = "unknown";
  assert.throws(() => changeDrone(data, "deploy", { id: "a", stationId: "s" }, env), /capacity/);
  assert.deepEqual(eligibleDroneMovements(data, "s", "deploy", env), []);
});

test("duplicate drone or station IDs refuse transitions without changing unknown data", () => {
  const data = base();
  data.drones.push({ ...drone("a"), stationId: "other", custom: { untouched: true } });
  const before = structuredClone(data);
  assert.throws(() => changeDrone(data, "deploy", { id: "a", stationId: "s" }, env), /legacy/);
  assert.throws(() => changeDrone(data, "add", { id: "a", stationId: "s", ref: "repair-drone" }, env), /legacy/);
  assert.deepEqual(eligibleDroneMovements(data, "s", "deploy", env), []);
  assert.deepEqual(data, before);
  data.drones.pop();
  data.stations.push({ id: "s", type: "generator" });
  assert.throws(() => changeDrone(data, "deploy", { id: "a", stationId: "s" }, env), /station/);
});

test("preview is nonmutating and reflects cooldown, full inventory and retrieval", () => {
  const data = base();
  data.drones[0].availableAt = 101;
  const before = structuredClone(data);
  assert.deepEqual(eligibleDroneMovements(data, "s", "deploy", env), []);
  assert.deepEqual(
    eligibleDroneMovements(data, "s", "deploy", { ...env, worldTime: 101 }).map((d) => d.id),
    ["a"]
  );
  assert.deepEqual(data, before);
  data.drones[0].deployed = true;
  assert.deepEqual(
    eligibleDroneMovements(data, "s", "retrieve", env).map((d) => d.id),
    ["a"]
  );
});

test("mine placement and Drone Block reject ambiguous IDs before modifying state", async () => {
  installFoundryMock();
  const combat = makeStarshipCombat({ objects: [{ key: "Actor.ship", zone: 3 }] });
  const data = {
    drones: [
      { ...drone("a", true), ref: "pyrotechnics-drone" },
      { ...drone("a", true), stationId: "else" }
    ]
  };
  const before = structuredClone(data);
  assert.throws(
    () => deployMine(data, { stationId: "s", droneId: "a", mineId: "m", shipUuid: "Actor.ship", crewUuid: "Actor.pc", combat }),
    /legacy/
  );
  assert.deepEqual(data, before);
  const blockData = { stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.pc" }], drones: data.drones, upgrades: [] };
  const blockBefore = structuredClone(blockData);
  const draft = { ship: async () => ({ data: blockData, before: blockBefore }) };
  await assert.rejects(
    stageDroneBlock({
      draft,
      targetUuid: "Actor.ship",
      stationId: "s",
      droneId: "a",
      strikeId: "hit",
      crew: { uuid: "Actor.pc", level: 8 },
      worldTime: 100
    })
  );
  assert.deepEqual(blockData, blockBefore);
});

test("concurrent deploy, no-op and UI availability use current GM state", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const actor = makeCharacter({ id: "op", name: "Operator", owners: ["p1"] });
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    owners: ["p1"],
    stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: actor.uuid }],
    crew: [{ actorUuid: actor.uuid, role: "crew", stationId: "s" }],
    extra: { drones: [drone("a")] }
  });
  const combat = makeStarshipCombat();
  const { executeAction } = await import("../../scripts/actions/action-engine.mjs");
  const { readStarship } = await import("../../scripts/starship/starship-state.mjs");
  const { previewAction } = await import("../../scripts/ui/action-runner.mjs");
  const { Content } = await import("../../scripts/content/loader.mjs");
  Content.drones = droneTypes;
  const action = Content.actions.get("deploy-drone");
  const preview = () => previewAction(action, { ship, crew: actor, station: readStarship(ship).stations[0], combat });
  assert.equal(preview().enabled, true);
  assert.equal(previewAction(action, { ship, crew: null, station: readStarship(ship).stations[0], combat }).enabled, true);
  const req = {
    shipUuid: ship.uuid,
    crewUuid: actor.uuid,
    stationId: "s",
    actionId: "deploy-drone",
    options: { droneId: "a" },
    user: game.users.get("p1")
  };
  const results = await Promise.all([executeAction(req), executeAction(req)]);
  assert.deepEqual(results.map((r) => r.changed).sort(), [false, true]);
  assert.equal(preview().enabled, false);
});

test("a duplicate mine receipt is not mistaken for a successful retry", () => {
  installFoundryMock();
  const combat = makeStarshipCombat({ objects: [{ key: "Actor.ship", zone: 3 }] });
  const mine = { id: "m", droneId: "a", shipUuid: "Actor.ship", operatorUuid: "Actor.pc", state: "armed", zone: 3, combatId: combat.id };
  const data = { drones: [{ ...drone("a", true), ref: "pyrotechnics-drone", mines: [mine, { ...mine }] }] };
  const before = structuredClone(data);
  assert.throws(
    () => deployMine(data, { stationId: "s", droneId: "a", mineId: "m", shipUuid: "Actor.ship", crewUuid: "Actor.pc", combat }),
    /legacy/
  );
  assert.deepEqual(data, before);
});

test("authoritative deploy rejects over-capacity without history, actor write or action card", async () => {
  installFoundryMock();
  const content = await loadContentFromDisk();
  content.drones = droneTypes;
  const actor = makeCharacter({ id: "op", name: "Operator", owners: ["p1"] });
  const ship = makeShip({
    id: "over",
    name: "Ship",
    owners: ["p1"],
    stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: actor.uuid }],
    crew: [{ actorUuid: actor.uuid, role: "crew", stationId: "s" }],
    extra: { drones: [drone("a"), drone("b")] }
  });
  makeStarshipCombat();
  const { executeAction } = await import("../../scripts/actions/action-engine.mjs");
  const { historyEntries } = await import("../../scripts/history/history.mjs");
  const before = structuredClone(ship.flags["sf2e-tactical-starship-combat"].starship);
  const writes = globalThis.__writes.length,
    messages = game.messages.size,
    history = historyEntries(ship.uuid).length;
  await assert.rejects(
    executeAction({
      shipUuid: ship.uuid,
      crewUuid: actor.uuid,
      stationId: "s",
      actionId: "deploy-drone",
      options: { droneId: "a" },
      user: game.users.get("p1")
    })
  );
  assert.deepEqual(ship.flags["sf2e-tactical-starship-combat"].starship, before);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  assert.equal(historyEntries(ship.uuid).length, history);
});
