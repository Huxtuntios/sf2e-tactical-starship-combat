import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";
import { installNativeEffectsFixture, nativeActor } from "../helpers/native-effect-fixture.mjs";
import { computeShipStats, shipModuleValue, shipStatistic, stationStatistic, shipAreaDC } from "../../scripts/starship/stats.mjs";
import {
  computeAttackModifiers,
  npcDamageParts,
  resolveWeapon,
  resolveStrike,
  knownAttackBonus,
  damageFormula
} from "../../scripts/actions/strike.mjs";
import { stackModifiers } from "../../scripts/engine/stacking.mjs";
import { contextDCs } from "../../scripts/rolls/context-dc.mjs";
import { shipCheckRows, sheetAttackRows } from "../../scripts/rolls/ship-rolls.mjs";
import { effectiveEffectStates } from "../../scripts/starship/effects.mjs";

const M = "sf2e-tactical-starship-combat";
const effect = (selector, value, type = "status", targets = { entire: true }, id = "fx") => ({
  id,
  slug: id,
  label: id,
  manual: true,
  kind: "modifier",
  targets,
  modifiers: [{ selector, value, type }],
  conditions: []
});
function setup(effects = [], extra = {}) {
  installFoundryMock();
  return makeShip({ id: "ship", name: "Ship", effects, extra: { skills: { computers: 10 }, ...extra } });
}
function preview(ship, target, stationId = "g", actionId = "strike", weaponId = "w1") {
  const ctx = {
    shipUuid: ship.uuid,
    ship,
    data: ship.flags[M].starship,
    stats: computeShipStats(ship),
    station: { id: stationId },
    action: { id: actionId },
    options: {},
    tsc: {
      objects: [
        { key: ship.uuid, zone: 1 },
        { key: target.uuid, zone: 2, heading: "left" }
      ]
    }
  };
  return computeAttackModifiers(ctx, { id: weaponId, traits: [] }, { key: target.uuid, actor: target, data: target.flags[M].starship });
}

