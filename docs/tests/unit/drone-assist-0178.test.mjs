import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { applyGuidedMineTarget } from "../../scripts/actions/mine-apply.mjs";
import { applyHarryEffect } from "../../scripts/actions/harry-apply.mjs";
import { isExpired } from "../../scripts/starship/effects.mjs";

async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
  const ship = makeShip({ id: "target", name: "Target", role: "npc", sp: 10, hp: 30, extra: { otherLegacy: { test: 5 }, hardness: 2 } });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 1 }], round: 1 });
  return { ship, combat };
}
function mineArgs(ship, combat, overrides = {}) {
  return {
    targetUuid: ship.uuid,
    sourceUuid: "Actor.source",
    droneId: "d",
    mineId: "m",
    combatId: combat.id,
    amount: 8,
    type: "fire",
    degree: 1,
    validate: async () => true,
    ...overrides
  };
}
test("mine damage goes through shields and hardness; atomic receipt and legacy fields survive", async () => {
  const { ship, combat } = await setup();
  const r = await applyGuidedMineTarget(mineArgs(ship, combat));
  assert.deepEqual(r, { already: false, shield: 6, hull: 0 });
  assert.equal(readStarship(ship).sp.value, 4);
  assert.deepEqual(readStarship(ship).otherLegacy, { test: 5 });
  assert.equal(readStarship(ship).tscMineDamageReceipts.length, 1);
  const before = globalThis.__writes.length;
  assert.deepEqual(await applyGuidedMineTarget(mineArgs(ship, combat, { amount: 20 })), { already: true });
  assert.equal(globalThis.__writes.length, before);
});
test("concurrent duplicate mine applications debit once", async () => {
  const { ship, combat } = await setup();
  const results = await Promise.all([applyGuidedMineTarget(mineArgs(ship, combat)), applyGuidedMineTarget(mineArgs(ship, combat))]);
  assert.equal(results.filter((r) => r.already).length, 1);
  assert.equal(readStarship(ship).sp.value, 4);
});
test("mine application refuses stale, bad, player, read-only and full stores without writes", async () => {
  const { ship, combat } = await setup();
  const before = globalThis.__writes.length;
  await assert.rejects(applyGuidedMineTarget(mineArgs(ship, combat, { validate: async () => false })));
  await assert.rejects(applyGuidedMineTarget(mineArgs(ship, combat, { amount: -1 })));
  ship.pack = "pack";
  await assert.rejects(applyGuidedMineTarget(mineArgs(ship, combat)));
  delete ship.pack;
  game.user = game.users.get("p1");
  await assert.rejects(applyGuidedMineTarget(mineArgs(ship, combat)));
  game.user = game.users.get("gm");
  ship.flags["sf2e-tactical-starship-combat"].starship.tscMineDamageReceipts = Array(512).fill("x");
  await assert.rejects(applyGuidedMineTarget(mineArgs(ship, combat)));
  assert.equal(globalThis.__writes.length, before);
});
test("Harry failure and critical failure use existing module effects once and preserve old data", async () => {
  for (const [degree, conditions] of [
    [1, ["off-kilter"]],
    [0, ["off-kilter", "off-guard"]]
  ]) {
    const { ship, combat } = await setup();
    const args = {
      targetUuid: ship.uuid,
      sourceUuid: "Actor.source",
      messageId: `msg${degree}`,
      degree,
      combatId: combat.id,
      validate: async () => true
    };
    assert.equal(await applyHarryEffect(args), true);
    assert.deepEqual(readStarship(ship).effects.at(-1).conditions, conditions);
    assert.deepEqual(readStarship(ship).otherLegacy, { test: 5 });
    const before = globalThis.__writes.length;
    assert.equal(await applyHarryEffect(args), false);
    assert.equal(globalThis.__writes.length, before);
  }
});
test("Harry success refuses ambiguous target turn and anchors an unambiguous next start", async () => {
  const { ship, combat } = await setup();
  const args = {
    targetUuid: ship.uuid,
    sourceUuid: "Actor.source",
    messageId: "msg2",
    degree: 2,
    combatId: combat.id,
    validate: async () => true
  };
  const before = globalThis.__writes.length;
  await assert.rejects(applyHarryEffect(args));
  assert.equal(globalThis.__writes.length, before);
  const other = makeShip({ id: "other", name: "Other" });
  await combat.createEmbeddedDocuments("Combatant", [
    { _id: "othercb", actorId: other.id, initiative: 20 },
    { _id: "targetcb", actorId: ship.id, initiative: 10 }
  ]);
  combat.turn = 0;
  assert.equal(await applyHarryEffect(args), true);
  const fx = readStarship(ship).effects.at(-1);
  assert.equal(fx.timing.round, 1);
  assert.equal(fx.timing.combatantId, "targetcb");
  assert.equal(isExpired(fx, { id: combat.id, round: 1, turn: 1, turns: combat.turns }), true);
});
test("Harry refuses invalid degree, stale encounter and non-GM without writes", async () => {
  const { ship, combat } = await setup();
  const args = {
    targetUuid: ship.uuid,
    sourceUuid: "Actor.source",
    messageId: "msg",
    degree: 1,
    combatId: combat.id,
    validate: async () => true
  };
  const before = globalThis.__writes.length;
  await assert.rejects(applyHarryEffect({ ...args, degree: 3 }));
  await assert.rejects(applyHarryEffect({ ...args, validate: async () => false }));
  game.user = game.users.get("p1");
  await assert.rejects(applyHarryEffect(args));
  assert.equal(globalThis.__writes.length, before);
});

