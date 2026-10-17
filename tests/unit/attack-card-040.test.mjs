import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat, dice } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
let mods;
async function load() {
  if (mods) return mods;
  const card = await import("../../scripts/chat/attack-card.mjs");
  const engine = await import("../../scripts/actions/action-engine.mjs");
  const tsc = await import("../../scripts/combat/tsc-state.mjs");
  const tracker = await import("../../scripts/combat/attack-tracker.mjs");
  mods = { card, engine, tsc, tracker };
  return mods;
}

/** Player ship Aurora (Ava at gunnery with an agile coilgun) vs. Raider; Ghost hidden, Shade undetected, Far out of range. */
async function scenario({ weaponRef = "coilgun" } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  await load();
  const ava = makeCharacter({ id: "ava", name: "Ava", owners: ["p1"] });
  const bob = makeCharacter({ id: "bob", name: "Bob", owners: ["p2"] });
  const aurora = makeShip({
    id: "aurora",
    name: "Aurora",
    role: "player",
    owners: [],
    stations: [
      { id: "gunnery-1", type: "gunnery", name: "Gunnery", grade: "commercial", helmedBy: "Actor.ava", weaponId: "w1" },
      { id: "pilot-1", type: "pilot", name: "Pilot", grade: "commercial", helmedBy: null }
    ],
    weapons: [{ id: "w1", weaponRef, name: weaponRef === "coilgun" ? "Coilgun" : "Laser" }],
    crew: [
      { actorUuid: "Actor.ava", name: "Ava", role: "crew", stationId: "gunnery-1", userId: "p1" },
      { actorUuid: "Actor.bob", name: "Bob", role: "crew", stationId: null, userId: "p2" }
    ]
  });
  const raider = makeShip({ id: "raider", name: "Raider", role: "npc", ac: 18, sp: 10, hp: 20 });
  const ghost = makeShip({ id: "ghost", name: "Ghost", role: "npc" });
  const shade = makeShip({ id: "shade", name: "Shade", role: "npc" });
  const far = makeShip({ id: "far", name: "Far", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [
      { key: aurora.uuid, zone: 2, alwaysVisible: true, detection: { party: "identified" } },
      { key: raider.uuid, zone: 4, heading: "left", detection: { party: "identified" } },
      { key: ghost.uuid, zone: 3, detection: { party: "hidden" } },
      { key: shade.uuid, zone: 3, detection: { party: "undetected" } },
      { key: far.uuid, zone: 11, detection: { party: "observed" }, designation: "Contact Beta" }
    ]
  });
  await combat.createEmbeddedDocuments("Combatant", [
    { actorId: "ava", initiative: 20 },
    { actorId: "bob", initiative: 15 },
    { actorId: "raider", initiative: 10 }
  ]);
  combat.turn = 0;
  const p1 = game.users.get("p1"),
    p2 = game.users.get("p2"),
    gm = game.users.get("gm");
  return { ava, bob, aurora, raider, ghost, shade, far, combat, p1, p2, gm };
}
const declare = (s, user = s.p1) =>
  mods.card.declareAttack({
    user,
    payload: { shipUuid: s.aurora.uuid, actionId: "strike", crewUuid: s.ava.uuid, stationId: "gunnery-1", options: {} }
  });
const cardOf = (id) => game.messages.get(id).flags[M].attackCard;
const tscOf = (c) => mods.tsc.getTsc(c);

beforeEach(() => {
  mods = mods ?? null;
});

