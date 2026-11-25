import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFoundryMock, loadContentFromDisk, makeCharacter, makeShip, makeStarshipCombat, dice } from "../helpers/foundry-mock.mjs";
import { dispatchSocketMessage, registerHandler, _trackPending } from "../../scripts/socket.mjs";
import { executeAction, registerActionHandlers } from "../../scripts/actions/action-engine.mjs";
import { resolveAreaFire } from "../../scripts/actions/strike.mjs";
import { executeEffects } from "../../scripts/actions/effects-exec.mjs";
import { computeShipStats, shipStatistic } from "../../scripts/starship/stats.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";

const M = "sf2e-tactical-starship-combat";

test("cancelled Seek Starships skips builtin resolution and effects", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const crew = makeCharacter({ id: "scanner", name: "Scanner", owners: ["p1"] });
  let rolls = 0;
  crew.skills = {
    computers: {
      check: {
        roll: async () => {
          rolls++;
          return null;
        }
      }
    }
  };
  const ship = makeShip({
    id: "seeker",
    name: "Seeker",
    owners: ["p1"],
    stations: [{ id: "scanners", type: "scanners", grade: "commercial", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "scanners" }]
  });
  const contact = makeShip({ id: "hidden-contact", name: "Hidden Contact", role: "npc" });
  makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 2 },
      { key: contact.uuid, zone: 3, detection: { party: "hidden" } }
    ]
  });
  const { Content } = await import("../../scripts/content/loader.mjs");
  const seek = Content.actions.get("seek-starships");
  seek.effects = [{ type: "manual", text: "must not run after cancel" }];
  registerActionHandlers();

  const result = await executeAction({
    user: game.users.get("p1"),
    shipUuid: ship.uuid,
    crewUuid: crew.uuid,
    stationId: "scanners",
    actionId: "seek-starships",
    options: { skill: "computers" }
  });

  assert.equal(rolls, 1);
  assert.equal(result.cancelled, true);
  assert.deepEqual(result.summary.manual, []);
  assert.equal(getTsc(game.combat).objects[1].detection.party, "hidden");
});

test("socket acknowledgement gives a long GM dialog a bounded result deadline", async (t) => {
  installFoundryMock();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let timedOut = false;
  let requestResult;
  let finishDialog;
  const initialTimer = setTimeout(() => (timedOut = true), 15000);
  const resultPromise = new Promise((resolve, reject) => _trackPending("long-dialog", resolve, reject, initialTimer));
  registerHandler("executeAction", async () => {
    await new Promise((resolve) => (finishDialog = resolve));
    return { roll: "done" };
  });
  const messages = [];
  const env = {
    users: game.users,
    selfId: "gm",
    isActiveGM: true,
    clientEvents: new Map(),
    emit: (message) => messages.push(message)
  };
  const request = dispatchSocketMessage(
    {
      kind: "request",
      type: "executeAction",
      requestId: "long-dialog",
      payload: { actionId: "seek-starships" }
    },
    "p1",
    env
  );
  const acknowledgement = messages[0];
  assert.deepEqual([acknowledgement.kind, acknowledgement.requestId, acknowledgement.to], ["accepted", "long-dialog", "p1"]);
  await dispatchSocketMessage(acknowledgement, "gm", {
    users: game.users,
    selfId: "p1",
    isActiveGM: false,
    clientEvents: new Map(),
    emit() {}
  });
  t.mock.timers.tick(15000);
  assert.equal(timedOut, false);
  finishDialog();
  await request;
  const response = messages.at(-1);
  assert.equal(response.kind, "response");
  await dispatchSocketMessage(response, "gm", { users: game.users, selfId: "p1", isActiveGM: false, clientEvents: new Map(), emit() {} });
  requestResult = await resultPromise;
  assert.deepEqual(requestResult, { roll: "done" });
});

function saveStatistic() {
  let passed;
  return {
    get passed() {
      return passed;
    },
    statistic: {
      domains: ["reflex", "saving-throw", "all", "dex-based"],
      mod: 8,
      check: {
        roll: async (options) => {
          passed = options;
          return { total: 20, degreeOfSuccess: 3, dice: [{ total: 20 }] };
        }
      }
    }
  };
}