test("station-only AC does not leak into ship AC", () => {
  const ship = setup([effect("ac", -3, "circumstance", { entire: false, stations: ["g"] })]);
  assert.equal(computeShipStats(ship).ac, 20);
});
test("NPC native armorClass DC retains prepared base adjustments and typed penalties", () => {
  const ship = setup([effect("ac", -2)]);
  ship.type = "npc";
  ship._source = { system: { attributes: { ac: { value: 20 } } } };
  const base = {
    slug: "base",
    label: "Base",
    modifier: 11,
    type: "untyped",
    clone() {
      return { ...this };
    }
  };
  ship.armorClass = { value: 21, modifiers: [base], options: new Set() };
  game.pf2e.StatisticModifier = class {
    constructor(_slug, modifiers) {
      const stacked = stackModifiers(modifiers.map((m) => ({ ...m, value: m.modifier })));
      this.totalModifier = stacked.total;
      this.modifiers = modifiers.map((m) => ({ ...m, enabled: stacked.applied.some((a) => a.slug === m.slug) }));
    }
  };
  assert.equal(computeShipStats(ship).ac, 19);
  assert.equal(ship.armorClass.value, 21);
});
test("stored ship skill receives its typed effect", () => {
  const ship = setup([effect("computers", -2)]);
  assert.equal(shipModuleValue(ship, "computers"), 8);
});
test("sheet skill row matches effective ship skill without a native constructor", () => {
  const ship = setup([effect("computers", -2)]);
  assert.equal(shipCheckRows(ship).find((r) => r.slug === "computers").mod, 8);
});
test("global circumstance AC penalty and off-guard share one stack", () => {
  const ship = setup();
  const target = makeShip({
    id: "target",
    name: "Target",
    effects: [effect("ac", -3, "circumstance"), { id: "og", conditions: ["off-guard"] }]
  });
  assert.equal(preview(ship, target).ac, 17);
});
test("weapon-only bonus applies once to chosen attack and not unrelated check", () => {
  const ship = setup([effect("attack", 2, "untyped", { entire: false, weapons: ["w1"] })]);
  const target = makeShip({ id: "target", name: "Target" });
  assert.equal(preview(ship, target).total, 2);
  assert.equal(preview(ship, target, "g", "strike", "w2").total, 0);
  assert.equal(shipModuleValue(ship, "computers"), 10);
});
test("entire-ship untyped native all modifier is not repeated as a station extension", () => {
  const ship = setup([effect("all", 2, "untyped")]);
  const target = makeShip({ id: "target", name: "Target" });
  assert.equal(preview(ship, target).total, 2);
  assert.equal(preview(target, ship).ac, 22);
  assert.equal(shipModuleValue(ship, "reflex", { againstUuid: target.uuid, area: true }), 10);
  ship.flags[M].starship.effects[0].modifiers.push({ selector: "station-check", value: 1, type: "untyped" });
  const combined = preview(ship, target);
  assert.equal(combined.total, 3);
  assert.equal(new Set(combined.mods.map((m) => m.slug)).size, 2);
  ship.flags[M].starship.effects = [
    effect("attack", 2, "untyped", { entire: true }, "first"),
    { ...effect("attack", 3, "untyped", { entire: true }, "second"), slug: "first" }
  ];
  assert.equal(preview(ship, target).total, 5);
});
test("manual off-kilter contributes one typed attack component", () => {
  const ship = setup([
    { id: "kilter", manual: true, kind: "condition", slug: "off-kilter", targets: { entire: true }, conditions: ["off-kilter"] }
  ]);
  const target = makeShip({ id: "target", name: "Target" });
  const result = preview(ship, target);
  assert.equal(result.total, -2);
  assert.equal(result.mods.filter((m) => m.type === "circumstance" && m.value === -2).length, 1);
});
test("manual clumsy reaches ranged native Dexterity domains but not melee or Computers", () => {
  installNativeEffectsFixture();
  const ship = nativeActor(
    makeShip({
      id: "ship",
      name: "Ship",
      effects: [
        {
          id: "clumsy",
          manual: true,
          kind: "condition",
          slug: "clumsy",
          conditionValue: 2,
          targets: { entire: true },
          conditions: ["clumsy"]
        }
      ],
      extra: { skills: { computers: 10 } }
    })
  );
  const target = makeShip({ id: "target", name: "Target" });
  assert.equal(preview(ship, target).total, -2);
  assert.equal(shipModuleValue(ship, "computers"), 10);
  const ctx = {
    ship,
    shipUuid: ship.uuid,
    data: ship.flags[M].starship,
    stats: computeShipStats(ship),
    options: { npcStrike: { kind: "melee" } },
    action: { id: "npc-strike:blade" },
    tsc: {
      objects: [
        { key: ship.uuid, zone: 1 },
        { key: target.uuid, zone: 1 }
      ]
    }
  };
  assert.equal(
    computeAttackModifiers(ctx, { id: "blade", npc: true, traits: [] }, { key: target.uuid, actor: target, data: target.flags[M].starship })
      .total,
    0
  );
});
test("individual action scope requires the exact station/action pair", () => {
  const ship = setup([effect("attack", 2, "status", { entire: false, actions: [{ stationId: "g", actionId: "strike" }] })]);
  const target = makeShip({ id: "target", name: "Target" });
  assert.equal(preview(ship, target).total, 2);
  assert.equal(preview(ship, target, "g", "other").total, 0);
  assert.equal(preview(ship, target, "other").total, 0);
});
test("manual inoperable overlay removal preserves the underlying damage state", () => {
  const ship = setup([
    { id: "inop", manual: true, kind: "condition", slug: "inoperable", targets: { entire: true }, conditions: ["inoperable"] }
  ]);
  assert.equal(computeShipStats(ship).inoperable, true);
  assert.equal(computeShipStats(ship).ac, 14);
  assert.equal(ship.flags[M].starship.inoperable, undefined);
  ship.flags[M].starship.effects = [];
  assert.equal(computeShipStats(ship).inoperable, false);
  assert.equal(computeShipStats(ship).ac, 20);
  ship.flags[M].starship.compromised = 1;
  assert.equal(computeShipStats(ship).inoperable, true);
});

test("manual compromised derives inoperable and off-guard without changing damage state", () => {
  const ship = setup([
    {
      id: "compromised",
      manual: true,
      kind: "condition",
      slug: "compromised",
      conditionValue: 1,
      targets: { entire: true },
      conditions: ["compromised"]
    }
  ]);
  assert.equal(computeShipStats(ship).ac, 14);
  assert.equal(computeShipStats(ship).inoperable, true);
  assert.equal(ship.flags[M].starship.compromised, undefined);
});

