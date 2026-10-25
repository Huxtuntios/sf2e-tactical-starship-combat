import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";

/** Register the real ship/crew handlers and return a sender that goes through the socket dispatcher as `userId`. */
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
const flag = (a) => a.flags[M].starship;

/* ------------------------------------------------------------------ must fix 1: crew access to ships */
test("0.9.1: a player cannot add their PC as crew on an enemy (NPC) ship", async () => {
  const { send } = await setup();
  const enemy = makeShip({ id: "enemy", name: "Raider", role: "npc", stations: [{ id: "pilot-1", type: "pilot" }] });
  const pc = makeCharacter({ id: "pc1", name: "Vesk", owners: ["p1"] });
  const r = await send("p1", "addCrew", { shipUuid: enemy.uuid, crewUuid: pc.uuid });
  assert.equal(r.ok, false);
  assert.equal((flag(enemy).crew ?? []).length, 0);
  const c = await send("p1", "claimStation", { shipUuid: enemy.uuid, stationId: "pilot-1", crewUuid: pc.uuid });
  assert.equal(c.ok, false, "claimStation cannot be used to sneak aboard either");
  assert.equal((flag(enemy).crew ?? []).length, 0);
});

test("0.9.1: a player with no access to a party ship cannot join it; observer access, ownership or GM can", async () => {
  const { send } = await setup();
  const party = makeShip({ id: "party", name: "Sunrise", role: "player", stations: [{ id: "pilot-1", type: "pilot" }] });
  const pc = makeCharacter({ id: "pc1", name: "Vesk", owners: ["p1"] });
  assert.equal((await send("p1", "addCrew", { shipUuid: party.uuid, crewUuid: pc.uuid })).ok, false, "no access → refused");
  party.observers = ["p1"];
  assert.equal((await send("p1", "addCrew", { shipUuid: party.uuid, crewUuid: pc.uuid })).ok, true, "shared party ship → allowed");
  assert.equal(flag(party).crew.length, 1);
  assert.equal(flag(party).crew[0].role, "crew");
  const pc2 = makeCharacter({ id: "pc2", name: "Ysoki", owners: ["p2"] });
  const owned = makeShip({ id: "own", name: "Owned", role: "npc", owners: ["p2"], stations: [{ id: "pilot-1", type: "pilot" }] });
  assert.equal(
    (await send("p2", "claimStation", { shipUuid: owned.uuid, stationId: "pilot-1", crewUuid: pc2.uuid })).ok,
    true,
    "ship owner may crew their own ship"
  );
  const enemy = makeShip({ id: "enemy2", name: "Raider", role: "npc" });
  assert.equal((await send("gm", "addCrew", { shipUuid: enemy.uuid, crewUuid: pc.uuid })).ok, true, "GM may crew any ship");
});

test("0.9.1: canJoinShip / canClaimStation rules", async () => {
  installFoundryMock();
  const { canJoinShip } = await import("../../scripts/crew/permissions.mjs");
  const { canAddCrew, canClaimStation } = await import("../../scripts/crew/crew-service.mjs");
  const p1 = game.users.get("p1"),
    gm = game.users.get("gm");
  const pc = makeCharacter({ id: "pc1", name: "Vesk", owners: ["p1"] });
  const other = makeCharacter({ id: "pc9", name: "Other", owners: ["p2"] });
  const enemy = makeShip({ id: "e", name: "E", role: "npc" });
  enemy.observers = ["p1"];
  const party = makeShip({ id: "p", name: "P", role: "player" });
  party.observers = ["p1"];
  assert.equal(canJoinShip(p1, enemy), false, "observer access to an NPC ship is not enough");
  assert.equal(canJoinShip(p1, party), true);
  assert.equal(canJoinShip(gm, enemy), true);
  assert.equal(canAddCrew(p1, party, other), false, "cannot add someone else's character");
  assert.equal(canClaimStation(p1, party, pc, { force: true }), false, "forced claims need assignCrew");
  const linked = makeShip({
    id: "l",
    name: "L",
    role: "npc",
    crew: [{ actorUuid: other.uuid, name: "Other", userId: "p1", role: "crew" }]
  });
  assert.equal(canClaimStation(p1, linked, other), true, "an existing entry linked to the user can still move stations (0.8.6)");
});

