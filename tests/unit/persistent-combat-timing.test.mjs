import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import {
  installFoundryMock,
  loadContentFromDisk,
  makeCharacter,
  makeShip,
  makeStarshipCombat,
  MockActor
} from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { registerCombatHooks } from "../../scripts/combat/starship-combat.mjs";
import { applyManualEffect, registerApplicationService } from "../../scripts/starship/application-service.mjs";
import { registerPersistentDamageService } from "../../scripts/starship/persistent-damage.mjs";

function installPersistentFixture() {
  installFoundryMock();
  CONFIG.PF2E = {
    damageTypes: { fire: "Fire", cold: "Cold" },
    skills: { piloting: { attribute: "dex" }, arcana: { attribute: "int" } }
  };
  const definitions = new Map([
    ["persistent-damage", { valued: false, rules: [] }],
    [
      "frightened",
      {
        valued: true,
        rules: [{ key: "FlatModifier", selector: "all", type: "status", value: "-@item.badge.value" }]
      }
    ]
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
      const definition = definitions.get(slug);
      return definition
        ? new NativeItem({
            type: "condition",
            name: slug,
            system: {
              slug,
              rules: structuredClone(definition.rules),
              value: { isValued: definition.valued, value: definition.valued ? 1 : null },
              traits: { value: [] },
              references: { children: [], overrides: [], overriddenBy: [] }
            }
          })
        : null;
    }
  };
  CONFIG.Item = { documentClass: NativeItem };
  class DamageRoll {
    constructor(formula, _data, options) {
      this.formula = formula;
      this.options = options;
      const match = /^\((.+)\)\[persistent,([a-z-]+)\]$/.exec(formula);
      this.expression = match[1];
      this.type = match[2];
      this.expectedValue =
        Number(
          this.expression
            .replace(/(\d+)d(\d+)/g, (_, count, faces) => (count * (Number(faces) + 1)) / 2)
            .split("+")
            .reduce((total, value) => total + Number(value), 0)
        ) * (options.degreeOfSuccess === 3 ? 2 : 1);
    }
    async evaluate() {
      const match = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(this.expression);
      assert.ok(match, "test roll must use the native persistent formula supplied by the fixture");
      const count = Number(match[1]);
      const faces = Number(match[2]);
      const bonus = Number(match[3] ?? 0);
      this.total = Math.floor((count * (faces + 1)) / 2 + bonus) * (this.options.degreeOfSuccess === 3 ? 2 : 1);
      this.instances = [{ type: this.type, total: this.total, persistent: true, options: this.options }];
      return this;
    }
    toJSON() {
      return { class: "DamageRoll", formula: this.formula, total: this.total, options: this.options };
    }
  }
  CONFIG.Dice = { rolls: [DamageRoll] };
  registerApplicationService();
  registerPersistentDamageService();
}

function nativeActor(actor) {
  actor.isImmuneTo = () => false;
  actor.isAffectedBy = () => true;
  actor.clone = function () {
    return { uuid: this.uuid, type: this.type, synthetics: { modifiers: {} }, getRollOptions: () => [], canHostRuleElements: true };
  };
  const create = actor.createEmbeddedDocuments.bind(actor);
  actor.createEmbeddedDocuments = async function (type, sources, options) {
    const docs = await create(type, sources, options);
    if (options?.keepId)
      for (let index = 0; index < docs.length; index++) {
        this.items.delete(docs[index].id);
        docs[index].id = sources[index]._id;
        this.items.set(docs[index].id, docs[index]);
      }
    return docs;
  };
  return actor;
}

async function setup({ reset = false } = {}) {
  installPersistentFixture();
  await loadContentFromDisk();
  game.settings.set(MODULE_ID, "resetStationsOnInitiative", reset);
  const crew = nativeActor(makeCharacter({ id: "crew", name: "Crew" }));
  const ship = nativeActor(
    makeShip({
      id: "ship",
      name: "Ship",
      sp: 10,
      stations: [
        {
          id: "pilot",
          type: "pilot",
          name: "Pilot",
          grade: "commercial",
          helmedBy: crew.uuid,
          malfunctioning: false,
          malfunctionUntilTurnOf: null,
          repairLockedUntilTurnOf: null
        }
      ],
      crew: [{ actorUuid: crew.uuid, name: crew.name, role: "crew", stationId: "pilot", ready: false }]
    })
  );
  return { crew, ship };
}

async function addPersistent(ship, operationId = "persistent") {
  return applyManualEffect(ship.uuid, {
    operationId,
    kind: "persistent-damage",
    persistent: { formula: "1d4", damageType: "fire" }
  });
}