test("compromised overlay malfunctions every station without persisting physical state", () => {
  const ship = setup([
    {
      id: "comp",
      manual: true,
      kind: "condition",
      slug: "compromised",
      conditionValue: 1,
      targets: { entire: true },
      conditions: ["compromised"]
    }
  ]);
  ship.flags[M].starship.stations = [{ id: "gun", malfunctioning: false }];
  assert.equal(effectiveEffectStates(ship.flags[M].starship).stations[0].malfunctioning, true);
  assert.equal(ship.flags[M].starship.stations[0].malfunctioning, false);
});

test("Piloting-derived AC reads native DC rather than check-only modifiers", () => {
  const ship = setup();
  const pilot = makeCharacter({ id: "pilot", name: "Pilot" });
  pilot.skills = { piloting: { mod: 30, check: { mod: 31 }, dc: { value: 24 } } };
  ship.flags[M].starship.stations = [{ id: "pilot", type: "pilot", grade: "commercial", helmedBy: pilot.uuid }];
  ship.flags[M].starship.crew = [{ actorUuid: pilot.uuid, role: "crew", stationId: "pilot" }];
  assert.equal(computeShipStats(ship).ac, 24);
});

test("same untyped application on ship and pilot contributes once to Piloting-derived AC", () => {
  const ship = setup([effect("all", 2, "untyped")]);
  const pilot = makeCharacter({ id: "pilot", name: "Pilot" });
  pilot.skills = {
    piloting: {
      mod: 17,
      dc: {
        value: 27,
        modifiers: [
          { slug: "base", value: 15, type: "untyped" },
          { slug: "tsc-fx-0", value: 2, type: "untyped" }
        ]
      }
    }
  };
  ship.flags[M].starship.stations = [{ id: "pilot", type: "pilot", grade: "commercial", helmedBy: pilot.uuid }];
  ship.flags[M].starship.crew = [{ actorUuid: pilot.uuid, role: "crew", stationId: "pilot" }];
  assert.equal(computeShipStats(ship).ac, 27);
});

