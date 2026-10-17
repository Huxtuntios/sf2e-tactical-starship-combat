import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat, dice } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
let mods;
async function load() {
  if (mods) return mods;
  mods = {
    card: await import("../../scripts/chat/attack-card.mjs"),
    engine: await import("../../scripts/actions/action-engine.mjs"),
    tsc: await import("../../scripts/combat/tsc-state.mjs"),
    rolls: await import("../../scripts/rolls/ship-rolls.mjs"),
    map: await import("../../scripts/engine/map.mjs"),
    strike: await import("../../scripts/actions/strike.mjs"),
    state: await import("../../scripts/starship/starship-state.mjs")
  };
  return mods;
}
async function scenario() {
  installFoundryMock();
  await loadContentFromDisk();
  await load();
  const ava = makeCharacter({ id: "ava", name: "Ava", owners: ["p1"] });
  const bob = makeCharacter({ id: "bob", name: "Bob", owners: ["p2"] });
  const aurora = makeShip({
    id: "aurora",
    name: "Aurora",
    role: "player",
    stations: [{ id: "gunnery-1", type: "gunnery", name: "Gunnery", grade: "commercial", helmedBy: "Actor.ava", weaponId: "w1" }],
    weapons: [{ id: "w1", weaponRef: "coilgun", name: "Coilgun" }],
    crew: [
      { actorUuid: "Actor.ava", name: "Ava", role: "crew", stationId: "gunnery-1", userId: "p1" },
      { actorUuid: "Actor.bob", name: "Bob", role: "crew", stationId: null, userId: "p2" }
    ],
    extra: { skills: { computers: 7, Piloting: "5", broken: "x" } }
  });
  const raider = makeShip({ id: "raider", name: "Raider", role: "npc", ac: 18, sp: 10, hp: 20 });
  const ghost = makeShip({ id: "ghost", name: "Ghost", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [
      { key: aurora.uuid, zone: 2, alwaysVisible: true, detection: { party: "identified" } },
      { key: raider.uuid, zone: 4, heading: "left", detection: { party: "identified" } },
      { key: ghost.uuid, zone: 3, detection: { party: "hidden" } }
    ]
  });
  await combat.createEmbeddedDocuments("Combatant", [
    { actorId: "ava", initiative: 20 },
    { actorId: "bob", initiative: 15 },
    { actorId: "raider", initiative: 10 }
  ]);
  combat.turn = 0;
  return { ava, bob, aurora, raider, ghost, combat, p1: game.users.get("p1"), p2: game.users.get("p2"), gm: game.users.get("gm") };
}
const cardOf = (id) => game.messages.get(id).flags[M].attackCard;
const sheetDeclare = (s, mapChoice = "auto", user = s.p1) =>
  mods.card.declareAttack({
    user,
    payload: {
      shipUuid: s.aurora.uuid,
      actionId: "strike",
      crewUuid: s.ava.uuid,
      stationId: "gunnery-1",
      options: { weaponId: "w1", sheetRoll: true, mapChoice }
    }
  });

test("check rows: only statistics the ship really has; skills are final statblock values (no double application)", async () => {
  const s = await scenario();
  const rows = mods.rolls.shipCheckRows(s.aurora);
  const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
  assert.deepEqual(Object.keys(by).sort(), ["computers", "fortitude", "perception", "piloting", "reflex", "will"]);
  assert.equal(by.computers.mod, 7);
  assert.equal(by.piloting.mod, 5);
  assert.equal(by.computers.kind, "skill");
  assert.equal(by.fortitude.kind, "save");
  assert.equal(by.fortitude.mod, 8);
  assert.equal(
    mods.rolls.shipCheckList({ fort: null, reflex: undefined, will: "", perception: null, skills: {} }, {}).length,
    0,
    "no fake checks"
  );
});

