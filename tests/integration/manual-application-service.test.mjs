import test from "node:test";
import assert from "node:assert/strict";
import { makeShip, makeCharacter, loadContentFromDisk, installFoundryMock } from "../helpers/foundry-mock.mjs";
import { dispatchSocketMessage } from "../../scripts/socket.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { effectModifiers } from "../../scripts/starship/effects.mjs";
import { shipModifiers } from "../../scripts/starship/stats.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";

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

const service = await import("../../scripts/starship/application-service.mjs").catch(() => ({}));
const effectError = (key) => (err) => err.message.startsWith(game.i18n.localize(`SF2eTSC.effects.errors.${key}`));

async function setup() {
  installNativeEffectsFixture();
  await loadContentFromDisk();
  const pc = nativeActor(makeCharacter({ id: "pc", name: "Pilot" }));
  const gunner = nativeActor(makeCharacter({ id: "gunner", name: "Gunner" }));
  const foreign = nativeActor(makeCharacter({ id: "stranger", name: "Stranger" }));
  const ship = nativeActor(
    makeShip({
      id: "ship",
      name: "Ship",
      crew: [
        { actorUuid: pc.uuid, role: "crew" },
        { actorUuid: gunner.uuid, role: "crew" }
      ],
      stations: [
        { id: "pilot", type: "pilot", grade: "commercial", helmedBy: pc.uuid },
        { id: "gun", type: "gunnery", grade: "commercial", helmedBy: gunner.uuid }
      ],
      weapons: [{ id: "laser", name: "Laser", stationId: "gun" }]
    })
  );
  if (service.registerApplicationService) service.registerApplicationService();
  return { pc, gunner, foreign, ship };
}
const input = (extra = {}) => ({ operationId: "op-1", kind: "condition", slug: "frightened", conditionValue: 2, ...extra });
async function invoke(type, payload, sender = "gm") {
  let result;
  await dispatchSocketMessage({ kind: "request", type, requestId: "request", payload, userId: "gm" }, sender, {
    users: game.users,
    selfId: "gm",
    isActiveGM: true,
    clientEvents: new Map(),
    emit: (response) => {
      result = response;
    }
  });
  return result;
}