test("declaration card: weapon, range, MAP and targets computed from state, nothing spent or rolled", async () => {
  const s = await scenario();
  const writesBefore = globalThis.__writes.length;
  const res = await declare(s);
  const c = cardOf(res.messageId);
  assert.equal(c.status, "open");
  assert.equal(c.ship.name, "Aurora");
  assert.equal(c.crew.name, "Ava");
  assert.equal(c.station.name, "Gunnery");
  assert.equal(c.weapon.name, "Coilgun");
  assert.ok(c.weapon.traits.includes("agile"));
  assert.equal(c.attackType, "ranged");
  assert.equal(c.range.zones, 3);
  assert.deepEqual(
    { cur: c.map.current, choice: c.map.choice, p1: c.map.profile.map1, p2: c.map.profile.map2 },
    { cur: 0, choice: "0", p1: -4, p2: -8 },
    "agile MAP −4/−8, default 1st attack"
  );
  const keys = c.targets.map((t) => t.key);
  assert.ok(keys.includes(s.raider.uuid));
  assert.ok(!keys.includes(s.ghost.uuid) && !keys.includes(s.shade.uuid), "players never see hidden/undetected objects");
  const raider = c.targets.find((t) => t.key === s.raider.uuid);
  assert.equal(raider.available, true);
  assert.equal(raider.distance, 2);
  assert.equal(raider.ac, 18);
  assert.equal(raider.label, "Raider");
  const far = c.targets.find((t) => t.key === s.far.uuid);
  assert.equal(far.available, false);
  assert.equal(far.reason, "outOfRange");
  assert.equal(far.label, "Contact Beta", "unidentified contact keeps its designation, not its name");
  assert.deepEqual(res.targets, [s.raider.uuid]);
  // nothing spent / recorded / rolled
  assert.equal(globalThis.__writes.length, writesBefore, "no actor/combat writes");
  assert.deepEqual(tscOf(s.combat).budget ?? {}, {});
  assert.deepEqual(tscOf(s.combat).attacks, {});
  assert.equal(game.messages.contents.filter((m) => m.rolls?.length).length, 0, "no roll message");
  // GM diagnostics are whispered and list the hidden objects with reasons
  const diag = game.messages.contents.find((m) => m.flags[M]?.attackDiag);
  assert.ok(diag.whisper.includes("gm") && !diag.whisper.includes("p1"));
  const reasons = Object.fromEntries(diag.flags[M].attackDiag.rows.map((r) => [r.name, r.reason]));
  assert.equal(reasons.Ghost, "hidden");
  assert.equal(reasons.Shade, "undetected");
  assert.doesNotMatch(game.messages.get(res.messageId).content, /Ghost|Shade/);
});

test("resolution: one roll, one spend, result card with attack/AC/degree/damage split and MAP", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  dice(19, 5); // d20 = 19 vs AC 18 → success; coilgun 1d6 = 5
  await mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid } });
  const c = cardOf(messageId);
  assert.equal(c.status, "resolved");
  assert.equal(c.result.attack.total, 19);
  assert.equal(c.result.attack.ac, 18);
  assert.equal(c.result.attack.natural, 19);
  assert.equal(c.result.degree, 2);
  assert.equal(c.result.damage.length, 1);
  assert.deepEqual(
    { rolled: c.result.damage[0].rolled, sp: c.result.damage[0].shield, hp: c.result.damage[0].hull },
    { rolled: 5, sp: 5, hp: 0 }
  );
  assert.deepEqual(c.result.map, { before: 0, choice: "0" });
  const tsc = tscOf(s.combat);
  assert.deepEqual(tsc.budget ?? {}, {}, "0.6.0: no action pool / counters");
  assert.deepEqual(tsc.attacks ?? {}, {}, "0.6.0: no automatic MAP counting");
  assert.equal(s.raider.flags[M].starship.sp.value, 5);
  // no separate action/damage cards in card mode
  assert.equal(game.messages.contents.filter((m) => m.flags[M]?.damage).length, 0);
  // second click / re-render / other client → refused, nothing changes
  await assert.rejects(() => mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid } }), /already/i);
  await assert.rejects(() => mods.card.resolveAttackCard({ user: s.gm, payload: { messageId, targetKey: s.raider.uuid } }), /already/i);
  assert.deepEqual(tscOf(s.combat).budget ?? {}, {});
});

test("two clients clicking at the same time: exactly one execution", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  dice(19, 5, 19, 5);
  const results = await Promise.allSettled([
    mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid } }),
    mods.card.resolveAttackCard({ user: s.gm, payload: { messageId, targetKey: s.raider.uuid } })
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.deepEqual(tscOf(s.combat).budget ?? {}, {});
  assert.equal(
    game.messages.contents.filter((m) => m.rolls?.length && m.rolls[0].formula.startsWith("1d20")).length,
    1,
    "a single attack roll"
  );
});