async function addPrivateShip(combat, ship) {
  await JournalEntry.create({
    name: "Private contacts",
    ownership: { default: 0 },
    flags: {
      [MODULE_ID]: {
        privateSensor: {
          schema: 1,
          combatId: combat.id,
          contacts: [{ key: `private-${ship.id}`, actorUuid: ship.uuid, zone: 1, detection: { party: "undetected" } }]
        }
      }
    }
  });
}

async function settleTurn(combat, changes) {
  await combat.update(changes);
  for (let index = 0; index < 100; index++) {
    const previous = getTsc(combat).lastEffectTurn;
    const current = combat.combatant;
    if (previous?.id === (current?.id ?? null) && previous.round === combat.round && previous.turn === combat.turn) return;
    await setImmediate();
  }
  assert.fail("turn processing did not finish");
}

function intervalKey(combat, round) {
  return `combat:${combat.id}:round:${round}`;
}

test("ordinary ship turn processes one persistent interval through the real combat hook", async () => {
  const { crew, ship } = await setup();
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 2 }] });
  const [crewTurn] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: crew.id, initiative: 20 },
    { actorId: ship.id, initiative: 10 }
  ]);
  registerCombatHooks();
  await addPersistent(ship);
  await settleTurn(combat, { round: 1, turn: 0 });
  assert.equal(crewTurn.actor, crew);
  assert.equal(readStarship(ship).persistentDamageReceipts?.length ?? 0, 0);
  await settleTurn(combat, { round: 1, turn: 1 });
  assert.equal(readStarship(ship).persistentDamageReceipts?.length ?? 0, 0);
  await settleTurn(combat, { round: 2, turn: 0 });
  const receipts = readStarship(ship).persistentDamageReceipts;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].intervalKey, intervalKey(combat, 1));
  assert.equal(receipts[0].status, "pending");
  assert.equal(receipts[0].components[0].amount, 2);
});

test("crew and compromised turns do not create ship persistent ticks", async () => {
  const { crew, ship } = await setup();
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 2 }] });
  const [crewTurn] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: crew.id, initiative: 20 },
    { actorId: ship.id, initiative: 10, flags: { [MODULE_ID]: { compromisedEntry: true, shipUuid: ship.uuid } } }
  ]);
  combat.nextTurn = async () => {};
  registerCombatHooks();
  await addPersistent(ship);
  await settleTurn(combat, { round: 1, turn: 0 });
  assert.equal(crewTurn.actor, crew);
  assert.equal(readStarship(ship).persistentDamageReceipts?.length ?? 0, 0);
  await settleTurn(combat, { round: 1, turn: 1 });
  assert.equal(readStarship(ship).persistentDamageReceipts?.length ?? 0, 0);
});

test("a ship without an ordinary turn receives one end-of-round fallback", async () => {
  const { crew, ship } = await setup();
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 2 }] });
  const [crewTurn] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: crew.id, initiative: 20 },
    { actorId: ship.id, initiative: 10, flags: { [MODULE_ID]: { compromisedEntry: true, shipUuid: ship.uuid } } }
  ]);
  combat.nextTurn = async () => {};
  registerCombatHooks();
  await addPersistent(ship);
  await settleTurn(combat, { round: 1, turn: 0 });
  await settleTurn(combat, { round: 1, turn: 1 });
  assert.equal(readStarship(ship).persistentDamageReceipts?.length ?? 0, 0);
  await settleTurn(combat, { round: 2, turn: 0 });
  assert.equal(crewTurn.actor, crew);
  const receipts = readStarship(ship).persistentDamageReceipts;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].intervalKey, intervalKey(combat, 1));
});

test("turn lifecycle includes private ships and deduplicates public ship entries", async () => {
  const { crew, ship } = await setup();
  const hidden = nativeActor(makeShip({ id: "hidden", name: "Hidden", role: "npc" }));
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, actorUuid: ship.uuid, zone: 2 },
      { key: "copy", actorUuid: ship.uuid, zone: 3 }
    ]
  });
  await addPrivateShip(combat, hidden);
  await combat.createEmbeddedDocuments("Combatant", [{ actorId: crew.id, initiative: 20 }]);
  registerCombatHooks();
  await addPersistent(ship);
  await addPersistent(hidden, "hidden-persistent");
  await settleTurn(combat, { round: 1, turn: 0 });
  await settleTurn(combat, { round: 2, turn: 0 });
  assert.equal(readStarship(ship).persistentDamageReceipts.length, 1);
  assert.equal(readStarship(hidden).persistentDamageReceipts.length, 1);
  assert.equal(readStarship(ship).persistentDamageReceipts[0].intervalKey, intervalKey(combat, 1));
  assert.equal(readStarship(hidden).persistentDamageReceipts[0].intervalKey, intervalKey(combat, 1));
});