test("catalog uses installed actions and weapons and only crew registry/assignments", async () => {
  assert.equal(typeof service.getEffectTargetCatalog, "function");
  const { ship, pc, gunner, foreign } = await setup();
  const catalog = service.getEffectTargetCatalog(ship);
  assert.deepEqual(catalog.crew.map((c) => c.uuid).sort(), [pc.uuid, gunner.uuid].sort());
  assert.equal(
    catalog.crew.some((c) => c.uuid === foreign.uuid),
    false
  );
  assert.equal(
    catalog.stations.find((s) => s.id === "pilot").actions.some((a) => a.id === "evade"),
    true
  );
  assert.deepEqual(catalog.weapons, [{ id: "laser", label: "Laser" }]);
  assert.equal(catalog.weaponDefensesSupported, false);
});
test("NPC target catalog uses actual station actions after native-first row changes", async () => {
  await setup();
  const npcShip = nativeActor(
    makeShip({
      id: "npc-station-actions",
      role: "npc",
      name: "NPC Ship",
      stations: [{ id: "gun", type: "gunnery", grade: "commercial", actions: ["Strike"] }],
      weapons: [{ id: "laser", name: "Laser", stationId: "gun" }]
    })
  );
  const catalog = service.getEffectTargetCatalog(npcShip);
  const action = catalog.stations.flatMap((station) => station.actions).find((entry) => entry.id === "strike");
  assert.ok(action);
  assert.equal(catalog.weaponDefensesSupported, false);
});
test("NPC target catalog includes actual station Strikes, abilities and NPC-only actions", async () => {
  await setup();
  const ship = nativeActor(
    makeShip({
      id: "npc-catalog",
      role: "npc",
      name: "NPC Ship",
      stations: [{ id: "gun", type: "gunnery", grade: "commercial", actions: ["Laser", "Sensor Burst", "Repair Self", "Broken"] }],
      extra: {
        strikes: [
          { name: "Laser", kind: "ranged", attack: 10, damage: "1d6 fire", traits: [] },
          { name: "Broken", kind: "ranged", attack: 10, damage: "", traits: [] }
        ],
        npcActions: [{ name: "Sensor Burst", cost: "one-action", text: "Manual ability" }]
      }
    })
  );
  const catalog = service.getEffectTargetCatalog(ship);
  const actions = catalog.stations.find((station) => station.id === "gun").actions;
  assert.deepEqual(
    actions.map((action) => action.id),
    ["npc-strike:laser", "inline:sensor-burst", "repair-self"]
  );
  assert.equal(actions.find((action) => action.id === "inline:sensor-burst").label, "Sensor Burst");
  const applied = await service.applyManualEffect(
    ship.uuid,
    input({
      kind: "bonus",
      modifiers: [{ selector: "attack", value: 2, type: "status" }],
      targets: { entire: false, actions: [{ stationId: "gun", actionId: "npc-strike:laser" }] }
    })
  );
  assert.equal(applied.status, "applied");
  const context = { actor: ship, stationId: "gun", actionId: "npc-strike:laser", statistic: "check", includeStationCheck: true };
  const slug = `tsc-${applied.applicationId}-0`;
  assert.equal(shipModifiers(ship, "attack", context).find((modifier) => modifier.slug === slug)?.value, 2);
  await service.removeManualEffect(ship.uuid, applied.applicationId);
  assert.equal(
    shipModifiers(ship, "attack", context).some((modifier) => modifier.slug === slug),
    false
  );
});
test("entire NPC ship attack modifiers still support valid Strikes without a station", async () => {
  await setup();
  const ship = nativeActor(
    makeShip({
      id: "unstationed-npc",
      role: "npc",
      name: "NPC Ship",
      extra: { strikes: [{ name: "Ram", kind: "melee", attack: 10, damage: "1d6 bludgeoning", traits: [] }] }
    })
  );
  const result = await service.applyManualEffect(
    ship.uuid,
    input({
      kind: "bonus",
      modifiers: [{ selector: "attack", value: 2, type: "status" }]
    })
  );
  assert.equal(result.status, "applied");
  const context = { actor: ship, actionId: "npc-strike:ram", statistic: "check", includeStationCheck: true };
  const slug = `tsc-${result.applicationId}-0`;
  assert.equal(shipModifiers(ship, "attack", context).find((modifier) => modifier.slug === slug)?.value, 2);
});
test("authenticated player cannot apply effects even with spoofed GM body", async () => {
  assert.equal(typeof service.registerApplicationService, "function");
  const { ship } = await setup();
  const response = await invoke("applyManualEffect", { shipUuid: ship.uuid, input: input() }, "p1");
  assert.equal(response.ok, false);
  assert.equal(response.error, game.i18n.localize("SF2eTSC.effects.errors.gmOnly"));
  assert.equal(readStarship(ship).effects.length, 0);
});
test("default entire ship application has native-derived condition values and preserves applications", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input());
  assert.equal(result.status, "applied");
  const first = readStarship(ship).effects[0];
  assert.equal(first.manual, true);
  assert.equal(first.targets.entire, true);
  assert.equal(first.conditionValue, 2);
  assert.equal(effectModifiers([first], "reflex", { actor: ship })[0].value, -2);
  await service.applyManualEffect(ship.uuid, input({ operationId: "op-2", conditionValue: 3 }));
  assert.equal(readStarship(ship).effects.length, 2);
  assert.equal(pc.items.size, 0);
});
test("empty, stale, incompatible and unsafe numeric/persistent targets reject before writes", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship } = await setup();
  for (const extra of [
    { targets: { entire: false } },
    { targets: { entire: false, stations: ["deleted"] } },
    { targets: { entire: false, actions: [{ stationId: "pilot", actionId: "not-installed" }] } },
    { targets: { entire: false, weapons: ["deleted"] } },
    { targets: { entire: false, crew: ["Actor.stranger"] } },
    { targets: { entire: false, weaponDefenses: true } },
    { slug: "unconscious", ignoreImmunities: true },
    { slug: "persistent-damage", conditionValue: null, targets: { entire: false, crew: ["Actor.pc"] } },
    { kind: "bonus", modifiers: [{ selector: "ac", value: 2, type: "invented" }] },
    { kind: "bonus", modifiers: [{ selector: "ac", value: "2", type: "status" }] },
    { kind: "persistent-damage", persistent: { formula: "1d6;fetch('x')", damageType: "fire", dc: 15 } }
  ])
    await assert.rejects(service.applyManualEffect(ship.uuid, input(extra)));
  assert.equal(readStarship(ship).effects.length, 0);
  assert.equal(globalThis.__writes.length, 0);
});
test("numeric modifiers reject scopes and statistic domains with no mechanical recipient before writes", async () => {
  const { ship } = await setup();
  for (const [selector, targets, statistic] of [
    ["ac", { weapons: ["laser"] }, "both"],
    ["ac", { stations: ["gun"] }, "both"],
    ["ac", { actions: [{ stationId: "pilot", actionId: "evade" }] }, "both"],
    ["attack", { mechanics: ["ac"] }, "both"],
    ["reflex", { weapons: ["laser"] }, "both"],
    ["piloting", { actions: [{ stationId: "gun", actionId: "strike" }] }, "both"],
    ["piloting", { actions: [{ stationId: "pilot", actionId: "evade" }] }, "both"],
    ["ac", { mechanics: ["ac"] }, "check"],
    ["attack", { weapons: ["laser"] }, "dc"]
  ]) {
    await assert.rejects(
      service.applyManualEffect(
        ship.uuid,
        input({
          kind: "bonus",
          statistic,
          modifiers: [{ selector, value: 2, type: "status" }],
          targets: { entire: false, ...targets }
        })
      ),
      effectError("invalidModifier")
    );
    assert.equal(readStarship(ship).effects.length, 0);
    assert.equal(globalThis.__writes.length, 0);
  }
});
test("every numeric modifier needs a compatible target, not only one modifier in the application", async () => {
  const { ship } = await setup();
  await assert.rejects(
    service.applyManualEffect(
      ship.uuid,
      input({
        kind: "bonus",
        modifiers: [
          { selector: "attack", value: 2, type: "status" },
          { selector: "ac", value: 2, type: "status" }
        ],
        targets: { entire: false, weapons: ["laser"] }
      })
    ),
    effectError("invalidModifier")
  );
  assert.equal(readStarship(ship).effects.length, 0);
  assert.equal(globalThis.__writes.length, 0);
});
test("compatible numeric target unions preserve ship, action, weapon and crew recipients", async () => {
  const { ship, pc } = await setup();
  ship.flags[MODULE_ID].starship.stations.find((station) => station.id === "pilot").grade = "tactical";
  for (const [selector, targets, statistic, context] of [
    ["ac", { mechanics: ["ac"], weapons: ["laser"] }, "dc", {}],
    ["attack", { weapons: ["laser"] }, "check", { weaponId: "laser" }],
    ["piloting", { actions: [{ stationId: "pilot", actionId: "juke" }] }, "check", { stationId: "pilot", actionId: "juke" }],
    ["station-check", { stations: ["pilot"] }, "check", { stationId: "pilot", actionId: "juke", skill: "piloting" }]
  ]) {
    const result = await service.applyManualEffect(
      ship.uuid,
      input({
        operationId: foundry.utils.randomID(),
        kind: "bonus",
        statistic,
        modifiers: [{ selector, value: 2, type: "status" }],
        targets: { entire: false, ...targets }
      })
    );
    assert.equal(effectModifiers([result.record], selector, { actor: ship, statistic, ...context })[0].value, 2);
  }
  const crew = await service.applyManualEffect(
    ship.uuid,
    input({
      operationId: "crew-union",
      kind: "bonus",
      modifiers: [{ selector: "ac", value: 2, type: "status" }],
      targets: { entire: false, weapons: ["laser"], crew: [pc.uuid] }
    })
  );
  assert.equal(crew.nativeTargets.length, 1);
  assert.equal(pc.items.get(crew.nativeTargets[0].itemId).system.rules[0].value, 2);
});
test("individual Strike accepts station-check bonuses through the actual attack modifier pipeline", async () => {
  const { ship, gunner } = await setup();
  const config = input({
    kind: "bonus",
    statistic: "check",
    modifiers: [{ selector: "station-check", value: 2, type: "status" }],
    targets: { entire: false, actions: [{ stationId: "gun", actionId: "strike" }] }
  });
  const context = { stationId: "gun", actionId: "strike", weaponId: "laser", statistic: "check", includeStationCheck: true };
  const saved = { ...config, id: "manual-op-1", manual: true, status: "active" };
  const data = { ...readStarship(ship), effects: [saved] };
  assert.equal(shipModifiers(ship, "attack", { ...context, data }).find((modifier) => modifier.slug === "tsc-manual-op-1-0")?.value, 2);
  const result = await service.applyManualEffect(ship.uuid, config);
  assert.equal(shipModifiers(ship, "attack", context).find((modifier) => modifier.slug === `tsc-${result.applicationId}-0`)?.value, 2);
  assert.equal(
    shipModifiers(ship, "attack", { ...context, actionId: "spell-attack" }).some(
      (modifier) => modifier.slug === `tsc-${result.applicationId}-0`
    ),
    false
  );
  assert.equal(
    shipModifiers(ship, "area-dc", { ...context, statistic: "dc", includeStationCheck: false }).some(
      (modifier) => modifier.slug === `tsc-${result.applicationId}-0`
    ),
    false
  );
  assert.equal(gunner.items.size, 0);
});
test("NPC Strike station-check target unions apply once and do not leak to another station", async () => {
  await setup();
  const ship = nativeActor(
    makeShip({
      id: "npc-station-bonus",
      role: "npc",
      name: "NPC Ship",
      stations: [
        { id: "gun", type: "gunnery", grade: "commercial", actions: ["Laser"] },
        { id: "other", type: "gunnery", grade: "commercial", actions: ["Plasma"] }
      ],
      extra: {
        strikes: [
          { name: "Laser", kind: "ranged", attack: 10, damage: "1d6 fire", traits: [] },
          { name: "Plasma", kind: "ranged", attack: 10, damage: "1d6 fire", traits: [] }
        ]
      }
    })
  );
  const result = await service.applyManualEffect(
    ship.uuid,
    input({
      kind: "bonus",
      statistic: "check",
      modifiers: [{ selector: "station-check", value: 2, type: "status" }],
      targets: { entire: false, stations: ["gun"], actions: [{ stationId: "gun", actionId: "npc-strike:laser" }] }
    })
  );
  const context = { actor: ship, stationId: "gun", actionId: "npc-strike:laser", statistic: "check", includeStationCheck: true };
  const otherContext = { ...context, stationId: "other", actionId: "npc-strike:plasma" };
  const slug = `tsc-${result.applicationId}-0`;
  assert.equal(shipModifiers(ship, "attack", context).find((modifier) => modifier.slug === slug)?.value, 2);
  assert.equal(
    shipModifiers(ship, "attack", otherContext).some((modifier) => modifier.slug === slug),
    false
  );
  await service.removeManualEffect(ship.uuid, result.applicationId);
  assert.equal(
    shipModifiers(ship, "attack", context).some((modifier) => modifier.slug === slug),
    false
  );
});
test("unrelated existing attack modifiers cannot make an incompatible candidate valid", async () => {
  const { ship } = await setup();
  await service.applyManualEffect(
    ship.uuid,
    input({ operationId: "existing", kind: "bonus", modifiers: [{ selector: "attack", value: 3, type: "status" }] })
  );
  const before = structuredClone(readStarship(ship));
  await assert.rejects(
    service.applyManualEffect(
      ship.uuid,
      input({ kind: "bonus", modifiers: [{ selector: "ac", value: 2, type: "status" }], targets: { entire: false, weapons: ["laser"] } })
    ),
    effectError("invalidModifier")
  );
  assert.deepEqual(readStarship(ship), before);
});
test("duplicate operations cannot double records/native Items and changed replay rejects", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc } = await setup();
  const config = input({ targets: { entire: false, crew: [pc.uuid] } });
  const [a, b] = await Promise.all([service.applyManualEffect(ship.uuid, config), service.applyManualEffect(ship.uuid, config)]);
  assert.equal(a.applicationId, b.applicationId);
  assert.equal(pc.items.size, 1);
  assert.equal(readStarship(ship).effects.length, 1);
  await assert.rejects(service.applyManualEffect(ship.uuid, { ...config, conditionValue: 3 }), effectError("operationConflict"));
  await service.removeManualEffect(ship.uuid, a.applicationId);
  const replay = await service.applyManualEffect(ship.uuid, config);
  assert.equal(replay.status, "removed");
  assert.equal(pc.items.size, 0);
});
test("allCrew plus specific target dedups; exact removal survives reassignment and preserves foreign Items", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc, gunner, foreign } = await setup();
  const foreignItem = (
    await pc.createEmbeddedDocuments("Item", [{ type: "condition", name: "Foreign", system: { slug: "frightened", value: { value: 1 } } }])
  )[0];
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, allCrew: true, crew: [pc.uuid] } }));
  assert.equal(pc.items.size, 2);
  assert.equal(gunner.items.size, 1);
  assert.equal(foreign.items.size, 0);
  const record = readStarship(ship).effects[0];
  assert.equal(record.nativeTargets.length, 2);
  assert.equal(effectModifiers([record], "ac", { actor: ship }).length, 0);
  ship.flags[MODULE_ID].starship.crew = [];
  ship.flags[MODULE_ID].starship.stations = [];
  await service.removeManualEffect(ship.uuid, result.applicationId);
  assert.equal(pc.items.size, 1);
  assert.equal(pc.items.has(foreignItem.id), true);
  assert.equal(gunner.items.size, 0);
});
test("native rejection reports each rejected target and retains successful crew", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc, gunner } = await setup();
  nativeActor(gunner, { immune: ["frightened"] });
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, allCrew: true } }));
  assert.equal(result.status, "partial");
  assert.equal(result.nativeTargets.length, 1);
  assert.equal(result.rejectedTargets[0].actorUuid, gunner.uuid);
  assert.equal(result.rejectedTargets[0].label, "Gunner");
  assert.equal(pc.items.size, 1);
  assert.equal(gunner.items.size, 0);
});
test("native handles are durable before native creation and survive final save failure", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc } = await setup();
  const update = ship.update.bind(ship);
  let saves = 0;
  ship.update = async (...args) => {
    if (++saves > 1) throw new Error("save failure");
    return update(...args);
  };
  await assert.rejects(service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } })), /save failure/);
  const durable = readStarship(ship).effects[0];
  assert.equal(durable.nativeTargets.length, 1);
  assert.equal(pc.items.has(durable.nativeTargets[0].itemId), true);
  ship.update = update;
  await service.removeManualEffect(ship.uuid, durable.id);
  assert.equal(pc.items.size, 0);
});
test("snapshot preserves original target labels and handles after crew removal", async () => {
  const { ship, pc } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  pc.name = "Renamed";
  ship.flags[MODULE_ID].starship.crew = [];
  const record = readStarship(ship).effects.find((e) => e.id === result.applicationId);
  assert.deepEqual(record.targetSnapshot?.crew, [{ uuid: pc.uuid, label: "Pilot" }]);
});
test("registered removal command cleans manual native Items and the application", async () => {
  const { ship, pc } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  const response = await invoke("removeManualEffect", { shipUuid: ship.uuid, applicationId: result.applicationId });
  assert.equal(response.ok, true);
  assert.equal(response.result.status, "removed");
  assert.equal(pc.items.size, 0);
  assert.equal(readStarship(ship).effects.length, 0);
});
test("numeric crew check and DC configuration uses actual native domains before writes", async () => {
  const { ship, pc } = await setup();
  pc.saves = {
    reflex: {
      slug: "reflex",
      domains: ["all", "reflex", "saving-throw"],
      check: { domains: ["all", "reflex", "saving-throw", "check", "reflex-check"] },
      dc: { domains: ["all", "reflex", "saving-throw", "reflex-dc"] }
    }
  };
  pc.getStatistic = (slug) => pc.saves[slug];
  const result = await service.applyManualEffect(
    ship.uuid,
    input({
      kind: "bonus",
      statistic: "check",
      modifiers: [{ selector: "reflex", type: "status", value: 2 }],
      targets: { entire: false, crew: [pc.uuid] }
    })
  );
  const item = pc.items.get(result.nativeTargets[0].itemId);
  assert.deepEqual(item.system.rules[0].selector, ["reflex-check"]);
  await assert.rejects(
    service.applyManualEffect(
      ship.uuid,
      input({
        operationId: "bad",
        kind: "bonus",
        statistic: "dc",
        modifiers: [{ selector: "attack", type: "status", value: 2 }],
        targets: { entire: false, crew: [pc.uuid] }
      })
    ),
    effectError("incompatibleCrewStatistic")
  );
  assert.equal(readStarship(ship).effects.length, 1);
});
test("native condition incompatible with selected ship mechanics is rejected, not visual success", async () => {
  const { ship } = await setup();
  await assert.rejects(
    service.applyManualEffect(
      ship.uuid,
      input({ slug: "off-guard", conditionValue: null, targets: { entire: false, mechanics: ["skills"] } })
    ),
    effectError("incompatibleShipCondition")
  );
  assert.equal(readStarship(ship).effects.length, 0);
});
test("failed crew replay is rejected rather than falsely returning successful operation", async () => {
  const { ship, pc } = await setup();
  nativeActor(pc, { immune: ["frightened"] });
  const config = input({ targets: { entire: false, crew: [pc.uuid] } });
  await assert.rejects(service.applyManualEffect(ship.uuid, config), effectError("nativeRejected"));
  await assert.rejects(service.applyManualEffect(ship.uuid, config), effectError("nativeRejected"));
});
test("maximum valid operation IDs remain removable after application prefix", async () => {
  const { ship } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ operationId: "x".repeat(128) }));
  await service.removeManualEffect(ship.uuid, result.applicationId);
  assert.equal(readStarship(ship).effects.length, 0);
});
test("partial deletion failure retains exact handles and retry does not touch foreign Items", async () => {
  assert.equal(typeof service.applyManualEffect, "function");
  const { ship, pc, gunner } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, allCrew: true } }));
  const deletion = gunner.deleteEmbeddedDocuments.bind(gunner);
  gunner.deleteEmbeddedDocuments = async () => {
    throw new Error("delete failure");
  };
  await assert.rejects(service.removeManualEffect(ship.uuid, result.applicationId), /Gunner|delete failure/);
  assert.equal(readStarship(ship).effects.length, 1);
  assert.equal(gunner.items.size, 1);
  assert.equal(pc.items.size, 0);
  gunner.deleteEmbeddedDocuments = deletion;
  await service.removeManualEffect(ship.uuid, result.applicationId);
  assert.equal(readStarship(ship).effects.length, 0);
  assert.equal(gunner.items.size, 0);
});