test("check rolls: without DC no degree; with DC degree; unknown statistic refused; nothing spent", async () => {
  const s = await scenario();
  const writes = globalThis.__writes.length;
  dice(10);
  const a = await mods.rolls.rollShipCheck(s.aurora, "computers");
  assert.equal(a.total, 17);
  assert.equal(a.degree, null);
  dice(10);
  const b = await mods.rolls.rollShipCheck(s.aurora, "fortitude", { dc: 18 });
  assert.equal(b.total, 18);
  assert.equal(b.degree, 2);
  await assert.rejects(() => mods.rolls.rollShipCheck(s.aurora, "thievery"));
  assert.equal(globalThis.__writes.length, writes, "checks write nothing");
  assert.deepEqual(mods.tsc.getTsc(s.combat).budget ?? {}, {});
});

test("attack rows: weapon through its battle station and crew, MAP labels, NPC strike rows", async () => {
  const s = await scenario();
  const [row] = mods.rolls.sheetAttackRows(s.aurora);
  assert.equal(row.key, "w:w1");
  assert.equal(row.stationId, "gunnery-1");
  assert.equal(row.crewUuid, "Actor.ava");
  assert.equal(row.enabled, true);
  assert.equal(row.map1, "-4");
  assert.equal(row.map2, "-8");
  const req = mods.rolls.sheetAttackRequest(s.aurora, row, "evil");
  assert.deepEqual(req.options, { weaponId: "w1", sheetRoll: true, mapChoice: "auto" });
  const npc = makeShip({
    id: "npc1",
    name: "Npc",
    role: "npc",
    extra: { strikes: [{ name: "hardlight dagger", kind: "melee", attack: 6, traits: ["tech"], damage: "2d6 piercing plus 1d6 fire" }] }
  });
  const r = mods.rolls.sheetAttackRows(npc).find((x) => x.kind === "strike");
  assert.equal(r.actionId, "npc-strike:hardlight-dagger");
  assert.equal(r.bonusText, "+6");
  assert.match(r.damageText, /2d6.*\+ 1d6/);
});

test("NPC damage strings keep every component", async () => {
  await load();
  assert.deepEqual(mods.strike.npcDamageParts("2d6+3 piercing plus 1d6 fire"), [
    { formula: "2d6+3", type: "piercing" },
    { formula: "1d6", type: "fire" }
  ]);
  assert.deepEqual(mods.strike.npcDamageParts("1d4 persistent electricity"), [{ formula: "1d4", type: "electricity" }]);
  assert.deepEqual(mods.strike.npcDamageParts(""), [{ formula: "1d6", type: "untyped" }]);
});

test("sanitizer: sheetRoll only as boolean true, mapChoice whitelisted", async () => {
  await scenario();
  const req = mods.engine.sanitizeActionRequest(
    { shipUuid: "x", actionId: "strike", options: { sheetRoll: "true", mapChoice: "5" } },
    game.users.get("p1")
  );
  assert.equal(req.options.sheetRoll, undefined);
  assert.equal(req.options.mapChoice, undefined);
  const ok = mods.engine.sanitizeActionRequest(
    { shipUuid: "x", actionId: "strike", options: { sheetRoll: true, mapChoice: "2" } },
    game.users.get("p1")
  );
  assert.equal(ok.options.sheetRoll, true);
  assert.equal(ok.options.mapChoice, "2");
});

test("MAP choice (0.6.0): manual only, default 1st attack, disabled MAP gives 0", async () => {
  await load();
  const ms = { enabled: true, current: -4, profile: { map1: -4, map2: -8 } };
  assert.equal(mods.map.mapPenaltyForChoice("auto", ms).penalty, 0, "no auto: unknown value = 1st attack");
  assert.deepEqual([...mods.map.MAP_CHOICES], ["0", "1", "2"]);
  assert.equal(mods.map.mapPenaltyForChoice("2", ms).penalty, -8);
  assert.equal(mods.map.mapPenaltyForChoice("0", ms).penalty, 0);
  assert.equal(mods.map.mapPenaltyForChoice("2", { ...ms, enabled: false }).penalty, 0);
});

