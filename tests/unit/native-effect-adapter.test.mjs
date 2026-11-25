import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeCharacter, makeShip } from "../helpers/foundry-mock.mjs";

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

const adapter = await import("../../scripts/starship/native-effect-adapter.mjs").catch(() => ({}));
const record = (extra = {}) => ({
  id: "application",
  manual: true,
  kind: "condition",
  slug: "frightened",
  label: "Frightened",
  conditionValue: 3,
  nativeTargets: [],
  ...extra
});

test("derivation uses native rule values and isolates real actor synthetics", () => {
  assert.equal(typeof adapter.deriveConditionModifiers, "function");
  const { definitions } = installNativeEffectsFixture();
  const ship = nativeActor(makeShip({ id: "ship" }));
  const before = structuredClone(ship.synthetics);
  assert.equal(adapter.deriveConditionModifiers("frightened", 3, { actor: ship, selector: "reflex" })[0].value, -3);
  definitions.get("frightened").rules[0].value = -7;
  assert.equal(adapter.deriveConditionModifiers("frightened", 3, { actor: ship, selector: "will" })[0].value, -7);
  assert.deepEqual(ship.synthetics, before);
});
test("native dex and predicate semantics map safely to ship AC and real skills", () => {
  assert.equal(typeof adapter.deriveConditionModifiers, "function");
  const { definitions } = installNativeEffectsFixture();
  const ship = nativeActor(makeShip({ id: "ship" }));
  assert.equal(adapter.deriveConditionModifiers("clumsy", 4, { actor: ship, selector: "ac" })[0].value, -4);
  assert.equal(adapter.deriveConditionModifiers("clumsy", 4, { actor: ship, selector: "reflex" })[0].value, -4);
  assert.deepEqual(adapter.deriveConditionModifiers("clumsy", 4, { actor: ship, selector: "will" }), []);
  definitions.get("frightened").rules[0].predicate = ["authorized-option"];
  assert.deepEqual(adapter.deriveConditionModifiers("frightened", 2, { actor: ship, selector: "reflex" }), []);
  assert.equal(
    adapter.deriveConditionModifiers("frightened", 2, { actor: ship, selector: "reflex", options: ["authorized-option"] }).length,
    1
  );
});
test("condition choices flag unsupported ship rules and valued native support", () => {
  assert.equal(typeof adapter.getConditionOptions, "function");
  installNativeEffectsFixture();
  const choices = adapter.getConditionOptions();
  assert.equal(choices.find((c) => c.slug === "frightened").valued, true);
  assert.equal(choices.find((c) => c.slug === "frightened").shipSupported, true);
  assert.equal(choices.find((c) => c.slug === "unconscious").shipSupported, false);
  assert.equal(choices.find((c) => c.slug === "off-kilter").nativeCrew, false);
});
test("native empty creation is rejection and forged persistent bypass flags are ignored", async () => {
  assert.equal(typeof adapter.createNativeEffect, "function");
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }), { immune: ["frightened"] });
  await assert.rejects(adapter.createNativeEffect(actor, record({ flags: { ignoreImmunities: true } })), {
    message: game.i18n.localize("SF2eTSC.effects.errors.nativeRejected")
  });
  assert.equal(actor.items.size, 0);
});
test("authorized immunity override is one creation only and restores instance behavior", async () => {
  assert.equal(typeof adapter.createNativeEffect, "function");
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }), { immune: ["frightened"] });
  const original = actor.isImmuneTo;
  const create = actor.createEmbeddedDocuments;
  let unrelatedImmune;
  actor.createEmbeddedDocuments = async function (type, sources, options) {
    const forged = new CONFIG.Item.documentClass({ ...sources[0], _id: "unrelated" }, { parent: actor });
    unrelatedImmune = this.isImmuneTo(forged);
    return create.call(this, type, sources, options);
  };
  const item = await adapter.createNativeEffect(actor, record({ ignoreImmunities: true }));
  assert.equal(actor.items.has(item.id), true);
  assert.equal(unrelatedImmune, true);
  assert.equal(actor.isImmuneTo, original);
  assert.equal(actor.isImmuneTo("frightened"), true);
});
test("GM-only trusted override never bypasses unaffected targets and restores after throw", async () => {
  assert.equal(typeof adapter.createNativeEffect, "function");
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }), { immune: ["frightened"], unaffected: ["frightened"] });
  const original = actor.isImmuneTo;
  await assert.rejects(adapter.createNativeEffect(actor, record({ ignoreImmunities: true })), {
    message: game.i18n.localize("SF2eTSC.effects.errors.nativeRejected")
  });
  assert.equal(actor.isImmuneTo, original);
  actor.createEmbeddedDocuments = async () => {
    throw new Error("disk failure");
  };
  await assert.rejects(adapter.createNativeEffect(actor, record({ ignoreImmunities: true })), /disk failure/);
  assert.equal(actor.isImmuneTo, original);
  game.user = game.users.get("p1");
  await assert.rejects(adapter.createNativeEffect(actor, record({ ignoreImmunities: true })), /GM|gmOnly/);
});
test("numeric effect ignore flag cannot bypass native effect immunity", async () => {
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }), { immune: ["tsc-application"] });
  await assert.rejects(
    adapter.createNativeEffect(
      actor,
      record({ kind: "bonus", ignoreImmunities: true, modifiers: [{ selector: "ac", value: 2, type: "status" }] })
    ),
    { message: game.i18n.localize("SF2eTSC.effects.errors.nativeRejected") }
  );
  assert.equal(actor.items.size, 0);
});
test("native source identity never replaces foreign expired unlinked effects", async () => {
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }));
  const foreign = (
    await actor.createEmbeddedDocuments("Item", [{ type: "effect", name: "Foreign expired", system: { slug: "foreign", expired: true } }])
  )[0];
  await adapter.createNativeEffect(actor, record({ kind: "bonus", modifiers: [{ selector: "ac", value: 2, type: "status" }] }));
  assert.equal(actor.items.has(foreign.id), true);
});
test("numeric native check-only and DC-only selectors remain disjoint", async () => {
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }));
  actor.saves = {
    reflex: {
      slug: "reflex",
      domains: ["all", "saving-throw", "reflex"],
      check: { domains: ["all", "saving-throw", "reflex", "check", "reflex-check"] },
      dc: { domains: ["all", "saving-throw", "reflex", "reflex-dc"] }
    }
  };
  actor.getStatistic = (slug) => actor.saves[slug];
  const check = await adapter.createNativeEffect(
    actor,
    record({ kind: "bonus", statistic: "check", modifiers: [{ selector: "reflex", type: "status", value: 2 }] })
  );
  assert.deepEqual(check.system.rules[0].selector, ["reflex-check"]);
  assert.equal(
    check.system.rules[0].selector.some((domain) => actor.saves.reflex.dc.domains.includes(domain)),
    false
  );
  const dc = await adapter.createNativeEffect(
    actor,
    record({ kind: "bonus", statistic: "dc", modifiers: [{ selector: "reflex", type: "status", value: 2 }] })
  );
  assert.deepEqual(dc.system.rules[0].selector, ["reflex-dc"]);
  assert.equal(
    dc.system.rules[0].selector.some((domain) => actor.saves.reflex.check.domains.includes(domain)),
    false
  );
  const all = await adapter.createNativeEffect(
    actor,
    record({ kind: "bonus", statistic: "check", modifiers: [{ selector: "all", type: "status", value: 2 }] })
  );
  assert.deepEqual(all.system.rules[0].selector, ["check"]);
});
test("native numerical effect and persistent source use real Item fields and exact owned removal", async () => {
  assert.equal(typeof adapter.createNativeEffect, "function");
  installNativeEffectsFixture();
  const actor = nativeActor(makeCharacter({ id: "pc" }));
  const bonus = await adapter.createNativeEffect(
    actor,
    record({ kind: "bonus", modifiers: [{ selector: "attack", type: "item", value: 2 }] })
  );
  assert.equal(bonus.type, "effect");
  assert.deepEqual(bonus.system.rules[0].selector, ["attack-roll"]);
  assert.equal(bonus.system.rules[0].value, 2);
  const persistent = await adapter.createNativeEffect(
    actor,
    record({
      kind: "persistent-damage",
      slug: "persistent-damage",
      persistent: { formula: "1d6", damageType: "fire", dc: 15, criticalHit: false }
    })
  );
  assert.deepEqual(persistent.system.persistent, { formula: "1d6", damageType: "fire", dc: 15, criticalHit: false });
  const foreign = await actor.createEmbeddedDocuments("Item", [{ type: "effect", name: "foreign", system: { slug: "foreign" } }]);
  await adapter.removeNativeEffect(actor, record(), bonus.id);
  assert.equal(actor.items.has(bonus.id), false);
  assert.equal(actor.items.has(persistent.id), true);
  assert.equal(actor.items.has(foreign[0].id), true);
});
