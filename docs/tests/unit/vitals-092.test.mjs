import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";

async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
  const socket = await import("../../scripts/socket.mjs");
  (await import("../../scripts/crew/crew-service.mjs")).registerCrewHandlers();
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const emitted = [];
  const send = async (userId, type, payload) => {
    await socket.dispatchSocketMessage({ kind: "request", type, requestId: `r${emitted.length}`, payload }, userId, {
      users: game.users,
      selfId: "gm",
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (m) => emitted.push(m)
    });
    return emitted.at(-1);
  };
  return { send };
}
const now = async (a) => (await import("../../scripts/starship/starship-state.mjs")).readStarship(a);

/** Party ship with Ava (player p1) as crew; p2 has no access at all. */
function party() {
  makeCharacter({ id: "ava", name: "Ava", owners: ["p1"] });
  makeCharacter({ id: "eve", name: "Eve", owners: ["p2"] });
  return makeShip({
    id: "sun",
    name: "Sunrise",
    role: "player",
    hp: 40,
    sp: 20,
    stations: [{ id: "pilot-1", type: "pilot", helmedBy: null }],
    crew: [{ actorUuid: "Actor.ava", name: "Ava", role: "crew", stationId: null, userId: "p1" }]
  });
}

test("0.9.2: crew may set current Hull / Shield Points by hand, never the maximums", async () => {
  const { send } = await setup();
  const ship = party();
  assert.equal((await send("p1", "patchShip", { shipUuid: ship.uuid, patch: { hp: { value: 25 }, sp: { value: 5 } } })).ok, true);
  let st = await now(ship);
  assert.deepEqual([st.hp.value, st.sp.value], [25, 5]);
  assert.equal(
    (await send("p1", "patchShip", { shipUuid: ship.uuid, patch: { hp: { max: 999 } } })).ok,
    false,
    "maximums need configureShip"
  );
  assert.equal((await now(ship)).hp.max, 40);
});

test("0.9.2: someone with no access to the ship cannot touch its vitals", async () => {
  const { send } = await setup();
  const ship = party();
  for (const [type, payload] of [
    ["patchShip", { patch: { hp: { value: 1 } } }],
    ["gmDamage", { amount: 5 }],
    ["gmRepair", { hp: 5 }],
    ["hullIntegrity", {}]
  ]) {
    assert.equal((await send("p2", type, { shipUuid: ship.uuid, ...payload })).ok, false, `${type} refused for a stranger`);
  }
  assert.equal((await now(ship)).hp.value, 40);
});

test("0.9.2: crew can repair Hull / Shield by hand; clearing malfunctions and status flags stay with the GM", async () => {
  const { send } = await setup();
  const ship = party();
  assert.equal((await send("gm", "patchShip", { shipUuid: ship.uuid, patch: { hp: { value: 10 }, sp: { value: 0 } } })).ok, true);
  const ok = await send("p1", "gmRepair", { shipUuid: ship.uuid, hp: 15, sp: 8 });
  const st = await now(ship);
  assert.equal(ok.ok, true);
  assert.deepEqual([st.hp.value, st.sp.value], [25, 8]);
  assert.equal((await send("p1", "gmRepair", { shipUuid: ship.uuid, hp: 1, clearMalfunctions: true })).ok, false);
  assert.equal((await send("p1", "patchShip", { shipUuid: ship.uuid, patch: { compromised: 2 } })).ok, false, "compromised is GM only");
  assert.equal(
    (await send("p1", "patchShip", { shipUuid: ship.uuid, patch: { offKilter: true } })).ok,
    true,
    "off-kilter may be flipped by the crew"
  );
  assert.equal((await send("gm", "patchShip", { shipUuid: ship.uuid, patch: { compromised: 2 } })).ok, true);
});

test("0.9.2: crew damage goes through the same rules engine as the GM (shields first)", async () => {
  const { send } = await setup();
  const ship = party();
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 2, alwaysVisible: true, detection: { party: "identified" } }] });
  void combat;
  const r = await send("p1", "gmDamage", { shipUuid: ship.uuid, amount: 12 });
  assert.equal(r.ok, true);
  const st = await now(ship);
  assert.equal(st.sp.value, 8, "20 SP absorb 12");
  assert.equal(st.hp.value, 40);
});

test("0.9.2: diagnostics report a missing GM and crew members whose actor is gone, in plain words", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { collectDiagnostics, diagnosticsHTML } = await import("../../scripts/ui/diagnostics.mjs");
  makeCharacter({ id: "ava", name: "Ava", owners: ["p1"] });
  const ship = makeShip({
    id: "sun",
    name: "Sunrise",
    role: "player",
    stations: [{ id: "pilot-1", type: "pilot", name: "Pilot", helmedBy: "Actor.ghost" }],
    crew: [
      { actorUuid: "Actor.ava", name: "Ava", role: "crew", stationId: null, userId: "p1" },
      { actorUuid: "Actor.gone", name: "Gone", role: "crew", stationId: null }
    ]
  });
  const fake = {
    version: "14",
    system: { id: "sf2e", version: "1.6.0" },
    modules: new Map([[M, { version: "0.9.2", active: true }]]),
    users: [
      { active: false, isGM: true },
      { active: true, isGM: false }
    ],
    actors: [ship]
  };
  const rows = collectDiagnostics({ game: fake, resolve: (uuid) => (uuid === "Actor.ava" ? {} : null) });
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.ok(
    rows.some((r) => r.level === "bad" && /GM/i.test(r.label)),
    "no GM online is called out"
  );
  const issues = rows.find((r) => r.level === "warn" && /problem/i.test(r.label));
  assert.ok(issues && /Gone/.test(issues.detail), JSON.stringify(byLabel));
  assert.match(diagnosticsHTML(rows), /<ul class="tsc-diag-list">/);
  fake.users[0].active = true;
  fake.actors = [];
  assert.ok(collectDiagnostics({ game: fake }).some((r) => r.level === "ok" && /GM/i.test(r.label)));
});

test("0.10.0: a secret check is hidden for both the v14 (messageMode) and the older (rollMode) reader; a normal roll follows the player's chat setting", async () => {
  installFoundryMock();
  const { secretVisibility } = await import("../../scripts/starship/stats.mjs");
  assert.deepEqual(secretVisibility(true), { messageMode: "gm", rollMode: "gmroll" });
  assert.deepEqual(secretVisibility(false), {});
});