test("persistent effect immunity rejects application without bypassing later damage defenses", async () => {
  const { ship } = await setup();
  ship.flags[MODULE_ID].starship.immunities = ["persistent-damage", "fire"];
  const config = { operationId: "immune-pd", kind: "persistent-damage", persistent: { formula: "1d6", damageType: "fire", dc: 15 } };
  await assert.rejects(service.applyManualEffect(ship.uuid, config), effectError("shipImmune"));
  assert.equal(readStarship(ship).effects.length, 0);
  await service.applyManualEffect(ship.uuid, { ...config, ignoreImmunities: true });
  assert.equal(readStarship(ship).effects.length, 1);
  assert.deepEqual(readStarship(ship).immunities, ["persistent-damage", "fire"]);
});

test("removing a copied application never deletes the original ship's native crew effect", async () => {
  const { ship, pc } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  const copy = nativeActor(makeShip({ id: "copy", name: "Copy" }));
  copy.flags[MODULE_ID].starship = structuredClone(ship.flags[MODULE_ID].starship);
  await service.removeManualEffect(copy.uuid, result.applicationId);
  assert.equal(pc.items.has(result.nativeTargets[0].itemId), true);
  assert.equal(readStarship(ship).effects.length, 1);
  assert.equal(readStarship(copy).effects.length, 0);
});