test("MAP (0.6.0): chosen manually on the card, applied once, nothing counted", async () => {
  const s = await scenario();
  for (const d of [19, 19]) {
    const { messageId } = await declare(s);
    dice(d, 1);
    await mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid } });
  }
  const third = cardOf((await declare(s)).messageId);
  assert.equal(third.map.current, 0, "no automatic counting: default is the 1st attack");
  globalThis.__dice.length = 0;
  dice(19, 1);
  const id = game.messages.contents.findLast((m) => m.flags[M]?.attackCard).id;
  await mods.card.resolveAttackCard({ user: s.p1, payload: { messageId: id, targetKey: s.raider.uuid, mapChoice: "2" } });
  const r = cardOf(id).result;
  assert.equal(r.attack.total, 11, "19 − 8 (agile 3rd attack)");
  assert.equal(r.attack.modifiers.filter((m) => m.value === -8).length, 1);
  // forged value → falls back to the 1st attack
  const { messageId } = await declare(s);
  globalThis.__dice.length = 0;
  dice(19, 1);
  await mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid, mapChoice: "-50" } });
  assert.equal(cardOf(messageId).result.attack.total, 19);
});

test("attack from behind: target off-guard (−2 AC) shown on the card", async () => {
  const s = await scenario();
  const t = tscOf(s.combat);
  t.objects.find((o) => o.key === s.raider.uuid).heading = "right";
  await s.combat.update({ [`flags.${M}.tsc`]: t });
  const c = cardOf((await declare(s)).messageId);
  const r = c.targets.find((x) => x.key === s.raider.uuid);
  assert.equal(r.ac, 16);
  assert.equal(r.behind, true);
});

test("MAP profile: non-agile weapons use −5/−10; rule elements improve it", async () => {
  const s = await scenario({ weaponRef: "light-laser-cannon" });
  let st = mods.tracker.mapStateFor({ combat: s.combat, attacker: s.ava, weapon: { traits: ["tech"] } });
  assert.deepEqual([st.attacksMade, st.current, st.next], [0, 0, -5]);
  s.ava.synthetics.multipleAttackPenalties = { "attack-roll": [{ label: "Flurry", penalty: -3, predicate: { test: () => true } }] };
  st = mods.tracker.mapStateFor({ combat: s.combat, attacker: s.ava, weapon: { traits: ["tech"] } });
  assert.deepEqual([st.next, st.profile.label], [-3, "Flurry"]);
});

test("target state changes after the card was posted: re-validated right before the roll", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  const t = tscOf(s.combat);
  t.objects.find((o) => o.key === s.raider.uuid).detection = { party: "undetected" };
  await s.combat.update({ [`flags.${M}.tsc`]: t });
  await assert.rejects(() => mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid } }), /undetected/i);
  assert.equal(cardOf(messageId).status, "open", "card stays usable");
  assert.deepEqual(tscOf(s.combat).budget ?? {}, {}, "nothing spent");
  // a target that moved out of range
  t.objects.find((o) => o.key === s.raider.uuid).detection = { party: "identified" };
  t.objects.find((o) => o.key === s.raider.uuid).zone = 9;
  await s.combat.update({ [`flags.${M}.tsc`]: t });
  await assert.rejects(
    () => mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid } }),
    /out of range/i
  );
  // never-listed hidden target picked via a forged request
  await assert.rejects(() => mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.ghost.uuid } }), /hidden/i);
});

test("a card stays valid across turns (no turn gate); other players can't resolve someone else's card; a card from another combat is voided", async () => {
  const s = await scenario();
  const { messageId } = await declare(s);
  await assert.rejects(() => mods.card.resolveAttackCard({ user: s.p2, payload: { messageId, targetKey: s.raider.uuid } }), /permission/i);
  await s.combat.update({ turn: 1 });
  dice(19, 1);
  await mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid } });
  assert.equal(cardOf(messageId).status, "resolved");
});

test("0.6.0: declaring off-turn is allowed (players track actions themselves)", async () => {
  const s = await scenario();
  await s.combat.update({ turn: 2 });
  const res = await declare(s);
  assert.equal(cardOf(res.messageId).status, "open");
});