class NativeStatistic {
  constructor(actor, data) {
    this.actor = actor;
    this.data = data;
    this.domains = data.domains ?? [];
    const synthetic = this.domains.flatMap((d) => (actor.synthetics.modifiers?.[d] ?? []).flatMap((f) => f()));
    const components = [...(data.modifiers ?? []), ...synthetic];
    const total = stackModifiers([...components, ...(data.check?.modifiers ?? [])].map((m) => ({ ...m, value: m.modifier }))).total;
    const dcTotal = stackModifiers([...components, ...(data.dc?.modifiers ?? [])].map((m) => ({ ...m, value: m.modifier }))).total;
    this.mod = total;
    this.check = { mod: total, roll: async () => ({ total: 10 + total, degreeOfSuccess: 2 }) };
    this.dc = { value: 10 + dcTotal };
  }
  clone(data) {
    return new NativeStatistic(this.actor, { ...this.data, ...data, modifiers: [...this.data.modifiers, ...(data.modifiers ?? [])] });
  }
}
test("NPC native status -1 and ship status -2 remain typed and produce -2", () => {
  const ship = setup([effect("computers", -2)]);
  ship.type = "npc";
  ship._source = { system: { skills: { computers: { base: 10 } } } };
  ship.skills = {
    computers: new NativeStatistic(ship, {
      slug: "computers",
      modifiers: [
        { slug: "base", modifier: 10, type: "untyped" },
        { slug: "native-status", modifier: -1, type: "status" }
      ]
    })
  };
  ship.perception = ship.skills.computers;
  assert.equal(shipStatistic(ship, "computers").check.mod, 8);
  assert.equal(shipModuleValue(ship, "computers"), 8);
});
test("ship default check and AC contexts distinguish explicitly DC-only effects", () => {
  const ship = setup([
    { ...effect("reflex", -2), statistic: "dc" },
    { ...effect("ac", -3, "circumstance", { entire: true }, "check-ac"), statistic: "check" }
  ]);
  assert.equal(computeShipStats(ship).reflex, 8);
  assert.equal(computeShipStats(ship).ac, 20);
  assert.equal(shipModuleValue(ship, "reflex", { statistic: "dc" }), 6);
});
test("native check-only modifiers do not become ship statistic DC modifiers", () => {
  const ship = setup();
  ship.type = "npc";
  ship._source = { system: { skills: { computers: { base: 10 } } } };
  ship.skills = {
    computers: new NativeStatistic(ship, {
      slug: "computers",
      domains: ["computers", "skill-check", "all"],
      modifiers: [{ slug: "base", modifier: 10, type: "untyped" }],
      check: { modifiers: [{ slug: "check-only", modifier: 2, type: "status" }] }
    })
  };
  ship.perception = ship.skills.computers;
  assert.equal(shipModuleValue(ship, "computers"), 12);
  assert.equal(shipModuleValue(ship, "computers", { statistic: "dc" }), 10);
});
test("station check bonus does not silently alter the operator skill DC", () => {
  const ship = setup([effect("station-check", 2, "status", { entire: false, stations: ["g"] })]);
  const crew = { type: "character", synthetics: {}, skills: {} };
  crew.skills.computers = new NativeStatistic(crew, { slug: "computers", modifiers: [{ slug: "base", modifier: 10, type: "untyped" }] });
  const stat = stationStatistic(crew, ship, "computers", { stationId: "g", actionId: "identify", statistic: "check" });
  assert.equal(stat.check.mod, 12);
  assert.equal(stat.dc.value, 20);
  assert.equal(crew.skills.computers.check.mod, 10);
});
test("displayed source skill DC uses the same scoped native operator statistic", () => {
  const ship = setup([effect("computers", -2)]);
  const crew = { type: "character", synthetics: {}, skills: {} };
  crew.skills.computers = new NativeStatistic(crew, { slug: "computers", modifiers: [{ slug: "base", modifier: 10, type: "untyped" }] });
  assert.equal(contextDCs(crew, ship, { stationId: "g", actionId: "identify" }).computers, 18);
});
test("uncrewed NPC Area Fire uses its own native class DC", () => {
  const ship = setup();
  ship.type = "npc";
  ship.flags[M].starship.role = "npc";
  ship.classDC = new NativeStatistic(ship, { slug: "class", modifiers: [{ slug: "base", modifier: 20, type: "untyped" }] });
  assert.equal(shipAreaDC(null, ship), 30);
});
test("targeted area Reflex modifiers keep individual types in the native stack", () => {
  const ship = setup([
    effect("reflex", -3, "circumstance"),
    { id: "lock", slug: "lock", against: "Actor.source", modifiers: [{ selector: "reflex-against-area", value: -2, type: "circumstance" }] }
  ]);
  assert.equal(shipModuleValue(ship, "reflex", { againstUuid: "Actor.source", area: true }), 5);
});
test("station damage forwards the exact action and weapon scope", () => {
  const ship = setup([effect("station-damage", 2, "untyped", { entire: false, actions: [{ stationId: "g", actionId: "strike" }] })]);
  const ctx = { data: ship.flags[M].starship, station: { id: "g" }, action: { id: "strike" } };
  assert.equal(damageFormula(ctx, { id: "w1", die: "1d6" }, false), "1d6+2");
  ctx.action.id = "other";
  assert.equal(damageFormula(ctx, { id: "w1", die: "1d6" }, false), "1d6");
});
test("NPC weapon separates persistent components from immediate damage", () => {
  setup();
  const weapon = resolveWeapon({ options: { npcStrike: { name: "Laser", attack: 10, damage: "2d6 fire plus 1d4 persistent fire" } } });
  assert.equal(weapon.formula, "2d6");
  assert.deepEqual(weapon.damageParts, [{ formula: "2d6", type: "fire" }]);
  assert.deepEqual(weapon.persistentParts, [{ formula: "1d4", type: "fire", category: "persistent" }]);
});
test("sheet NPC damage preview retains the separate persistent category", () => {
  const ship = setup([], { strikes: [{ name: "Laser", attack: 10, damage: "1d6 fire plus 1d4 persistent electricity" }] });
  assert.match(sheetAttackRows(ship).find((r) => r.kind === "strike").damageText, /1d4 persistent/i);
});
test("NPC actual roll receives the same scoped attack modifiers as preview", async () => {
  const ship = setup([effect("attack", 2, "untyped", { entire: false, weapons: ["Laser"] })]);
  ship.type = "npc";
  ship.perception = new NativeStatistic(ship, { slug: "perception", modifiers: [] });
  const target = makeShip({ id: "target", name: "Target" });
  const ctx = {
    ship,
    shipUuid: ship.uuid,
    data: ship.flags[M].starship,
    stats: computeShipStats(ship),
    options: { npcStrike: { name: "Laser", attack: 10, damage: "1d6 fire" }, sheetRoll: true },
    station: { id: "g" },
    action: { id: "npc-strike:laser" },
    lines: [],
    reports: [],
    tsc: {
      objects: [
        { key: ship.uuid, zone: 1 },
        { key: target.uuid, zone: 2, heading: "left" }
      ]
    },
    target: { key: target.uuid, uuid: target.uuid, actor: target, data: target.flags[M].starship }
  };
  const pre = computeAttackModifiers(ctx, resolveWeapon(ctx), ctx.target);
  await resolveStrike(ctx);
  assert.deepEqual(
    ctx.attackResult.modifiers,
    pre.mods.map(({ label, value }) => ({ label, value }))
  );
  assert.equal(ctx.attackResult.total, 22);
});
test("NPC attack preview preserves native item modifiers and actual roll stacks typed penalties", async () => {
  const ship = setup([effect("attack", -2)]);
  ship.type = "npc";
  ship.perception = new NativeStatistic(ship, { slug: "perception", modifiers: [] });
  const nativeMod = (slug, modifier, type) => ({
    slug,
    modifier,
    type,
    clone() {
      return { ...this };
    }
  });
  ship.system.actions = [
    {
      type: "strike",
      item: { name: "Laser", _source: { system: { bonus: { value: 10 } } } },
      modifiers: [nativeMod("base", 10, "untyped"), nativeMod("native-status", -1, "status")]
    }
  ];
  const target = makeShip({ id: "target", name: "Target" });
  const ctx = {
    ship,
    shipUuid: ship.uuid,
    data: ship.flags[M].starship,
    stats: computeShipStats(ship),
    options: { npcStrike: { name: "Laser", attack: 10, damage: "1d6 fire" }, sheetRoll: true },
    action: { id: "npc-strike:laser" },
    lines: [],
    reports: [],
    tsc: {
      objects: [
        { key: ship.uuid, zone: 1 },
        { key: target.uuid, zone: 2, heading: "left" }
      ]
    },
    target: { key: target.uuid, uuid: target.uuid, actor: target, data: target.flags[M].starship }
  };
  assert.equal(knownAttackBonus(ctx, resolveWeapon(ctx)).value, 9);
  assert.equal(computeAttackModifiers(ctx, resolveWeapon(ctx), ctx.target).effectiveAttackBonus, 8);
  await resolveStrike(ctx);
  assert.equal(ctx.attackResult.total, 18);
});
test("sheet NPC attack preview receives scoped native modifiers", () => {
  const ship = setup([effect("attack", -2)]);
  ship.type = "npc";
  ship.perception = new NativeStatistic(ship, { slug: "perception", modifiers: [] });
  const nativeMod = (slug, modifier, type) => ({
    slug,
    modifier,
    type,
    clone() {
      return { ...this };
    }
  });
  ship.system.actions = [
    {
      type: "strike",
      item: { name: "Laser", _source: { system: { bonus: { value: 10 } } } },
      modifiers: [nativeMod("base", 10, "untyped"), nativeMod("native-status", -1, "status")]
    }
  ];
  ship.flags[M].starship.strikes = [{ name: "Laser", attack: 10, damage: "1d6 fire" }];
  assert.equal(sheetAttackRows(ship).find((r) => r.kind === "strike").bonusText, "+8");
});
test("NPC native construction failure does not silently roll a statblock fallback", async () => {
  const ship = setup();
  ship.type = "npc";
  ship.perception = {
    constructor: class {
      constructor() {
        throw new Error("native failure");
      }
    }
  };
  const target = makeShip({ id: "target", name: "Target" });
  const ctx = {
    ship,
    shipUuid: ship.uuid,
    data: ship.flags[M].starship,
    stats: { sensorRange: 6 },
    options: { npcStrike: { name: "Laser", attack: 10, damage: "1d6 fire" }, sheetRoll: true },
    action: { id: "npc-strike:laser" },
    lines: [],
    reports: [],
    tsc: {
      objects: [
        { key: ship.uuid, zone: 1 },
        { key: target.uuid, zone: 2, heading: "left" }
      ]
    },
    target: { key: target.uuid, uuid: target.uuid, actor: target, data: target.flags[M].starship }
  };
  await assert.rejects(() => resolveStrike(ctx), /did not complete/i);
});
test("NPC persistent damage keeps its category", () => {
  assert.deepEqual(npcDamageParts("2d6 piercing plus 1d4 persistent electricity"), [
    { formula: "2d6", type: "piercing" },
    { formula: "1d4", type: "electricity", category: "persistent" }
  ]);
});