test("registered service preserves replay, conflict and removal over socket transport", async () => {
  const { ship } = await setup();
  const payload = { shipUuid: ship.uuid, input: input({ operationId: "socket-op" }) };
  const first = await invoke("applyManualEffect", payload);
  assert.equal(first.ok, true);
  assert.equal(first.result.status, "applied");
  const replay = await invoke("applyManualEffect", payload);
  assert.equal(replay.ok, true);
  assert.equal(replay.result.applicationId, first.result.applicationId);
  assert.equal(readStarship(ship).effects.length, 1);
  const conflict = await invoke("applyManualEffect", {
    ...payload,
    input: { ...payload.input, conditionValue: 3 }
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, game.i18n.localize("SF2eTSC.effects.errors.operationConflict"));
  const removed = await invoke("removeManualEffect", { shipUuid: ship.uuid, applicationId: first.result.applicationId });
  assert.equal(removed.ok, true);
  assert.equal(removed.result.status, "removed");
  assert.equal(readStarship(ship).effects.length, 0);
});

test("deleting the source ship cleans linked crew Items through the active-GM hook", { timeout: 2000 }, async () => {
  const { ship, pc } = await setup();
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  const deletion = pc.deleteEmbeddedDocuments.bind(pc);
  let deleted;
  const completion = new Promise((resolve) => {
    deleted = resolve;
  });
  pc.deleteEmbeddedDocuments = async (...args) => {
    const response = await deletion(...args);
    deleted();
    return response;
  };
  await ship.delete();
  await completion;
  assert.equal(pc.items.has(result.nativeTargets[0].itemId), false);
});

test("source ship cleanup removes only its linked native Items", async () => {
  const { ship, pc } = await setup();
  const foreign = (
    await pc.createEmbeddedDocuments("Item", [{ type: "condition", name: "Foreign", system: { slug: "frightened", value: { value: 1 } } }])
  )[0];
  const result = await service.applyManualEffect(ship.uuid, input({ targets: { entire: false, crew: [pc.uuid] } }));
  assert.equal(typeof service.cleanupShipEffectTargets, "function");
  await service.cleanupShipEffectTargets(ship);
  assert.equal(pc.items.has(result.nativeTargets[0].itemId), false);
  assert.equal(pc.items.has(foreign.id), true);
});