test("Intercept hint includes only unambiguous deployed available drones at an operating helmed console", async () => {
  const { eligibleInterceptHints } = await import("../../scripts/actions/intercept-hint.mjs");
  const data = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.p" }],
    drones: [
      { id: "one", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true },
      { id: "used", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true, tscInterceptUsed: true },
      { id: "aboard", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: false },
      { id: "dup", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true },
      { id: "dup", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true }
    ]
  };
  assert.deepEqual(eligibleInterceptHints(data), ["one"]);
  data.stations.push({ ...data.stations[0] });
  assert.deepEqual(eligibleInterceptHints(data), []);
  data.stations.pop();
  data.stations[0].malfunctioning = true;
  assert.deepEqual(eligibleInterceptHints(data), []);
});

test("pet cabin records a confirmed living Tiny pet and ends on time, zero HP or loss of helm", async () => {
  const { updatePetCabin, petOnboardStatus } = await import("../../scripts/actions/pet-onboard.mjs");
  const data = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op", old: 42 }],
    upgrades: [{ ref: "pet-drone-shell", stationId: "s" }],
    other: 7
  };
  const pet = {
    uuid: "Actor.pet",
    documentName: "Actor",
    system: { traits: { size: { value: "tiny" } }, attributes: { hp: { value: 10 } } }
  };
  const input = { stationId: "s", pet, operatorUuid: "Actor.op", op: "start", operationId: "petStart123", now: 100, confirmed: true };
  assert.equal(updatePetCabin(data, input), true);
  assert.equal(updatePetCabin(data, input), false);
  const st = data.stations[0];
  assert.equal(st.old, 42);
  assert.equal(data.other, 7);
  assert.equal(petOnboardStatus(data, st, pet, 159), true);
  assert.equal(petOnboardStatus(data, st, pet, 160), false);
  pet.system.attributes.hp.value = 0;
  assert.equal(petOnboardStatus(data, st, pet, 120), false);
  pet.system.attributes.hp.value = 10;
  st.helmedBy = null;
  assert.equal(petOnboardStatus(data, st, pet, 120), false);
  const end = { stationId: "s", op: "end", operationId: "petEnd0001", operatorUuid: "Actor.op", sessionId: "petStart123", now: 120 };
  assert.equal(updatePetCabin(data, end), true);
  assert.equal(updatePetCabin(data, end), false);
  assert.equal(st.tscPetOnboard, undefined);
});
test("pet cabin rejects missing upgrade, confirmation, wrong size and occupied cabin", async () => {
  const { updatePetCabin } = await import("../../scripts/actions/pet-onboard.mjs");
  const pet = {
    uuid: "Actor.pet",
    documentName: "Actor",
    system: { traits: { size: { value: "tiny" } }, attributes: { hp: { value: 1 } } }
  };
  const base = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op" }],
    upgrades: [{ ref: "pet-drone-shell", stationId: "s" }]
  };
  const p = { stationId: "s", pet, operatorUuid: "Actor.op", op: "start", operationId: "petStart123", now: 100, confirmed: true };
  for (const [d, x] of [
    [{ ...base, upgrades: [] }, p],
    [structuredClone(base), { ...p, confirmed: false }],
    [structuredClone(base), { ...p, pet: { ...pet, system: { ...pet.system, traits: { size: { value: "med" } } } } }]
  ])
    assert.throws(() => updatePetCabin(d, x));
  const d = structuredClone(base);
  updatePetCabin(d, p);
  assert.throws(() => updatePetCabin(d, { ...p, operationId: "petStart456", pet: { ...pet, uuid: "Actor.other" } }));
});