test("expired manual effects remove their exact native crew mirrors on a true forward turn", async () => {
  const { crew, ship } = await setup();
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 2 }] });
  const [anchor] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: crew.id, initiative: 20 },
    { actorId: "Actor.next", initiative: 10 }
  ]);
  const nextActor = new MockActor({ id: "Actor.next", type: "character", name: "Next" });
  game.actors.set(nextActor.id, nextActor);
  registerCombatHooks();
  const timed = await applyManualEffect(ship.uuid, {
    operationId: "timed-frightened",
    kind: "condition",
    slug: "frightened",
    conditionValue: 1,
    targets: { crew: [crew.uuid] },
    timing: { mode: "turn-end", combatantId: anchor.id }
  });
  const indefinite = await applyManualEffect(ship.uuid, {
    operationId: "indefinite-frightened",
    kind: "condition",
    slug: "frightened",
    conditionValue: 1,
    targets: { crew: [crew.uuid] }
  });
  assert.equal(crew.items.size, 2);
  combat.turn = 0;
  await settleTurn(combat, { round: 1, turn: 0 });
  assert.equal(
    readStarship(ship).effects.some((effect) => effect.id === timed.applicationId),
    true
  );
  combat.turn = 1;
  await settleTurn(combat, { round: 1, turn: 1 });
  assert.equal(
    readStarship(ship).effects.some((effect) => effect.id === timed.applicationId),
    false
  );
  assert.equal(
    readStarship(ship).effects.some((effect) => effect.id === indefinite.applicationId),
    true
  );
  assert.equal(crew.items.size, 1);
  assert.equal([...crew.items.values()][0].flags[MODULE_ID].applicationId, indefinite.applicationId);
});

test("sustain reminders stay once per round while timed station malfunctions expire", async () => {
  const { crew, ship } = await setup();
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 2 }] });
  const [anchor] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: crew.id, initiative: 20 },
    { actorId: "Actor.next", initiative: 10 }
  ]);
  const nextActor = new MockActor({ id: "Actor.next", type: "character", name: "Next" });
  game.actors.set(nextActor.id, nextActor);
  await ship.update({
    [`flags.${MODULE_ID}.starship.stations`]: [
      {
        id: "pilot",
        type: "pilot",
        helmedBy: crew.uuid,
        malfunctioning: true,
        malfunctionUntilTurnOf: crew.uuid,
        repairLockedUntilTurnOf: crew.uuid
      }
    ]
  });
  await ship.update({
    [`flags.${MODULE_ID}.starship.effects`]: [
      {
        id: "sustain",
        label: "Sustain",
        modifiers: [],
        conditions: [],
        timing: {
          combatId: combat.id,
          combatantId: anchor.id,
          mode: "condition",
          condition: "active",
          sustain: true,
          createdTurn: { id: anchor.id, round: 1, turn: 0 },
          round: 1,
          lastReminderRound: 1
        }
      }
    ]
  });
  registerCombatHooks();
  combat.turn = 0;
  await settleTurn(combat, { round: 1, turn: 0 });
  const station = readStarship(ship).stations[0];
  assert.equal(station.malfunctioning, false);
  assert.equal(station.malfunctionUntilTurnOf, null);
  assert.equal(station.repairLockedUntilTurnOf, null);
  const reminders = () => game.messages.filter((message) => message.content.includes("Sustain"));
  assert.equal(reminders().length, 0);
  combat.turn = 1;
  await settleTurn(combat, { round: 2, turn: 1 });
  assert.equal(reminders().length, 1);
  assert.equal(readStarship(ship).effects[0].timing.lastReminderRound, 2);
  combat.turn = 0;
  await settleTurn(combat, { round: 2, turn: 0 });
  assert.equal(reminders().length, 1);
});

test("initiative station reset remains independent of persistent processing", async () => {
  const { crew, ship } = await setup({ reset: true });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 2 }] });
  await combat.createEmbeddedDocuments("Combatant", [
    { actorId: crew.id, initiative: 20 },
    { actorId: ship.id, initiative: 10 }
  ]);
  registerCombatHooks();
  await addPersistent(ship);
  await settleTurn(combat, { round: 1, turn: 0 });
  assert.equal(readStarship(ship).stations[0].helmedBy, null);
  assert.equal(readStarship(ship).crew[0].stationId, null);
  assert.equal(readStarship(ship).persistentDamageReceipts?.length ?? 0, 0);
  await settleTurn(combat, { round: 1, turn: 1 });
  assert.equal(readStarship(ship).persistentDamageReceipts?.length ?? 0, 0);
  await settleTurn(combat, { round: 2, turn: 0 });
  assert.equal(readStarship(ship).persistentDamageReceipts.length, 1);
});