test("sheet attack off-turn: no action/reaction spent, hidden targets not offered, damage deferred and applied once by the GM", async () => {
  const s = await scenario();
  s.combat.turn = 2; // Raider's turn: not Ava's
  const { messageId, targets } = await sheetDeclare(s, "2");
  assert.deepEqual(targets, [s.raider.uuid], "hidden Ghost is never offered");
  const c0 = cardOf(messageId);
  assert.equal(c0.map.current, -8);
  assert.equal(c0.map.manual, true);
  await assert.rejects(
    () => mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.ghost.uuid } }),
    "hidden target refused"
  );
  dice(20, 4);
  await mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid } });
  const c1 = cardOf(messageId);
  assert.equal(c1.status, "resolved");
  const mapMods = (c1.result.attack.modifiers ?? []).filter((m) => /map|multiple/i.test(`${m.slug} ${m.label}`));
  assert.ok(mapMods.length <= 1, "MAP applied at most once");
  assert.ok(c1.result.pendingDamage, "damage waits for its own step");
  assert.equal(c1.result.pendingDamage.targetUuid, s.raider.uuid);
  assert.equal(mods.state.readStarship(s.raider).sp.value, 10, "nothing applied yet");
  const t = mods.tsc.getTsc(s.combat);
  assert.deepEqual(t.budget ?? {}, {}, "no actions spent");
  assert.deepEqual(t.reactions ?? {}, {}, "no reactions spent");
  // damage: roll, reroll, GM-only apply, exactly once
  await assert.rejects(() => mods.card.applyAttackCardDamage({ user: s.gm, payload: { messageId } }), /first/i);
  dice(3);
  await mods.card.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  dice(6);
  await mods.card.rollAttackCardDamage({ user: s.p1, payload: { messageId } });
  const rolled = cardOf(messageId).damageRoll.total;
  assert.ok(rolled > 0);
  await assert.rejects(
    () => mods.card.rollAttackCardDamage({ user: s.p2, payload: { messageId } }),
    "other players cannot roll on someone else's card"
  );
  await assert.rejects(() => mods.card.applyAttackCardDamage({ user: s.p1, payload: { messageId } }), "players cannot apply");
  await mods.card.applyAttackCardDamage({ user: s.gm, payload: { messageId, targetUuid: s.ghost.uuid } });
  assert.ok(mods.state.readStarship(s.raider).sp.value < 10, "damage applied to the bound target");
  assert.equal(mods.state.readStarship(s.ghost).sp.value, mods.state.readStarship(s.ghost).sp.max, "client target ignored");
  await assert.rejects(() => mods.card.applyAttackCardDamage({ user: s.gm, payload: { messageId } }), /already/i);
  await assert.rejects(() => mods.card.rollAttackCardDamage({ user: s.p1, payload: { messageId } }), /already/i);
  // repeat attacks are allowed (no counter, no confirmation)
  const again = await sheetDeclare(s);
  assert.ok(again.messageId);
});

test("station strikes (no sheetRoll) still roll and auto-apply damage as before", async () => {
  const s = await scenario();
  const { messageId } = await mods.card.declareAttack({
    user: s.p1,
    payload: { shipUuid: s.aurora.uuid, actionId: "strike", crewUuid: s.ava.uuid, stationId: "gunnery-1", options: {} }
  });
  dice(19, 5);
  await mods.card.resolveAttackCard({ user: s.p1, payload: { messageId, targetKey: s.raider.uuid } });
  assert.equal(cardOf(messageId).result.pendingDamage, null);
  assert.ok(mods.state.readStarship(s.raider).sp.value < 10);
  assert.deepEqual(mods.tsc.getTsc(s.combat).budget ?? {}, {}, "0.6.0: the module never counts actions");
});

test("i18n: every new rolls key exists in en and ru", async () => {
  const fs = await import("node:fs");
  const en = JSON.parse(fs.readFileSync(new URL("../../lang/en.json", import.meta.url))).SF2eTSC.rolls;
  const ru = JSON.parse(fs.readFileSync(new URL("../../lang/ru.json", import.meta.url))).SF2eTSC.rolls;
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(flat(en).sort(), flat(ru).sort());
});
