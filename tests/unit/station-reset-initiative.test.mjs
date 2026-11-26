import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { installFoundryMock, loadContentFromDisk, makeCharacter, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { MODULE_ID as M } from "../../scripts/constants.mjs";
import { registerSettings } from "../../scripts/settings.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";
import { registerCombatHooks, startStarshipCombat, onTurnChange } from "../../scripts/combat/starship-combat.mjs";
import { registerPersistentDamageService } from "../../scripts/starship/persistent-damage.mjs";

const SETTING = "resetStationsOnInitiative";

async function scenario({ reset = false } = {}) {
  const ctx = installFoundryMock();
  await loadContentFromDisk();
  registerPersistentDamageService();
  ctx.settings.set(SETTING, reset);
  const pilot = makeCharacter({ id: "pilot", name: "Pilot" });
  const gunner = makeCharacter({ id: "gunner", name: "Gunner" });
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    role: "player",
    hp: 36,
    sp: 14,
    effects: [{ id: "effect", slug: "shielded", label: "Shielded", modifiers: [] }],
    extra: {
      dataVersion: 2,
      upgrades: [{ id: "upgrade", stationId: "gunner", custom: "retain" }],
      expansionBays: [{ id: "bay", custom: "retain" }],
      customData: { retain: true }
    },
    stations: [
      {
        id: "pilot",
        type: "pilot",
        name: "Pilot console",
        grade: "commercial",
        helmedBy: pilot.uuid,
        malfunctioning: false,
        malfunctionImmuneUntil: null,
        location: "cockpit",
        upgrades: [],
        actions: [],
        weaponId: null,
        passive: { ac: 2 },
        ready: true,
        autoHelmed: false,
        custom: { retain: true }
      },
      {
        id: "gunner",
        type: "gunnery",
        name: "Gunnery",
        grade: "commercial",
        helmedBy: gunner.uuid,
        malfunctioning: true,
        malfunctionUntilTurnOf: null,
        repairLockedUntilTurnOf: null,
        weaponId: "weapon",
        upgrades: ["upgrade"],
        custom: { retain: true }
      }
    ],
    weapons: [{ id: "weapon", name: "Laser", stationId: "gunner", custom: "retain" }],
    crew: [
      { actorUuid: pilot.uuid, name: pilot.name, role: "captain", stationId: "pilot", ready: true, custom: "retain" },
      { actorUuid: gunner.uuid, name: gunner.name, role: "crew", stationId: "gunner", ready: false, custom: "retain" }
    ]
  });
  const combat = makeStarshipCombat({
    round: 0,
    objects: [
      { key: ship.uuid, zone: 2 },
      { key: "Actor.enemy", type: "custom", name: "Enemy marker", zone: 5 }
    ]
  });
  combat.flags.unrelated = { retain: true };
  combat.flags[M].unrelated = { retain: true };
  await combat.createEmbeddedDocuments("Combatant", [
    { actorId: pilot.id, initiative: 20 },
    { actorId: gunner.id, initiative: 10 }
  ]);
  registerCombatHooks();
  return { ...ctx, ship, pilot, gunner, combat };
}

async function beginInitiative(combat) {
  await combat.update({ round: 1, turn: 0 });
  for (let i = 0; i < 100 && !getTsc(combat).lastTurnKey; i++) await setImmediate();
  assert.ok(getTsc(combat).lastTurnKey, "real initiative transition must finish turn processing");
}

function unrelatedCombatFlags(combat) {
  const tsc = structuredClone(getTsc(combat));
  delete tsc.lastTurnKey;
  delete tsc.lastEffectTurn;
  delete tsc.stationResetEncounter;
  return {
    unrelated: structuredClone(combat.flags.unrelated),
    module: structuredClone(combat.flags[M].unrelated),
    tsc,
    combatants: [...combat.combatants].map((entry) => structuredClone(entry.flags))
  };
}

function assertOccupancyCleared(ship) {
  assert.ok(ship.flags[M].starship.stations.every((station) => station.helmedBy === null));
  assert.ok(ship.flags[M].starship.crew.every((member) => member.stationId === null));
}