test("Area Fire and EXEC damage saves forward click dialog and visibility options", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const attacker = makeShip({
    id: "area-attacker",
    name: "Area Attacker",
    stations: [{ id: "gun", type: "gunnery", grade: "commercial" }],
    weapons: [{ id: "weapon", name: "Pulse", stationId: "gun", die: "1d6", damageType: "fire", range: 6, traits: [] }]
  });
  const target = makeShip({ id: "area-target", name: "Area Target", role: "npc" });
  const areaSave = saveStatistic();
  target.saves = { reflex: areaSave.statistic };
  const combat = makeStarshipCombat({
    objects: [
      { key: attacker.uuid, zone: 2 },
      { key: target.uuid, zone: 3 }
    ]
  });
  const draft = {
    tsc: getTsc(combat),
    ship: async () => ({ actor: target, data: readStarship(target) }),
    target(uuid) {
      return this.ship(uuid);
    }
  };
  const options = { weaponId: "weapon", skipDialog: true, messageMode: "blind" };
  const ctx = {
    ship: attacker,
    shipUuid: attacker.uuid,
    data: readStarship(attacker),
    stats: computeShipStats(attacker),
    tsc: getTsc(combat),
    draft,
    station: { id: "gun", weaponId: "weapon" },
    stationRow: { damageDice: 1 },
    combat,
    action: { name: "Pulse", builtin: "area-fire" },
    options,
    manualModifiers: [],
    lines: [],
    reports: []
  };

  dice(2);
  await resolveAreaFire(ctx, "area-fire");
  assert.equal(areaSave.passed.skipDialog, true);
  assert.equal(areaSave.passed.messageMode, "blind");

  const effectSave = saveStatistic();
  target.saves.reflex = effectSave.statistic;
  const effectCtx = {
    ship: attacker,
    data: readStarship(attacker),
    level: 3,
    options,
    action: { name: "Saved Blast" },
    target: { actor: target, uuid: target.uuid },
    reports: [],
    draft: {
      ship: async () => ({ actor: target, data: readStarship(target) }),
      target(uuid) {
        return this.ship(uuid);
      },
      log() {},
      event() {},
      afterCommit() {}
    }
  };
  dice(2);
  await executeEffects([{ type: "damage", dice: { count: 1, faces: 6 }, save: { type: "reflex", dcSkill: "crafting" } }], effectCtx);
  assert.equal(effectSave.passed.skipDialog, true);
  assert.equal(effectSave.passed.messageMode, "blind");
});

async function dcScenario({ level = 3, stationType = "pilot" } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  const check = saveStatistic();
  const crew = makeCharacter({ id: "dc-crew", name: "DC Crew", owners: ["p1"] });
  crew.skills = { crafting: check.statistic, computers: check.statistic };
  const ship = makeShip({
    id: "dc-ship",
    name: "DC Ship",
    level,
    owners: ["p1"],
    stations: [{ id: "dc-station", type: stationType, grade: "tactical", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, name: crew.name, role: "crew", stationId: "dc-station" }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 1, detection: { party: "identified" } }] });
  const { Content } = await import("../../scripts/content/loader.mjs");
  return {
    ship,
    crew,
    check,
    combat,
    Content,
    run: (actionId, options = {}) =>
      executeAction({
        user: game.users.get("p1"),
        shipUuid: ship.uuid,
        crewUuid: crew.uuid,
        stationId: "dc-station",
        actionId,
        options: { skipDialog: true, ...options }
      })
  };
}

test("Reposition Shield uses the pending attacker's starship level DC instead of its Reflex save", async () => {
  const scenario = await dcScenario({ stationType: "generator" });
  const attacker = makeShip({ id: "dc-attacker", name: "Level 10 Attacker", role: "npc", level: 10, extra: { reflex: 0 } });

  await scenario.run("reposition-shield", { skill: "crafting", pendingStrike: { attackerUuid: attacker.uuid } });

  assert.equal(scenario.check.passed.dc.value, 27);
});