test("mine reaction detects entering and leaving, but never same-zone no-op or unrelated endpoints", async () => {
  const { mineZoneCrossing } = await import("../../scripts/sensor/mine-reaction-hint.mjs");
  assert.equal(mineZoneCrossing(2, 3, 3), true);
  assert.equal(mineZoneCrossing(3, 2, 3), true);
  assert.equal(mineZoneCrossing(3, 3, 3), false);
  assert.equal(mineZoneCrossing(1, 4, 2), false);
  assert.equal(mineZoneCrossing(null, 3, 3), false);
});

test("manual protocol tracks each drone, prevents duplicate Strike, fetches and checks two whole rounds", async () => {
  const { updateProtocolDrone } = await import("../../scripts/actions/protocol-manual.mjs");
  const { changeDrone } = await import("../../scripts/engine/drone-state.mjs");
  const data = {
    stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: "Actor.op" }],
    upgrades: [{ ref: "drone-shield-protocol", stationId: "s" }],
    drones: [
      { id: "d1", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true, old: "keep" },
      { id: "d2", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true }
    ]
  };
  const combat = { id: "combat", round: 3, turn: 1, turns: [{ id: "a" }, { id: "b" }] };
  const b = {
    stationId: "s",
    droneId: "d1",
    operatorUuid: "Actor.op",
    operationId: "protocol111",
    op: "block",
    strikeRef: "strike-1",
    combat,
    confirmed: true
  };
  assert.equal(updateProtocolDrone(data, b), true);
  assert.equal(updateProtocolDrone(data, b), false);
  assert.equal(data.drones[0].tscProtocolBlocks, 1);
  assert.equal(data.drones[1].tscProtocolBlocks, undefined);
  assert.equal(updateProtocolDrone(data, { ...b, droneId: "d2", operationId: "protocol222" }), false);
  assert.equal(updateProtocolDrone(data, { ...b, operationId: "protocol333", strikeRef: "strike-2" }), true);
  assert.throws(() => updateProtocolDrone(data, { ...b, operationId: "protocol444", strikeRef: "strike-3" }));
  const fetch = { ...b, op: "fetch", operationId: "protocol555", strikeRef: "" };
  assert.equal(updateProtocolDrone(data, fetch), true);
  assert.equal(data.drones[0].deployed, false);
  assert.equal(data.drones[0].old, "keep");
  const env = {
    definition: { advancement: [{ grade: "commercial", drones: 4 }] },
    droneTypes: [{ id: "scramble-drone" }],
    worldTime: 10,
    combat
  };
  assert.throws(() => changeDrone(data, "deploy", { stationId: "s", id: "d1" }, env), /cooldown/);
  combat.round = 5;
  combat.turn = 0;
  assert.throws(() => changeDrone(data, "deploy", { stationId: "s", id: "d1" }, env), /cooldown/);
  combat.turn = 1;
  assert.equal(changeDrone(data, "deploy", { stationId: "s", id: "d1" }, env), true);
});
test("protocol rejects missing upgrade, invalid drone and cannot Fetch without a recorded block", async () => {
  const { updateProtocolDrone } = await import("../../scripts/actions/protocol-manual.mjs");
  const combat = { id: "c", round: 1, turn: 0, turns: [{ id: "a" }] };
  const data = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op" }],
    upgrades: [{ ref: "drone-shield-protocol", stationId: "s" }],
    drones: [{ id: "d", stationId: "s", ref: "repair-drone", tscVersion: 1, deployed: true }]
  };
  const p = {
    stationId: "s",
    droneId: "d",
    operatorUuid: "Actor.op",
    operationId: "protocol123",
    op: "block",
    strikeRef: "s1",
    combat,
    confirmed: true
  };
  assert.throws(() => updateProtocolDrone({ ...data, upgrades: [] }, p));
  assert.throws(() => updateProtocolDrone(data, { ...p, op: "fetch" }));
  assert.throws(() => updateProtocolDrone(data, { ...p, confirmed: false }));
});