async function reclaimPilotStation(ship, pilot) {
  const stations = structuredClone(ship.flags[M].starship.stations);
  const crew = structuredClone(ship.flags[M].starship.crew);
  stations.find((station) => station.id === "pilot").helmedBy = pilot.uuid;
  crew.find((member) => member.actorUuid === pilot.uuid).stationId = "pilot";
  await ship.update({
    [`flags.${M}.starship.stations`]: stations,
    [`flags.${M}.starship.crew`]: crew
  });
}

test("resetStationsOnInitiative is a configurable world Boolean defaulting to false", async () => {
  const ctx = installFoundryMock();
  const registrations = new Map();
  const register = game.settings.register;
  game.settings.register = (module, key, config) => {
    registrations.set(key, config);
    register(module, key, config);
    if (!ctx.settings.has(key)) ctx.settings.set(key, config.default);
  };
  registerSettings();
  assert.deepEqual(
    {
      scope: registrations.get(SETTING)?.scope,
      config: registrations.get(SETTING)?.config,
      type: registrations.get(SETTING)?.type,
      default: registrations.get(SETTING)?.default
    },
    { scope: "world", config: true, type: Boolean, default: false }
  );
  assert.equal(game.settings.get(M, SETTING), false);
});

test("default OFF preserves occupied stations and crew at the real initiative transition", async () => {
  const { ship, combat } = await scenario();
  const before = structuredClone(ship.flags[M]);
  await beginInitiative(combat);
  assert.deepEqual(ship.flags[M], before);
});

test("ON preserves occupancy during pre-initiative turn-index updates", async () => {
  const { ship, combat } = await scenario({ reset: true });
  const before = structuredClone(ship.flags[M]);
  await combat.update({ turn: 1 });
  for (let i = 0; i < 100 && !getTsc(combat).lastTurnKey; i++) await setImmediate();
  assert.ok(getTsc(combat).lastTurnKey);
  assert.equal(combat.round, 0);
  assert.deepEqual(ship.flags[M], before);
});

test("ON clears only station occupancy and its crew mirror at the real initiative transition", async () => {
  const { ship, combat } = await scenario({ reset: true });
  const before = readStarship(ship);
  const combatBefore = unrelatedCombatFlags(combat);
  const expected = structuredClone(before);
  for (const station of expected.stations) station.helmedBy = null;
  for (const member of expected.crew) member.stationId = null;
  await beginInitiative(combat);
  assertOccupancyCleared(ship);
  assert.deepEqual(readStarship(ship), expected);
  assert.deepEqual(unrelatedCombatFlags(combat), combatBefore);
});

test("ON reset runs once per encounter and hook reload cannot clear a later claim", async () => {
  const { ship, pilot, gunner, combat } = await scenario({ reset: true });
  await beginInitiative(combat);
  assertOccupancyCleared(ship);
  await reclaimPilotStation(ship, pilot);
  const reloaded = installFoundryMock();
  reloaded.settings.set(SETTING, true);
  for (const actor of [ship, pilot, gunner]) game.actors.set(actor.id, actor);
  game.combats.set(combat.id, combat);
  game.combat = combat;
  registerCombatHooks();
  await combat.update({ turn: 0 });
  await setImmediate();
  assert.equal(ship.flags[M].starship.stations.find((station) => station.id === "pilot").helmedBy, pilot.uuid);
  assert.equal(ship.flags[M].starship.crew.find((member) => member.actorUuid === pilot.uuid).stationId, "pilot");
  await combat.update({ round: 2, turn: 0 });
  for (let i = 0; i < 100 && getTsc(combat).lastTurnKey !== `2:${combat.combatant.id}`; i++) await setImmediate();
  assert.equal(ship.flags[M].starship.stations.find((station) => station.id === "pilot").helmedBy, pilot.uuid);
});

