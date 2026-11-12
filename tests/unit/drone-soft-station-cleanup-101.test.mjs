import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { executeDroneBlockSoft } from "../../scripts/actions/drone-block.mjs";
import { rebaseTsc } from "../../scripts/actions/draft.mjs";
import { readStarship, patchStarship } from "../../scripts/starship/starship-state.mjs";
import { Content } from "../../scripts/content/loader.mjs";

async function setup(extra = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  Content.drones = JSON.parse(readFileSync("data/equipment/misc.json", "utf8")).drones;
  const crew = makeCharacter({ id: "operator", name: "Operator", owners: ["p1"] });
  crew.system.details = { level: { value: 8 } };
  const ship = makeShip({
    id: "target",
    name: "Target",
    sp: 10,
    stations: [{ id: "dc", type: "drone-console", grade: "commercial", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "dc" }],
    extra: {
      drones: [{ id: "d1", ref: "repair-drone", stationId: "dc", tscVersion: 1, deployed: true }],
      ...extra
    }
  });
  game.time.worldTime = 100;
  return { crew, ship, action: Content.actions.get("drone-block") };
}
const call = (ship, crew, user, extra = {}) =>
  executeDroneBlockSoft({
    user,
    ship,
    crewUuid: crew.uuid,
    stationId: "dc",
    options: { droneId: "d1" },
    action: Content.actions.get("drone-block"),
    ...extra
  });

test("soft Drone Block returns the drone, starts cooldown and records a manual receipt", async () => {
  const { crew, ship } = await setup();
  const res = await call(ship, crew, game.users.get("gm"));
  assert.equal(res.changed, true);
  assert.equal(res.resistance, 4);
  const d = readStarship(ship);
  assert.equal(d.drones[0].deployed, false);
  assert.equal(d.drones[0].availableAt, 700);
  assert.equal(d.droneBlockReceipts.length, 1);
  assert.equal(d.droneBlockReceipts[0].manual, true);
  assert.match(d.droneBlockReceipts[0].strikeId, /^manual-/);
});

test("soft Drone Block is available to the deploying player but not to unrelated users", async () => {
  const { crew, ship } = await setup();
  assert.equal((await call(ship, crew, game.users.get("p1"))).changed, true);
  const fresh = await setup();
  await assert.rejects(() => call(fresh.ship, fresh.crew, game.users.get("p2")), /permission|Permission/);
});

test("soft Drone Block refuses an aboard drone and Drone Shield Protocol consoles", async () => {
  const aboard = await setup({ drones: [{ id: "d1", ref: "repair-drone", stationId: "dc", tscVersion: 1, deployed: false }] });
  await assert.rejects(() => call(aboard.ship, aboard.crew, game.users.get("gm")));
  const protocol = await setup({ upgrades: [{ id: "u1", ref: "drone-shield-protocol", stationId: "dc" }] });
  await assert.rejects(() => call(protocol.ship, protocol.crew, game.users.get("gm")), /manual|Manual/);
});

