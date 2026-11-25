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