test("Reposition Shield without a pending Strike uses the acting starship's level DC", async () => {
  const scenario = await dcScenario({ level: 10, stationType: "generator" });

  await scenario.run("reposition-shield", { skill: "crafting" });

  assert.equal(scenario.check.passed.dc.value, 27);
});

test("Reposition Shield falls back to the acting starship's level DC when the attacker cannot be resolved", async () => {
  const scenario = await dcScenario({ level: 10, stationType: "generator" });

  await scenario.run("reposition-shield", { skill: "crafting", pendingStrike: { attackerUuid: "Actor.missing" } });

  assert.equal(scenario.check.passed.dc.value, 27);
});

test("manualReflexDC preserves an explicit manual DC with and without a pending Strike", async () => {
  const scenario = await dcScenario({ stationType: "generator" });
  const attacker = makeShip({ id: "dc-manual-attacker", name: "Manual DC Attacker", role: "npc", level: 10, extra: { reflex: 0 } });

  await scenario.run("reposition-shield", { skill: "crafting", manualDC: 31 });
  assert.equal(scenario.check.passed.dc.value, 31);

  await scenario.run("reposition-shield", {
    skill: "crafting",
    manualDC: 32,
    pendingStrike: { attackerUuid: attacker.uuid }
  });
  assert.equal(scenario.check.passed.dc.value, 32);
});

test("target defense DC types keep using the target's actual saves and Perception", async () => {
  const scenario = await dcScenario();
  const target = makeShip({
    id: "dc-target",
    name: "DC Target",
    role: "npc",
    extra: { reflex: 2, will: 3, fort: 4, perception: 5 }
  });
  scenario.combat.flags[M].tsc.objects.push({
    key: target.uuid,
    actorUuid: target.uuid,
    type: "starship",
    zone: 2,
    detection: { party: "identified" }
  });

  for (const [type, expected] of [
    ["targetReflex", 12],
    ["targetWill", 13],
    ["targetFortitude", 14],
    ["targetPerception", 15]
  ]) {
    const actionId = `dc-${type}`;
    scenario.Content.actions.set(actionId, {
      id: actionId,
      name: actionId,
      station: "pilot",
      cost: 1,
      targeting: { type: "starship" },
      check: { kind: "skill", skills: ["computers"], dc: { type } }
    });

    await scenario.run(actionId, { skill: "computers", targetUUIDs: [target.uuid] });

    assert.equal(scenario.check.passed.dc.value, expected, type);
  }
});

test("targetSave keeps using the attacker's skill DC instead of the target defense or level DC", async () => {
  const scenario = await dcScenario();
  const target = makeShip({ id: "dc-save-target", name: "DC Save Target", role: "npc", extra: { reflex: 2 } });
  scenario.combat.flags[M].tsc.objects.push({
    key: target.uuid,
    actorUuid: target.uuid,
    type: "starship",
    zone: 2,
    detection: { party: "identified" }
  });
  const targetSave = saveStatistic();
  targetSave.statistic.mod = 2;
  target.saves = { reflex: targetSave.statistic };
  scenario.crew.skills.computers.dc = { value: 23 };
  scenario.Content.actions.set("dc-target-save", {
    id: "dc-target-save",
    name: "DC Target Save",
    station: "pilot",
    cost: 1,
    targeting: { type: "starship" },
    check: { kind: "targetSave", save: "reflex", dcSkill: "computers" }
  });

  await scenario.run("dc-target-save", { targetUUIDs: [target.uuid] });

  assert.equal(targetSave.passed.dc.value, 23);
});