test("removeStation drops bound drones and mine frequency, keeps upgrades unassigned", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerShipHandlers();
  const crew = makeCharacter({ id: "operator", name: "Operator", owners: ["p1"] });
  const ship = makeShip({
    id: "s",
    name: "Ship",
    stations: [{ id: "dc", type: "drone-console", grade: "commercial", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "dc" }],
    extra: {
      drones: [{ id: "d1", ref: "pyrotechnics-drone", stationId: "dc", tscVersion: 1, deployed: false }],
      upgrades: [{ id: "u1", ref: "mine-deployment-shell", stationId: "dc" }],
      droneMineFrequency: {
        "dc:deploy-starship-mine": { combatId: "c", round: 1 },
        "other:deploy-starship-mine": { combatId: "c", round: 1 }
      }
    }
  });
  const send = async (type, payload) => {
    let reply;
    await dispatchSocketMessage({ kind: "request", type, requestId: "x", payload }, "gm", {
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
  const ok = await send("removeStation", { shipUuid: ship.uuid, stationId: "dc" });
  assert.equal(ok.ok, true);
  const d = readStarship(ship);
  assert.equal(d.stations.length, 0);
  assert.deepEqual(d.drones, []);
  assert.deepEqual(Object.keys(d.droneMineFrequency), ["other:deploy-starship-mine"]);
  assert.equal(d.upgrades[0].stationId, null);
  assert.equal(d.crew[0].stationId, null);
});

test("removeStation refuses while a bound drone still has an armed mine on the map", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerShipHandlers();
  const ship = makeShip({
    id: "s",
    name: "Ship",
    stations: [{ id: "dc", type: "drone-console", grade: "commercial", helmedBy: null }],
    extra: {
      drones: [
        {
          id: "d1",
          ref: "pyrotechnics-drone",
          stationId: "dc",
          tscVersion: 1,
          deployed: true,
          mines: [{ id: "m1", state: "armed", zone: 2 }]
        }
      ]
    }
  });
  let reply;
  await dispatchSocketMessage(
    { kind: "request", type: "removeStation", requestId: "x", payload: { shipUuid: ship.uuid, stationId: "dc" } },
    "gm",
    { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (r) => (reply = r) }
  );
  assert.equal(reply.ok, false);
  assert.equal(readStarship(ship).stations.length, 1);
  assert.equal(readStarship(ship).drones.length, 1);
});

test("the extra situational-modifier dialog is off by default", async () => {
  installFoundryMock();
  const captured = {};
  const orig = game.settings.register;
  game.settings.register = (mod, key, data) => {
    captured[key] = data;
  };
  try {
    const { registerSettings } = await import("../../scripts/settings.mjs");
    registerSettings();
  } finally {
    game.settings.register = orig;
  }
  assert.equal(captured.nativeModifierDialog.type, Boolean);
  assert.equal(captured.nativeModifierDialog.default, false);
});

test("rebaseTsc merges disjoint combat edits and appends log entries", async () => {
  installFoundryMock();
  const base = {
    objects: [
      { key: "a", zone: 1 },
      { key: "b", zone: 2 }
    ],
    log: [{ t: 1, text: "old" }],
    knowledge: {}
  };
  const mine = {
    objects: [
      { key: "a", zone: 5 },
      { key: "b", zone: 2 }
    ],
    log: [
      { t: 1, text: "old" },
      { t: 2, text: "mine" }
    ],
    knowledge: { k1: { model: true } }
  };
  const current = {
    objects: [
      { key: "a", zone: 1 },
      { key: "b", zone: 9 }
    ],
    log: [
      { t: 1, text: "old" },
      { t: 3, text: "theirs" }
    ],
    knowledge: {}
  };
  const out = rebaseTsc(base, mine, current);
  assert.equal(out.objects.find((o) => o.key === "a").zone, 5);
  assert.equal(out.objects.find((o) => o.key === "b").zone, 9);
  assert.deepEqual(
    out.log.map((l) => l.text),
    ["old", "theirs", "mine"]
  );
  assert.deepEqual(out.knowledge.k1, { model: true });
});

test("rebaseTsc throws when both sides edited the same entity", async () => {
  installFoundryMock();
  const base = { objects: [{ key: "a", zone: 1 }] };
  const mine = { objects: [{ key: "a", zone: 5 }] };
  const current = { objects: [{ key: "a", zone: 9 }] };
  assert.throws(() => rebaseTsc(base, mine, current));
});

test("removeStation keeps mine records whose map cleanup failed (live contact)", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerShipHandlers();
  const ship = makeShip({
    id: "s",
    name: "Ship",
    stations: [{ id: "dc", type: "drone-console", grade: "commercial", helmedBy: null }]
  });
  const combat = makeStarshipCombat({
    objects: [
      {
        key: "Actor.hz",
        actorUuid: "Actor.hz",
        type: "hazard",
        name: "Mine",
        zone: 2,
        mineRef: { shipUuid: ship.uuid, droneId: "d1", mineId: "m1" }
      }
    ]
  });
  await patchStarship(ship, (d) => {
    d.drones = [
      {
        id: "d1",
        ref: "pyrotechnics-drone",
        stationId: "dc",
        tscVersion: 1,
        deployed: true,
        mines: [{ id: "m1", state: "removed", zone: 2, combatId: combat.id }]
      }
    ];
  });
  let reply;
  await dispatchSocketMessage(
    { kind: "request", type: "removeStation", requestId: "x", payload: { shipUuid: ship.uuid, stationId: "dc" } },
    "gm",
    { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (r) => (reply = r) }
  );
  assert.equal(reply.ok, false);
  assert.equal(readStarship(ship).drones.length, 1);
  assert.equal(readStarship(ship).stations.length, 1);
});

test("removeStation deletes resolved mine records once their projection is gone", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerShipHandlers();
  const ship = makeShip({
    id: "s",
    name: "Ship",
    stations: [{ id: "dc", type: "drone-console", grade: "commercial", helmedBy: null }]
  });
  const combat = makeStarshipCombat({ objects: [] });
  await patchStarship(ship, (d) => {
    d.drones = [
      {
        id: "d1",
        ref: "pyrotechnics-drone",
        stationId: "dc",
        tscVersion: 1,
        deployed: true,
        mines: [{ id: "m1", state: "removed", zone: 2, combatId: combat.id }]
      }
    ];
  });
  let reply;
  await dispatchSocketMessage(
    { kind: "request", type: "removeStation", requestId: "x", payload: { shipUuid: ship.uuid, stationId: "dc" } },
    "gm",
    { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (r) => (reply = r) }
  );
  assert.equal(reply.ok, true);
  assert.deepEqual(readStarship(ship).drones, []);
});