test("guided mine review applies chosen result and updates the private progress card", async () => {
  const { guidedMineResolution } = await import("../../scripts/ui/sheet/mine-guided.mjs");
  const { dice } = await import("../helpers/foundry-mock.mjs");
  const { ship: target, combat } = await setup();
  const source = makeShip({ id: "source", name: "Source" });
  target.saves = { reflex: { mod: 8, check: { roll: async () => ({ degreeOfSuccess: 1, total: 12 }) } } };
  const fresh = {
    result: { zone: 1, dc: 20, dice: 2 },
    operator: { uuid: "Actor.op", name: "Op" },
    targets: [{ key: target.uuid, uuid: target.uuid, name: target.name }]
  };
  const plan = async () => ({ ...fresh, snapshot: JSON.stringify(readStarship(target)) });
  fresh.snapshot = (await plan()).snapshot;
  dice(4, 4);
  foundry.applications.api.DialogV2.prompt = async () => ({ damage: "", degrees: ["1"], apply: [true] });
  foundry.applications.api.DialogV2.confirm = async () => false;
  await guidedMineResolution({
    ship: source,
    fresh,
    choice: { type: "fire" },
    excluded: "",
    recipients: ["gm"],
    plan,
    mineId: "m",
    droneId: "d",
    stationId: "s"
  });
  assert.equal(readStarship(target).sp.value, 4);
  const m = [...game.messages.values()][0];
  assert.match(m.content, /Applied: shields −6, hull −0/);
  assert.equal(combat.id, game.combat.id);
});

test("Harry assistant can apply an explicitly selected result without a second result card", async () => {
  const { prepareHarrySensors } = await import("../../scripts/ui/sheet/harry-assist.mjs");
  const { makeCharacter } = await import("../helpers/foundry-mock.mjs");
  installFoundryMock();
  await loadContentFromDisk();
  const op = makeCharacter({ id: "op", name: "Op" });
  op.getStatistic = () => ({ dc: { value: 20 } });
  const source = makeShip({
    id: "source",
    name: "Source",
    stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: op.uuid }],
    crew: [{ actorUuid: op.uuid, role: "crew", stationId: "s" }],
    extra: { drones: [{ id: "d", stationId: "s", ref: "scramble-drone", tscVersion: 1, deployed: true }] }
  });
  const target = makeShip({ id: "target", name: "Target", role: "npc" });
  target.saves = { will: { mod: 8, check: { roll: async () => ({ total: 8, degreeOfSuccess: 0 }) } } };
  makeStarshipCombat({
    objects: [
      { key: source.uuid, zone: 3 },
      { key: target.uuid, zone: 3 }
    ]
  });
  let count = 0;
  foundry.applications.api.DialogV2.prompt = async () => (count++ === 0 ? { target: target.uuid, dc: "" } : { degree: "0", apply: true });
  await prepareHarrySensors(source, { dataset: { stationId: "s", droneId: "d" } });
  assert.deepEqual(readStarship(target).effects.at(-1).conditions, ["off-kilter", "off-guard"]);
  assert.match([...game.messages.values()][0].content, /Module effect applied/);
  assert.equal(game.messages.size, 1);
});