test("HUD and both station-item action paths preserve the initiating click options", async () => {
  const { settings, setUser } = installFoundryMock();
  setUser("gm");
  await loadContentFromDisk();
  game.user.settings = { showCheckDialogs: true };
  settings.set("messageMode", "public");
  CONFIG.ChatMessage.modes.public = {};
  CONFIG.ChatMessage.modes.blind = {};
  CONFIG.ChatMessage.modes.gm = {};
  const crew = makeCharacter({ id: "event-crew", name: "Event Crew" });
  const received = [];
  crew.skills = {
    computers: {
      check: {
        roll: async (options) => {
          received.push(options);
          return null;
        }
      }
    }
  };
  const ship = makeShip({
    id: "event-ship",
    name: "Event Ship",
    stations: [{ id: "scanners", type: "scanners", grade: "commercial", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "scanners" }]
  });
  makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 2 }] });
  const { Content } = await import("../../scripts/content/loader.mjs");
  Content.actions.set("test-roll-event-options", {
    id: "test-roll-event-options",
    name: "Test Roll Options",
    station: "scanners",
    minGrade: "commercial",
    cost: 1,
    targeting: { type: "none" },
    check: { kind: "skill", skills: ["computers"], dc: { type: "none" } }
  });
  registerActionHandlers();
  const { runHudAction } = await import("../../scripts/ui/hud-model.mjs");
  const { runStationItemLink } = await import("../../scripts/crew/station-items.mjs");

  await runHudAction(0, "test-roll-event-options", { shiftKey: true, ctrlKey: true, metaKey: false });
  await runStationItemLink(
    { dataset: { shipUuid: ship.uuid, stationId: "scanners", actionId: "test-roll-event-options", crewUuid: crew.uuid } },
    { shiftKey: false, ctrlKey: true, metaKey: false }
  );
  canvas.tokens.controlled = [{ actor: ship }];
  await runStationItemLink(
    { dataset: { actionId: "test-roll-event-options" }, closest: () => null },
    { shiftKey: true, ctrlKey: false, metaKey: true }
  );

  assert.deepEqual(
    received.map(({ skipDialog, messageMode }) => [skipDialog, messageMode]),
    [
      [true, "gm"],
      [false, "gm"],
      [true, "gm"]
    ]
  );

  const read = (file) => readFileSync(new URL(`../../scripts/${file}`, import.meta.url), "utf8");
  assert.match(read("ui/station-hud.mjs"), /runHudAction\(this\.index,\s*target\.dataset\.actionId,\s*event\)/);
  assert.match(read("ui/sensor-map-app.mjs"), /runHudAction\(this\.dockIndex,\s*target\.dataset\.actionId,\s*event\)/);
  assert.match(read("crew/station-items.mjs"), /runStationItemLink\(a,\s*ev\)/);
});

class NativeConditionStatistic {
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
    this.mod = [...(data.modifiers ?? []), ...synthetic].reduce((total, modifier) => total + modifier.modifier, 0);
    this.check = { mod: this.mod };
  }

  clone(data = {}) {
    return new NativeConditionStatistic(this.actor, {
      ...this.data,
      ...data,
      modifiers: [...(this.data.modifiers ?? []), ...(data.modifiers ?? [])]
    });
  }
}

test("native condition is counted once in ship checks and direct stats", () => {
  installFoundryMock();
  const npcShip = makeShip({ id: "native-condition-count", name: "Native Condition Count", role: "npc", extra: { reflex: 8 } });
  npcShip.type = "npc";
  npcShip._source = { system: { saves: { reflex: { value: 8 } } } };
  const condition = {
    id: "clumsy-item",
    uuid: `${npcShip.uuid}.Item.clumsy-item`,
    type: "condition",
    slug: "clumsy",
    active: true
  };
  npcShip.items.set(condition.id, condition);
  npcShip.synthetics.modifiers = {
    "dex-based": [() => ({ modifier: -4, type: "status", label: "Clumsy", slug: "clumsy", source: condition.uuid })]
  };
  npcShip.saves = {
    reflex: new NativeConditionStatistic(npcShip, {
      slug: "reflex",
      domains: ["reflex", "dex-based"],
      modifiers: [{ slug: "base", modifier: 8, type: "untyped" }]
    })
  };

  const direct = computeShipStats(npcShip, { includeNativeConditions: true });
  const statistic = shipStatistic(npcShip, "reflex", { includeNativeConditions: false });
  assert.equal(direct.reflex, 4);
  assert.equal(statistic.check.mod, 4);
  assert.equal(direct.reflex, statistic.check.mod);
});
