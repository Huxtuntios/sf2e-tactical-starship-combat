import test from "node:test";
import assert from "node:assert/strict";
import { makeCharacter, makeShip, installFoundryMock } from "../helpers/foundry-mock.mjs";
import { createNativeEffect } from "../../scripts/starship/native-effect-adapter.mjs";
import { effectModifiers } from "../../scripts/starship/effects.mjs";

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

test("one numerical application uses the same native and ship element identity, while independent applications stack", async () => {
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }));
  const ship = nativeActor(makeShip({ id: "ship" }));
  const record = {
    id: "application",
    manual: true,
    kind: "bonus",
    slug: "bonus",
    label: "Bonus",
    targets: { entire: true, allCrew: true },
    modifiers: [{ selector: "attack", value: 2, type: "untyped" }]
  };
  const item = await createNativeEffect(actor, record);
  const shipMods = effectModifiers([record], "attack", { actor: ship, weaponId: "laser" });
  assert.equal(shipMods[0].slug, item.system.rules[0].slug);
  const union = new Map([
    [item.system.rules[0].slug, item.system.rules[0].value],
    ...shipMods.map((modifier) => [modifier.slug, modifier.value])
  ]);
  assert.equal(
    [...union.values()].reduce((sum, value) => sum + value, 0),
    2
  );
  const second = { ...record, id: "independent" };
  for (const modifier of effectModifiers([record, second], "attack", { actor: ship, weaponId: "laser" }))
    union.set(modifier.slug, modifier.value);
  assert.equal(
    [...union.values()].reduce((sum, value) => sum + value, 0),
    4
  );
});
test("native condition FlatModifier elements share identity with the derived ship modifier", async () => {
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }));
  const ship = nativeActor(makeShip({ id: "ship" }));
  const record = {
    id: "application",
    manual: true,
    kind: "condition",
    slug: "frightened",
    label: "Frightened",
    conditionValue: 2,
    targets: { entire: true, allCrew: true }
  };
  const item = await createNativeEffect(actor, record);
  const mods = effectModifiers([record], "reflex", { actor: ship });
  assert.equal(mods[0].slug, item.system.rules[0].slug);
  assert.equal(mods[0].value, -2);
});
