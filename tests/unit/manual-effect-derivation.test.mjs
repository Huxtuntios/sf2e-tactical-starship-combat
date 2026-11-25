import test from "node:test";
import assert from "node:assert/strict";
import { makeShip, installFoundryMock } from "../helpers/foundry-mock.mjs";
import * as Effects from "../../scripts/starship/effects.mjs";

function installNativeEffectsFixture() {
  installFoundryMock();
  const definitions = new Map([
    ["frightened", { valued: true, rules: [{ key: "FlatModifier", selector: "all", type: "status", value: "-@item.badge.value" }] }],
    ["clumsy", { valued: true, rules: [{ key: "FlatModifier", selector: "dex-based", type: "status", value: "-@item.badge.value" }] }],
    ["off-guard", { valued: false, rules: [{ key: "FlatModifier", selector: "ac", type: "circumstance", value: -2 }] }],
    ["unconscious", { valued: false, rules: [{ key: "ActiveEffectLike", path: "system.foo", value: true }] }],
    ["persistent-damage", { valued: false, rules: [] }]
  ]);
  class NativeItem {
    constructor(source, { parent = null } = {}) {
      this._source = structuredClone(source);
      Object.assign(this, structuredClone(source));
      this.parent = parent;
      this.actor = parent;
      this.id = source._id;
      this.slug = source.system.slug;
      this.active = true;
    }
    get badge() {
      return { value: this.system.value.value };
    }
    isOfType(...types) {
      return types.includes(this.type);
    }
    toObject() {
      return structuredClone(this._source);
    }
    clone(changes = {}) {
      return new NativeItem({ ...this.toObject(), ...changes });
    }
    getRollOptions() {
      return [`item:type:${this.type}`, `item:slug:${this.slug}`];
    }
  }
  class FlatModifier {
    constructor(source, { parent }) {
      this.source = source;
      this.item = parent;
      this.actor = parent.actor;
    }
    beforePrepareData() {
      for (const selector of [this.source.selector].flat()) {
        (this.actor.synthetics.modifiers[selector] ??= []).push(({ test = [] } = {}) => {
          const modifier = typeof this.source.value === "number" ? this.source.value : -this.item.badge.value;
          const enabled = (this.source.predicate ?? []).every((option) => test.includes(option));
          return {
            modifier,
            slug: this.source.slug,
            type: this.source.type,
            label: this.item.name,
            predicate: this.source.predicate ?? [],
            enabled,
            ignored: !enabled
          };
        });
      }
    }
  }
  game.pf2e.RuleElements = { builtin: { FlatModifier } };
  game.pf2e.ConditionManager = {
    conditionsSlugs: [...definitions.keys()],
    getCondition(slug) {
      const def = definitions.get(slug);
      return def
        ? new NativeItem({
            type: "condition",
            name: slug,
            system: {
              slug,
              rules: structuredClone(def.rules),
              value: { isValued: def.valued, value: def.valued ? 1 : null },
              traits: { value: [] },
              references: { children: [], overrides: [], overriddenBy: [] }
            }
          })
        : null;
    }
  };
  CONFIG.Item = { documentClass: NativeItem };
  CONFIG.PF2E = {
    Item: { documentClasses: { condition: NativeItem, effect: NativeItem } },
    damageTypes: { fire: "Fire", bleed: "Bleed", void: "Void", vitality: "Vitality" },
    skills: { piloting: { attribute: "dex" }, arcana: { attribute: "int" } }
  };
  return { definitions, NativeItem };
}

function nativeActor(actor, { immune = [], unaffected = [] } = {}) {
  actor.isImmuneTo = function (item) {
    return immune.includes(typeof item === "string" ? item : item.slug);
  };
  actor.isAffectedBy = function (item) {
    return !unaffected.includes(item.slug);
  };
  actor.clone = function () {
    return { uuid: this.uuid, type: this.type, synthetics: { modifiers: {} }, getRollOptions: () => [], canHostRuleElements: true };
  };
  const create = actor.createEmbeddedDocuments.bind(actor);
  actor.createEmbeddedDocuments = async function (type, sources, options) {
    const allowed = sources.filter((source) => {
      const item = new CONFIG.Item.documentClass(source, { parent: actor });
      return this.isAffectedBy(item) && !this.isImmuneTo(item);
    });
    for (const source of allowed.filter((item) => item.type === "effect")) {
      const sourceId = source._stats?.duplicateSource ?? source._stats?.compendiumSource;
      const expired = [...this.items.values()].filter(
        (item) =>
          item.type === "effect" && item.system?.expired && (item._stats?.duplicateSource ?? item._stats?.compendiumSource) === sourceId
      );
      if (expired.length)
        await this.deleteEmbeddedDocuments(
          "Item",
          expired.map((item) => item.id)
        );
    }
    const docs = await create(type, allowed, options);
    if (options?.keepId)
      for (let index = 0; index < docs.length; index++) {
        this.items.delete(docs[index].id);
        docs[index].id = allowed[index]._id;
        this.items.set(docs[index].id, docs[index]);
      }
    return docs;
  };
  return actor;
}
const { effectModifiers, hasCondition } = Effects;