/* ------------------------------------------------------------------ must fix 2: only starships are written */
test("0.9.1: ship and crew handlers refuse actors that are not starships", async () => {
  const { send } = await setup();
  const pcTarget = makeCharacter({ id: "victim", name: "Plain PC", owners: ["p1"] });
  const pc = makeCharacter({ id: "pc1", name: "Vesk", owners: ["p1"] });
  for (const [type, payload] of [
    ["patchShip", { shipUuid: pcTarget.uuid, patch: { notes: "x" } }],
    ["setStation", { shipUuid: pcTarget.uuid, stationId: "x", patch: { name: "x" } }],
    ["equipment", { shipUuid: pcTarget.uuid, list: "weapons", op: "add", item: { id: "w", name: "w" } }],
    ["applyFrame", { shipUuid: pcTarget.uuid, frameId: "explorer", level: 1 }],
    ["addCrew", { shipUuid: pcTarget.uuid, crewUuid: pc.uuid }],
    ["addStation", { shipUuid: pcTarget.uuid, station: { type: "pilot" } }]
  ]) {
    const gm = await send("gm", type, payload);
    assert.equal(gm.ok, false, `${type} must refuse a non-starship even for the GM`);
    assert.match(gm.error, /notStarship|not a starship/i, type);
  }
  assert.equal(pcTarget.flags?.[M]?.starship, undefined, "no starship data was written onto the PC");
});

/* ------------------------------------------------------------------ should fix 1: write-path validation */
test("0.9.1: patchShip / setStation / equipment / addStation / applyFrame type-check their values", async () => {
  const { send } = await setup();
  const ship = makeShip({ id: "s", name: "S", owners: ["p1"], stations: [{ id: "pilot-1", type: "pilot" }] });
  assert.equal((await send("p1", "patchShip", { shipUuid: ship.uuid, patch: { level: "banana" } })).ok, false);
  assert.equal((await send("p1", "patchShip", { shipUuid: ship.uuid, patch: { ac: "x" } })).ok, false);
  assert.equal((await send("p1", "patchShip", { shipUuid: ship.uuid, patch: { traits: "not-a-list" } })).ok, false);
  assert.equal((await send("p1", "patchShip", { shipUuid: ship.uuid, patch: { resistances: { fire: "lots" } } })).ok, false);
  assert.equal(flag(ship).level, 3);
  assert.equal(flag(ship).ac, 20);
  assert.equal(
    (await send("p1", "patchShip", { shipUuid: ship.uuid, patch: { ac: "22", level: 4 } })).ok,
    true,
    "numeric strings from inputs are coerced"
  );
  assert.equal(flag(ship).ac, 22);
  assert.equal(flag(ship).level, 4);
  assert.equal((await send("gm", "patchShip", { shipUuid: ship.uuid, patch: { hp: { value: "lots" } } })).ok, false);
  assert.equal((await send("gm", "patchShip", { shipUuid: ship.uuid, patch: { destroyed: "yes" } })).ok, false);

  assert.equal(
    (await send("p1", "setStation", { shipUuid: ship.uuid, stationId: "pilot-1", patch: { grade: "legendary-ish" } })).ok,
    false
  );
  assert.equal((await send("p1", "setStation", { shipUuid: ship.uuid, stationId: "pilot-1", patch: { upgrades: "x" } })).ok, false);
  assert.equal((await send("p1", "setStation", { shipUuid: ship.uuid, stationId: "pilot-1", patch: { grade: "tactical" } })).ok, true);

  assert.equal((await send("p1", "equipment", { shipUuid: ship.uuid, list: "weapons", op: "add", item: "nope" })).ok, false);
  assert.equal(
    (
      await send("p1", "equipment", {
        shipUuid: ship.uuid,
        list: "weapons",
        op: "add",
        item: { id: "w1", name: "Laser", die: "2d6", range: "far" }
      })
    ).ok,
    false
  );
  assert.equal(
    (
      await send("p1", "equipment", {
        shipUuid: ship.uuid,
        list: "weapons",
        op: "add",
        item: { id: "w1", name: "Laser", die: "2d6", range: 5 }
      })
    ).ok,
    true
  );
  assert.equal(
    (await send("p1", "equipment", { shipUuid: ship.uuid, list: "weapons", op: "update", index: 0, item: { range: "x" } })).ok,
    false
  );
  assert.equal(
    (await send("p1", "equipment", { shipUuid: ship.uuid, list: "expansionBays", op: "add", item: { id: "bay1", name: null } })).ok,
    true,
    "new empty bay still works"
  );

  const add = await send("p1", "addStation", {
    shipUuid: ship.uuid,
    station: { id: "g-1", type: "gunnery", grade: "commercial", helmedBy: "Actor.someone", ready: true }
  });
  assert.equal(add.ok, true);
  const st = flag(ship).stations.find((s) => s.id === "g-1");
  assert.equal(st.helmedBy, null, "addStation cannot seat a crew member");
  assert.equal(st.ready, false);
  assert.equal((await send("p1", "addStation", { shipUuid: ship.uuid, station: { type: "pilot", grade: 7 } })).ok, false);

  assert.equal(
    (
      await send("p1", "applyFrame", {
        shipUuid: ship.uuid,
        frameId: [...(await import("../../scripts/content/loader.mjs")).Content.frames.keys()][0],
        level: "ten"
      })
    ).ok,
    false
  );
});

