import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

test("same authenticated socket request cannot redeploy after a later retrieve", async () => {
  installFoundryMock();
  const content = await loadContentFromDisk();
  content.drones = JSON.parse(readFileSync("data/equipment/misc.json", "utf8")).drones;
  const operator = makeCharacter({ id: "pilot", name: "Pilot", owners: ["p1"] });
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    owners: ["p1"],
    stations: [{ id: "console", type: "drone-console", grade: "commercial", helmedBy: operator.uuid }],
    crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "console" }],
    extra: { drones: [{ id: "d1", stationId: "console", tscVersion: 1, ref: "repair-drone", deployed: false }] }
  });
  makeStarshipCombat();
  const { registerActionHandlers } = await import("../../scripts/actions/action-engine.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  const { readStarship } = await import("../../scripts/starship/starship-state.mjs");
  const { historyEntries } = await import("../../scripts/history/history.mjs");
  registerActionHandlers();
  const payload = {
    shipUuid: ship.uuid,
    crewUuid: operator.uuid,
    stationId: "console",
    actionId: "deploy-drone",
    options: { droneId: "d1" }
  };
  const send = async (requestId, body = payload, user = "p1") => {
    let reply;
    await dispatchSocketMessage({ kind: "request", type: "executeAction", requestId, payload: body }, user, {
      users: game.users,
      selfId: "gm",
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (r) => {
        reply = r;
      }
    });
    return reply;
  };
  const simultaneous = await Promise.all([send("req-deploy"), send("req-deploy")]);
  assert.ok(simultaneous.every((r) => r.ok && r.result.changed));
  assert.equal(readStarship(ship).drones[0].deployed, true);
  assert.equal(historyEntries(ship.uuid).length, 1);
  assert.equal((await send("req-retrieve", { ...payload, actionId: "retrieve-drone" })).ok, true);
  assert.equal(readStarship(ship).drones[0].deployed, false);
  const writes = globalThis.__writes.length,
    messages = game.messages.size,
    history = historyEntries(ship.uuid).length;
  const replay = await send("req-deploy");
  assert.equal(replay.ok, true);
  assert.equal(readStarship(ship).drones[0].deployed, false);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  assert.equal(historyEntries(ship.uuid).length, history);
  assert.equal((await send("req-deploy", { ...payload, options: { droneId: "other" } })).ok, false);
  assert.equal((await send("req-deploy", payload, "p2")).ok, false);
  assert.equal(readStarship(ship).drones[0].deployed, false);
  assert.equal((await send("req-new")).result.changed, true);
  assert.equal(readStarship(ship).drones[0].deployed, true);
});