test("pet and protocol socket handlers reject players and coalesce repeat GM requests", async () => {
  const { makeCharacter } = await import("../helpers/foundry-mock.mjs");
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  installFoundryMock();
  await loadContentFromDisk();
  const op = makeCharacter({ id: "op", name: "Op" }),
    pet = makeCharacter({ id: "pet", name: "Pet" });
  pet.system = { traits: { size: { value: "tiny" } }, attributes: { hp: { value: 4 } } };
  const ship = makeShip({
    id: "source",
    name: "Source",
    stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: op.uuid }],
    crew: [{ actorUuid: op.uuid, role: "crew", stationId: "s" }],
    extra: {
      upgrades: [
        { id: "up1", ref: "pet-drone-shell", stationId: "s" },
        { id: "up2", ref: "drone-shield-protocol", stationId: "s" }
      ],
      drones: [{ id: "d", stationId: "s", ref: "repair-drone", tscVersion: 1, deployed: true }]
    }
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  await combat.createEmbeddedDocuments("Combatant", [{ _id: "cb", actorId: op.id, initiative: 10 }]);
  registerShipHandlers();
  const out = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (x) => out.push(x) };
  const send = (type, payload, user = "gm") => dispatchSocketMessage({ kind: "request", type, requestId: "req", payload }, user, env);
  const petReq = {
    shipUuid: ship.uuid,
    stationId: "s",
    op: "start",
    petUuid: pet.uuid,
    operatorUuid: op.uuid,
    operationId: "petStart123",
    confirmed: true
  };
  await send("petCabin", petReq, "p1");
  assert.equal(out.at(-1).ok, false);
  await Promise.all([send("petCabin", petReq), send("petCabin", petReq)]);
  assert.equal(readStarship(ship).stations[0].tscPetOnboard.petUuid, pet.uuid);
  const p = {
    shipUuid: ship.uuid,
    stationId: "s",
    droneId: "d",
    operatorUuid: op.uuid,
    combatId: combat.id,
    op: "block",
    operationId: "protocol111",
    strikeRef: "attack-1",
    confirmed: true
  };
  await send("protocolDroneManual", p, "p1");
  assert.equal(out.at(-1).ok, false);
  await Promise.all([send("protocolDroneManual", p), send("protocolDroneManual", p)]);
  assert.equal(readStarship(ship).drones[0].tscProtocolBlocks, 1);
  assert.equal(game.messages.size, 2);
});

test("zero mine damage writes a receipt but no history or damage", async () => {
  const { historyEntries } = await import("../../scripts/history/history.mjs");
  const { ship, combat } = await setup();
  const hp = readStarship(ship).hp.value,
    sp = readStarship(ship).sp.value;
  await applyGuidedMineTarget(mineArgs(ship, combat, { amount: 0, degree: 3 }));
  assert.equal(readStarship(ship).hp.value, hp);
  assert.equal(readStarship(ship).sp.value, sp);
  assert.equal(historyEntries(ship.uuid).length, 0);
  assert.equal(readStarship(ship).tscMineDamageReceipts.length, 1);
});