test("pending and failed applications never claim successful ship mechanics", () => {
  const fx = ["pending", "failed"].map((status) => ({
    id: status,
    status,
    manual: true,
    kind: "condition",
    slug: "off-guard",
    conditions: ["off-guard"],
    modifiers: [{ selector: "ac", type: "circumstance", value: -2 }]
  }));
  assert.deepEqual(effectModifiers(fx, "ac"), []);
  assert.equal(hasCondition(fx, "off-guard", { selector: "ac" }), false);
});
test("native-derived conditions refresh rules and real station ability context", () => {
  const { definitions } = installNativeEffectsFixture();
  const ship = nativeActor(makeShip({ id: "ship" }));
  const fx = [
    {
      id: "a",
      manual: true,
      kind: "condition",
      slug: "clumsy",
      conditionValue: 3,
      targets: { entire: false, stations: ["pilot"] },
      modifiers: []
    }
  ];
  assert.equal(effectModifiers(fx, "station-check", { actor: ship, stationId: "pilot", skill: "piloting" })[0]?.value, -3);
  assert.deepEqual(effectModifiers(fx, "station-check", { actor: ship, stationId: "pilot", skill: "arcana" }), []);
  definitions.get("clumsy").rules[0].value = -8;
  assert.equal(effectModifiers(fx, "station-check", { actor: ship, stationId: "pilot", skill: "piloting" })[0]?.value, -8);
});
test("effective ship states preserve physical values and scoped manual sources", () => {
  assert.equal(typeof Effects.effectiveEffectStates, "function");
  const data = {
    compromised: 0,
    wrecked: 2,
    inoperable: false,
    offKilter: false,
    destroyed: false,
    stations: [
      { id: "pilot", malfunctioning: false },
      { id: "gun", malfunctioning: true }
    ],
    effects: [
      {
        id: "a",
        manual: true,
        slug: "compromised",
        kind: "condition",
        conditionValue: 4,
        conditions: ["compromised"],
        targets: { entire: true }
      },
      {
        id: "b",
        manual: true,
        slug: "malfunctioning",
        kind: "condition",
        conditions: ["malfunctioning"],
        targets: { entire: false, stations: ["pilot"] }
      },
      { id: "c", manual: true, slug: "off-kilter", conditions: ["off-kilter"], targets: { entire: false, crew: ["Actor.pc"] } }
    ]
  };
  const before = structuredClone(data);
  const overlay = Effects.effectiveEffectStates(data);
  assert.equal(overlay.compromised, 4);
  assert.equal(overlay.inoperable, true);
  assert.equal(overlay.wrecked, 2);
  assert.equal(overlay.offKilter, false);
  assert.equal(overlay.stations[0].malfunctioning, true);
  assert.equal(overlay.stations[1].malfunctioning, true);
  assert.deepEqual(data, before);
  const removed = Effects.effectiveEffectStates({ ...data, effects: [] });
  assert.equal(removed.compromised, 0);
  assert.equal(removed.stations[0].malfunctioning, false);
  assert.equal(removed.stations[1].malfunctioning, true);
});
test("numeric all and native skill/save selectors match checks and DC but not damage", () => {
  installNativeEffectsFixture();
  const fx = [
    {
      id: "a",
      slug: "manual",
      manual: true,
      kind: "bonus",
      modifiers: [
        { selector: "all", type: "status", value: 1 },
        { selector: "saving-throw", type: "item", value: 2 },
        { selector: "skill-check", type: "circumstance", value: 3 }
      ]
    }
  ];
  assert.deepEqual(
    effectModifiers(fx, "reflex").map((m) => m.value),
    [1, 2]
  );
  assert.deepEqual(
    effectModifiers(fx, "station-check", { skill: "piloting" }).map((m) => m.value),
    [1, 3]
  );
  assert.deepEqual(effectModifiers(fx, "station-damage"), []);
});
