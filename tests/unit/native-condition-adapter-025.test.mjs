import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";
import { stackModifiers } from "../../scripts/engine/stacking.mjs";

const adapter = await import("../../scripts/starship/native-condition-adapter.mjs").catch(() => ({}));

async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
  const ship = makeShip({ id: "native-condition-ship", name: "Aurora", extra: { skills: { computers: 10 } } });
  return ship;
}

function addConditionSource(ship, slug = "clumsy") {
  const item = {
    id: `${slug}-item`,
    uuid: `${ship.uuid}.Item.${slug}-item`,
    type: "condition",
    slug,
    active: true,
    name: slug,
    system: { value: { isValued: true, value: 2 } }
  };
  ship.items.set(item.id, item);
  return item;
}

class NativeStatistic {
  constructor(actor, data) {
    this.actor = actor;
    this.data = data;
    this.domains = data.domains ?? [];
    const synthetic = this.domains.flatMap((domain) =>
      (actor.synthetics.modifiers?.[domain] ?? []).flatMap((factory) => {
        const modifier = factory({ test: [] });
        return modifier && !modifier.ignored && modifier.enabled !== false ? [modifier] : [];
      })
    );
    this.mod = stackModifiers(
      [...(data.modifiers ?? []), ...synthetic].map((modifier) => ({ ...modifier, value: modifier.modifier }))
    ).total;
    this.check = { mod: this.mod };
  }

  clone(data = {}) {
    const added = data.modifiers ?? [];
    const clone = new NativeStatistic(this.actor, {
      ...this.data,
      ...data,
      modifiers: [...(this.data.modifiers ?? []), ...added]
    });
    clone.added = added;
    return clone;
  }
}

test("native condition modifiers come from SF2e synthetics and keep typed values", async () => {
  assert.equal(typeof adapter.nativeConditionModifiers, "function");
  const ship = await setup();
  const condition = addConditionSource(ship);
  const factory = () => ({ modifier: -4, type: "status", label: "Clumsy", slug: "clumsy", source: condition.uuid });
  ship.synthetics.modifiers = { "dex-based": [factory], ac: [factory] };
  assert.deepEqual(adapter.nativeConditionModifiers(ship, "ac"), [
    { selector: "ac", type: "status", value: -4, label: "Clumsy", slug: "clumsy" }
  ]);
  assert.deepEqual(adapter.nativeConditionModifiers(ship, "reflex"), [
    { selector: "reflex", type: "status", value: -4, label: "Clumsy", slug: "clumsy" }
  ]);
  assert.deepEqual(adapter.nativeConditionModifiers(ship, "will"), []);
});

test("condition facade shares module condition options and derivation semantics", async () => {
  await setup();
  assert.equal(typeof adapter.deriveConditionModifiers, "function");
  const offKilter = adapter.getConditionOptions().find((condition) => condition.slug === "off-kilter");
  assert.equal(offKilter.nativeCrew, false);
  assert.equal(offKilter.shipSupported, true);
  assert.deepEqual(adapter.deriveConditionModifiers("off-kilter", null, { selector: "attack" }), [
    {
      selector: "attack",
      type: "circumstance",
      value: -2,
      label: game.i18n.localize("SF2eTSC.mods.offKilter")
    }
  ]);
  assert.deepEqual(adapter.deriveConditionModifiers("wrecked", 2, { selector: "ac" }), []);
});

test("condition facade applies shared selector aliases without duplicate stacking", async () => {
  const ship = await setup();
  const condition = addConditionSource(ship);
  const factory = () => ({ modifier: -2, type: "status", label: "Clumsy", slug: "clumsy", source: condition.uuid });
  ship.synthetics.modifiers = {
    ac: [factory],
    "dex-based": [factory],
    reflex: [factory],
    "saving-throw": [factory]
  };
  const expected = [{ selector: "ac-against-strikes", type: "status", value: -2, label: "Clumsy", slug: "clumsy" }];
  assert.deepEqual(adapter.nativeConditionModifiers(ship, "ac-against-strikes"), expected);
  assert.deepEqual(adapter.nativeConditionModifiers(ship, "reflex-against-area"), [
    { selector: "reflex-against-area", type: "status", value: -2, label: "Clumsy", slug: "clumsy" }
  ]);
});

test("native condition facade rejects persistent damage before native creation", async () => {
  const ship = await setup();
  game.pf2e.ConditionManager = {
    conditionsSlugs: ["persistent-damage"],
    getCondition(slug) {
      return { name: slug, system: { rules: [], value: { isValued: false } } };
    }
  };
  await assert.rejects(adapter.addNativeCondition(ship, "persistent-damage", 1), {
    message: game.i18n.localize("SF2eTSC.effects.errors.invalidCondition")
  });
});

test("non-condition native modifiers are not folded into module starship statistics", async () => {
  const ship = await setup();
  ship.synthetics.modifiers = {
    ac: [() => ({ modifier: -9, type: "item", label: "Equipment", source: `${ship.uuid}.Item.equipment` })]
  };
  assert.equal(adapter.nativeConditionModifiers(ship, "ac").length, 0);
  const { computeShipStats } = await import("../../scripts/starship/stats.mjs");
  assert.equal(computeShipStats(ship).ac, 20);
});

test("clumsy condition reaches ship AC and Reflex through native domains but not Will or Computers", async () => {
  const ship = await setup();
  const condition = addConditionSource(ship);
  ship.synthetics.modifiers = {
    "dex-based": [() => ({ modifier: -4, type: "status", label: "Clumsy", slug: "clumsy", source: condition.uuid })]
  };
  const { computeShipStats, shipModuleValue } = await import("../../scripts/starship/stats.mjs");
  assert.equal(computeShipStats(ship).ac, 16);
  assert.equal(computeShipStats(ship).reflex, 4);
  assert.equal(computeShipStats(ship).will, 8);
  assert.equal(shipModuleValue(ship, "computers"), 10);
});

test("vehicle Statistic receives the module base once and native condition modifiers once", async () => {
  const ship = await setup();
  const condition = addConditionSource(ship);
  ship.synthetics.modifiers = {
    "dex-based": [() => ({ modifier: -4, type: "status", label: "Clumsy", slug: "clumsy", source: condition.uuid })]
  };
  ship.saves = { fortitude: new NativeStatistic(ship, { slug: "fortitude", modifiers: [] }) };
  const { shipStatistic } = await import("../../scripts/starship/stats.mjs");
  const statistic = shipStatistic(ship, "reflex");
  assert.equal(statistic.check.mod, 4);
  assert.equal(statistic.data.modifiers.length, 1);
  assert.equal(statistic.data.modifiers[0].modifier, 8);
});

test("NPC native Statistic does not receive the same condition delta twice", async () => {
  const ship = await setup();
  ship.type = "npc";
  ship._source = { system: { saves: { reflex: { value: 8 } } } };
  const condition = addConditionSource(ship);
  ship.synthetics.modifiers = {
    "dex-based": [() => ({ modifier: -4, type: "status", label: "Clumsy", slug: "clumsy", source: condition.uuid })]
  };
  const base = { slug: "base", modifier: 8, type: "untyped" };
  ship.saves = { reflex: new NativeStatistic(ship, { slug: "reflex", domains: ["reflex", "dex-based"], modifiers: [base] }) };
  const { shipStatistic } = await import("../../scripts/starship/stats.mjs");
  const statistic = shipStatistic(ship, "reflex");
  assert.equal(statistic.check.mod, 4);
  assert.deepEqual(statistic.added ?? [], []);
});