test("returning to round 1 does not reset stations twice in one encounter", async () => {
  const { ship, pilot, combat } = await scenario({ reset: true });
  await beginInitiative(combat);
  await reclaimPilotStation(ship, pilot);
  await combat.update({ round: 2, turn: 0 });
  for (let i = 0; i < 100 && getTsc(combat).lastTurnKey !== `2:${combat.combatant.id}`; i++) await setImmediate();
  await combat.update({ round: 1, turn: 0 });
  for (let i = 0; i < 100 && getTsc(combat).lastTurnKey !== `1:${combat.combatant.id}`; i++) await setImmediate();
  assert.equal(ship.flags[M].starship.stations.find((station) => station.id === "pilot").helmedBy, pilot.uuid);
});

test("turn-index correction for the same combatant preserves the existing 8.1 guard and a reclaimed station", async () => {
  const { ship, pilot, combat } = await scenario({ reset: true });
  await beginInitiative(combat);
  await reclaimPilotStation(ship, pilot);
  const current = combat.combatant;
  const inserted = await combat.createEmbeddedDocuments("Combatant", [{ actorId: "Actor.other", initiative: 30 }]);
  const correctedTurn = combat.turns.findIndex((entry) => entry.id === current.id);
  assert.equal(correctedTurn, 1);
  assert.equal(combat.turns[0].id, inserted[0].id);
  await combat.update({ turn: correctedTurn });
  await setImmediate();
  assert.equal(combat.combatant.id, current.id);
  assert.equal(ship.flags[M].starship.stations.find((station) => station.id === "pilot").helmedBy, pilot.uuid);
  assert.equal(ship.flags[M].starship.crew.find((member) => member.actorUuid === pilot.uuid).stationId, "pilot");
});

test("turn processing preserves concurrent Combat projection updates", async () => {
  const { ship, combat } = await scenario();
  ship.flags[M].starship.effects[0].timing = {
    combatId: combat.id,
    combatantId: combat.combatant.id,
    mode: "turn-start",
    round: 1
  };
  let injected = false;
  const listener = (actor) => {
    if (actor !== ship || injected) return;
    injected = true;
    combat.flags[M].tsc.concurrentProjection = { retain: true };
  };
  Hooks.on("updateActor", listener);
  try {
    await beginInitiative(combat);
    assert.equal(injected, true);
    assert.deepEqual(getTsc(combat).concurrentProjection, { retain: true });
  } finally {
    Hooks.off("updateActor", listener);
  }
});

test("concurrent turn processing cannot roll back a newer turn marker", async () => {
  const { ship, pilot, combat } = await scenario();
  combat.round = 1;
  combat.turn = 0;
  const station = ship.flags[M].starship.stations.find((entry) => entry.id === "gunner");
  station.malfunctioning = true;
  station.malfunctionUntilTurnOf = pilot.uuid;

  let releaseFirst;
  let markStarted;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const update = ship.update.bind(ship);
  let blocked = false;
  ship.update = async (...args) => {
    if (!blocked) {
      blocked = true;
      markStarted();
      await gate;
    }
    return update(...args);
  };
  try {
    const first = onTurnChange(combat);
    await started;
    combat.round = 2;
    combat.flags[M].tsc.objects = [];
    const second = onTurnChange(combat);
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(getTsc(combat).lastTurnKey, `2:${combat.combatant.id}`);
  } finally {
    releaseFirst();
    ship.update = update;
  }
});

test("ON repeated encounter start resets occupancy again without accumulating unrelated changes", async () => {
  const { ship, pilot, combat } = await scenario({ reset: true });
  const unrelated = structuredClone({ customData: ship.flags[M].starship.customData, weapons: ship.flags[M].starship.weapons });
  await beginInitiative(combat);
  await reclaimPilotStation(ship, pilot);
  const next = await startStarshipCombat({ playerShips: [ship.uuid] });
  assert.notEqual(next.id, combat.id);
  assert.equal(ship.flags[M].starship.stations.find((station) => station.id === "pilot").helmedBy, pilot.uuid);
  await beginInitiative(next);
  assertOccupancyCleared(ship);
  assert.deepEqual({ customData: ship.flags[M].starship.customData, weapons: ship.flags[M].starship.weapons }, unrelated);
});