test("0.9.1: field sanitizers", async () => {
  const v = await import("../../scripts/engine/validation.mjs");
  assert.equal(v.sanitizeShipField("level", "5"), 5);
  assert.throws(() => v.sanitizeShipField("level", 26));
  assert.throws(() => v.sanitizeShipField("level", 2.5));
  assert.throws(() => v.sanitizeShipField("size", "planet"));
  assert.deepEqual(v.sanitizeShipField("skills", { piloting: 12 }), { piloting: 12 });
  assert.throws(() => v.sanitizeShipField("skills", JSON.parse('{"__proto__": 1}')));
  assert.throws(() => v.sanitizeShipField("hacked", 1));
  assert.deepEqual(v.sanitizePool("sp", { value: "3" }), { value: 3 });
  assert.throws(() => v.sanitizePool("hp", { max: 0 }));
  assert.equal(v.sanitizeStationField("weaponId", ""), null);
});

/* ------------------------------------------------------------------ should fix 2: tracker HP/SP visibility */
test("0.9.1: combat tracker shows exact Hull/Shield Points only to viewers who may see the ship", async () => {
  installFoundryMock();
  const { canSeeShipPools, shipBadgeHTML } = await import("../../scripts/combat/tracker.mjs");
  const { readStarship } = await import("../../scripts/starship/starship-state.mjs");
  const enemy = makeShip({ id: "e", name: "E", role: "npc", hp: 40, sp: 12 });
  const party = makeShip({ id: "p", name: "P", owners: ["p1"], hp: 30, sp: 10 });
  const p1 = game.users.get("p1"),
    gm = game.users.get("gm");
  assert.equal(canSeeShipPools(p1, enemy), false);
  assert.equal(canSeeShipPools(gm, enemy), true);
  assert.equal(canSeeShipPools(p1, party), true);
  const hidden = shipBadgeHTML(readStarship(enemy), { showPools: false });
  assert.doesNotMatch(hidden, /40\/40|12\/12|class="hp"|class="sp"/);
  assert.match(shipBadgeHTML(readStarship(enemy), { showPools: true }), /40\/40/);
});

/* ------------------------------------------------------------------ should fix 3: chat HTML from check links */
test("0.9.1: decoded check-link labels are escaped again before they reach chat", async () => {
  const { checkChatContent, inlineChatContent } = await import("../../scripts/content/inline-checks.mjs");
  const evil = `<img src=x onerror="alert(1)">`;
  const c = checkChatContent("will|dc:20", evil, "<b>Src</b>");
  assert.doesNotMatch(c, /<img|<b>Src/);
  assert.match(c, /&lt;img/);
  assert.equal(checkChatContent("will|dc:20", "DC 20 Will save"), "<p>@Check[will|dc:20]{Will save}</p>");
  assert.doesNotMatch(checkChatContent("will]{x}<i>", "a}b"), /<i>|\]\{x/);
  assert.equal(inlineChatContent("@Damage[2d8[fire]]", "2d8 fire"), "<p>@Damage[2d8[fire]]{2d8 fire}</p>");
  assert.doesNotMatch(inlineChatContent("@Damage[2d8[fire]]", evil), /<img/);
  assert.equal(inlineChatContent(`<script>alert(1)</script>`, "x"), null, "only @Damage[…] payloads are posted");
});
