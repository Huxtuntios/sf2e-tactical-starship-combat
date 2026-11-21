import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { setImmediate } from "node:timers/promises";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat, dice } from "../helpers/foundry-mock.mjs";
import { HOOK_EVENTS } from "../../scripts/constants.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { startStarshipCombat } from "../../scripts/combat/starship-combat.mjs";
import { syncCrewCombatants, registerCrewSyncHooks } from "../../scripts/combat/crew-sync.mjs";
import { executeAction } from "../../scripts/actions/action-engine.mjs";
import { OCCUPANT_PARTIAL } from "../../scripts/crew/occupant.mjs";
import { STATION_UPGRADES_PARTIAL } from "../../scripts/ui/sheet/sheet-upgrades.mjs";
import { registerCrewHandlers } from "../../scripts/crew/crew-service.mjs";

installFoundryMock();
const { StarshipBuilder } = await import("../../scripts/ui/starship-builder.mjs");
const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");

const stations = () =>
  ["pilot", "generator", "gunnery", "scanners"].map((type) => ({ id: type, type, grade: "commercial", helmedBy: null }));
async function setup() {
  const env = installFoundryMock();
  const content = await loadContentFromDisk();
  env.settings.set("ruleEnforcement", "strict");
  env.settings.set("crewInitiativeScope", "stationed");
  env.settings.set("smallCrewWarning", true);
  return { ...env, content };
}
function renderStations(ctx) {
  const h = Handlebars.create();
  h.registerHelper("eq", (a, b) => a === b);
  h.registerHelper("localize", (k) => game.i18n.localize(k));
  h.registerPartial("tscOccupant", OCCUPANT_PARTIAL);
  h.registerPartial("tscStationUpgrades", STATION_UPGRADES_PARTIAL);
  h.registerPartial("modules/sf2e-tactical-starship-combat/templates/crew-ship.hbs", "");
  return h.compile(fs.readFileSync(new URL("../../templates/starship-sheet.hbs", import.meta.url), "utf8"))(ctx);
}

for (const role of ["npc", "player"]) {
  test(`${role} custom builder preserves empty stations and ignores NPC crew fields`, async () => {
    await setup();
    const pc = makeCharacter({ id: "pc", name: "PC" });
    registerCrewHandlers();
    Hooks.on("createActor", (actor) => {
      actor.sheet = { render() {} };
    });
    const builder = new StarshipBuilder();
    await StarshipBuilder.DEFAULT_OPTIONS.form.handler.call(builder, null, null, {
      object: {
        name: "Custom",
        kind: role,
        level: 1,
        frame: "explorer",
        size: "medium",
        hp: 30,
        sp: 10,
        ac: 18,
        fort: 8,
        ref: 8,
        will: 8,
        speed: 3,
        sensor: 6,
        station: { pilot: true, gunnery: true },
        crew: { [pc.uuid.replaceAll(".", "__DOT__")]: true }
      }
    });
    const ship = game.actors.find((a) => a.name === "Custom");
    assert.ok(ship);
    const data = readStarship(ship);
    assert.equal(data.role, role);
    assert.equal(data.crew.length, role === "player" ? 1 : 0);
    assert.equal(data.stations.length, 2);
    assert.ok(data.stations.every((s) => s.helmedBy === null));
    assert.equal(game.actors.size, 2);
  });

  test(`${role} empty station sheet only offers crew assignment on player ships`, async () => {
    await setup();
    const ship = makeShip({ id: "ship", name: "Ship", role, stations: stations() });
    const ctx = await buildSheetContext({ document: ship, isNpc: role === "npc", tab: "stations", tabs: ["stations"] });
    const html = renderStations(ctx);
    assert.equal((html.match(/data-action="claim"/g) ?? []).length, role === "player" ? 4 : 0);
    assert.equal((html.match(/data-action="forceClaim"/g) ?? []).length, role === "player" ? 4 : 0);
    assert.equal((html.match(/data-station-link=/g) ?? []).length, 4);
    assert.equal((html.match(/data-action="toggleMalf"/g) ?? []).length, 4);
    assert.equal(ctx.smallCrew, role === "player");
  });
}

test("NPC optional existing crew retains station management", async () => {
  await setup();
  const pc = makeCharacter({ id: "pc", name: "PC" });
  const ship = makeShip({
    id: "ship",
    role: "npc",
    stations: [{ id: "pilot", type: "pilot", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, role: "crew", stationId: "pilot" }]
  });
  const ctx = await buildSheetContext({ document: ship, isNpc: true, tab: "stations", tabs: ["stations"] });
  const html = renderStations(ctx);
  assert.match(html, /data-action="unhelm"/);
  assert.match(html, /data-action="forceClaim"/);
  assert.equal(ctx.smallCrew, false);
});

for (const detection of ["identified", "observed", "undetected"]) {
  test(`uncrewed NPC starts ${detection} encounter without warnings or new crew`, async () => {
    await setup();
    const ship = makeShip({ id: "npc", role: "npc", name: "NPC", stations: stations() });
    const before = ship.toObject();
    const combat = await startStarshipCombat({ enemies: [{ uuid: ship.uuid, detection }] });
    assert.equal(combat.active, true);
    assert.equal(combat.combatants.size, 1);
    const actor = combat.combatants.contents[0].actor;
    assert.equal(readStarship(actor).role, "npc");
    assert.deepEqual(readStarship(actor).crew, []);
    assert.ok(readStarship(actor).stations.every((s) => s.helmedBy === null));
    assert.deepEqual(
      globalThis.__notes.filter(([kind]) => kind === "warn" || kind === "error"),
      []
    );
    assert.deepEqual(ship.toObject(), before);
    assert.ok(game.actors.contents.every((a) => a.type === "npc"));
  });
}

for (const assignment of [
  { stationId: "pilot", actorUuid: "Actor.missing" },
  { stationId: "missing", actorUuid: "Actor.missing" },
  { stationId: "", actorUuid: "Actor.missing" }
]) {
  test(`NPC encounter ignores unused player assignment ${JSON.stringify(assignment)}`, async () => {
    await setup();
    const ship = makeShip({ id: "npc", role: "npc", stations: stations() });
    const combat = await startStarshipCombat({ enemies: [{ uuid: ship.uuid, detection: "identified", stationAssignments: [assignment] }] });
    assert.equal(combat.combatants.size, 1);
    assert.deepEqual(readStarship(combat.combatants.contents[0].actor).crew, []);
  });
}

test("player encounter still rejects missing assigned crew", async () => {
  await setup();
  const ship = makeShip({ id: "pc-ship", role: "player", stations: stations() });
  await assert.rejects(
    () =>
      startStarshipCombat({ playerShips: [{ uuid: ship.uuid, stationAssignments: [{ stationId: "pilot", actorUuid: "Actor.missing" }] }] }),
    /character|actor/i
  );
  assert.equal(game.combats.size, 0);
});

test("mixed explicit crew sync ignores NPC crew and missing NPC actors, retaining PC initiative", async () => {
  await setup();
  const pc = makeCharacter({ id: "pc", name: "PC" });
  const optional = makeCharacter({ id: "optional", name: "Optional NPC operator" });
  const player = makeShip({
    id: "player",
    stations: [{ id: "pilot", type: "pilot", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, name: pc.name, role: "crew", stationId: "pilot" }]
  });
  const npc = makeShip({
    id: "npc",
    role: "npc",
    stations: [
      { id: "pilot", type: "pilot", helmedBy: optional.uuid },
      { id: "gunnery", type: "gunnery", helmedBy: "Actor.gone" }
    ],
    crew: [
      { actorUuid: optional.uuid, name: optional.name, stationId: "pilot" },
      { actorUuid: "Actor.gone", name: "Gone", stationId: "gunnery" }
    ]
  });
  const combat = makeStarshipCombat({
    objects: [
      { key: player.uuid, zone: 2 },
      { key: npc.uuid, zone: 6 }
    ]
  });
  await combat.createEmbeddedDocuments("Combatant", [
    { actorId: pc.id, initiative: 24 },
    { actorId: npc.id, initiative: 12 }
  ]);
  const current = combat.combatant.id;
  const result = await syncCrewCombatants(combat, [npc.uuid, player.uuid]);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.existing, [pc.name]);
  assert.equal(combat.combatant.id, current);
  assert.equal(combat.combatants.find((c) => c.actorId === pc.id).initiative, 24);
  assert.equal(combat.combatants.size, 2);
  assert.deepEqual(globalThis.__notes, []);
});

test("NPC station claim hook does not synchronize crew into initiative", async () => {
  await setup();
  registerCrewSyncHooks();
  const pc = makeCharacter({ id: "pc", name: "Optional operator" });
  const npc = makeShip({
    id: "npc",
    role: "npc",
    stations: [{ id: "pilot", type: "pilot", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, name: pc.name, stationId: "pilot" }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: npc.uuid, zone: 6 }] });
  Hooks.callAll(HOOK_EVENTS.stationClaimed, npc);
  await setImmediate();
  assert.equal(combat.combatants.size, 0);
});

test("player station claim still adds the operator to initiative", async () => {
  await setup();
  registerCrewSyncHooks();
  const pc = makeCharacter({ id: "pc", name: "Pilot" });
  const player = makeShip({
    id: "player",
    stations: [{ id: "pilot", type: "pilot", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, name: pc.name, stationId: "pilot" }]
  });
  const combat = makeStarshipCombat({ objects: [{ key: player.uuid, zone: 2 }] });
  Hooks.callAll(HOOK_EVENTS.stationClaimed, player);
  await setImmediate();
  assert.equal(combat.combatants.size, 1);
  assert.equal(combat.combatants.contents[0].actorId, pc.id);
});

test("mixed encounter registers PC crew and uncrewed NPC separately", async () => {
  await setup();
  const pc = makeCharacter({ id: "pc", name: "Pilot" });
  const player = makeShip({
    id: "player",
    name: "Player ship",
    stations: [{ id: "pilot", type: "pilot", helmedBy: pc.uuid }],
    crew: [{ actorUuid: pc.uuid, name: pc.name, stationId: "pilot" }]
  });
  const npc = makeShip({ id: "npc", name: "NPC ship", role: "npc", stations: stations() });
  const combat = await startStarshipCombat({
    playerShips: [player.uuid],
    enemies: [{ uuid: npc.uuid, detection: "identified", reuse: true }]
  });
  assert.deepEqual(combat.combatants.map((c) => c.actorId).sort(), [pc.id, npc.id].sort());
  assert.deepEqual(readStarship(npc).crew, []);
  assert.ok(readStarship(npc).stations.every((s) => s.helmedBy === null));
  assert.equal(globalThis.__notes.filter(([kind]) => kind === "warn").length, 1);
  assert.match(globalThis.__notes.find(([kind]) => kind === "warn")[1], /Player ship/);
});

test("NPC strike rolls ship statistics and damages shields without an operator", async () => {
  await setup();
  const npc = makeShip({
    id: "npc",
    name: "NPC",
    role: "npc",
    stations: stations(),
    extra: { strikes: [{ name: "Laser", kind: "ranged", attack: 10, damage: "1d6 fire", traits: ["range 3 zones"] }] }
  });
  const target = makeShip({ id: "target", name: "Target", ac: 18, sp: 10 });
  makeStarshipCombat({
    objects: [
      { key: npc.uuid, zone: 2, detection: { party: "identified" } },
      { key: target.uuid, zone: 3, detection: { party: "identified" } }
    ]
  });
  dice(10, 4);
  const result = await executeAction({
    userId: "gm",
    shipUuid: npc.uuid,
    actionId: "npc-strike:laser",
    options: { targetKey: target.uuid, skipDialog: true }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(readStarship(npc).crew, []);
  assert.equal(readStarship(target).sp.value, 6);
  assert.equal(readStarship(target).hp.value, 30);
});

test("custom NPC empty stations expose station actions without inventing attacks", async () => {
  await setup();
  const npc = makeShip({ id: "custom", role: "npc", stations: stations(), extra: { sourceId: "custom-created", strikes: [], skills: {} } });
  const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
  const pilot = ctx.stations.find((s) => s.type === "pilot");
  assert.ok(pilot.actionList.some((a) => a.id === "boost-thrusters" && a.enabled));
  assert.ok(pilot.actionList.some((a) => a.id === "change-heading"));
  assert.ok(ctx.stations.find((s) => s.type === "generator").actionList.some((a) => a.id === "generate-shields"));
  assert.ok(ctx.stations.find((s) => s.type === "gunnery").actionList.some((a) => a.id === "lock-on"));
  assert.ok(!pilot.actionList.some((a) => a.id === "juke"));
  assert.ok(!ctx.npcActions.some((a) => ["strike", "area-fire", "auto-fire", "cosmic-cannon"].includes(a.id)));
  assert.deepEqual(readStarship(npc).strikes, []);
  assert.deepEqual(readStarship(npc).skills, {});
});

test("custom NPC fallback omits checks without supplied ship statistics", async () => {
  await setup();
  const npc = makeShip({ role: "npc", stations: stations(), extra: { sourceId: "custom-no-statistics", skills: {} } });
  const before = npc.toObject();
  const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
  assert.ok(!ctx.npcActions.some((a) => ["repair-station", "target-lock", "jump-start"].includes(a.id)));
  assert.ok(ctx.npcActions.some((a) => a.id === "boost-thrusters"));
  assert.ok(ctx.npcActions.some((a) => a.id === "generate-shields"));
  assert.deepEqual(npc.toObject(), before);
});

for (const stored of [0, "8", { base: "8" }, { mod: 8 }, { value: 8 }]) {
  test(`custom NPC fallback offers checks for a supplied skill: ${JSON.stringify(stored)}`, async () => {
    await setup();
    const npc = makeShip({
      role: "npc",
      stations: stations(),
      extra: { sourceId: "custom-statistics", skills: { " Computers ": stored } }
    });
    const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
    assert.ok(ctx.stations.every((s) => s.actionList.some((a) => a.id === "repair-station")));
    assert.ok(ctx.stations.find((s) => s.type === "scanners").actionList.some((a) => a.id === "target-lock"));
    assert.ok(ctx.stations.find((s) => s.type === "scanners").actionList.some((a) => a.id === "jump-start"));
    assert.ok(!ctx.stations.find((s) => s.type === "generator").actionList.some((a) => a.id === "jump-start"));
  });
}

test("custom NPC fallback resolves the real operator of the matching station", async () => {
  await setup();
  const operator = makeCharacter({ id: "operator", name: "Operator" });
  operator.skills = { computers: { mod: 15, dc: { value: 25 } } };
  const selected = stations();
  selected.find((s) => s.type === "scanners").helmedBy = operator.uuid;
  const npc = makeShip({
    role: "npc",
    stations: selected,
    crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "scanners" }],
    extra: { sourceId: "custom-operator", skills: {} }
  });
  const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
  assert.ok(ctx.stations.find((s) => s.type === "scanners").actionList.some((a) => a.id === "target-lock"));
  assert.ok(ctx.stations.find((s) => s.type === "scanners").actionList.some((a) => a.id === "repair-station"));
  assert.ok(ctx.stations.filter((s) => s.type !== "scanners").every((s) => !s.actionList.some((a) => a.id === "repair-station")));
});

test("custom NPC fallback does not substitute a missing operator or malformed skill", async () => {
  await setup();
  const selected = stations();
  selected.find((s) => s.type === "scanners").helmedBy = "Actor.missing";
  const npc = makeShip({
    role: "npc",
    stations: selected,
    extra: { sourceId: "custom-invalid-statistics", skills: { computers: "invalid" } }
  });
  const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
  assert.ok(!ctx.npcActions.some((a) => ["repair-station", "target-lock"].includes(a.id)));
});

for (const actionId of ["repair-station", "target-lock"]) {
  test(`NPC execution refuses missing skill before rolling or changing state: ${actionId}`, async () => {
    await setup();
    const npc = makeShip({
      id: "npc",
      role: "npc",
      stations: [{ id: "scanner", type: "scanners", grade: "commercial", malfunctioning: actionId === "repair-station" }],
      extra: { sourceId: "custom-no-check", skills: {} }
    });
    const target = makeShip({ id: "target", role: "npc" });
    makeStarshipCombat({
      objects: [
        { key: npc.uuid, zone: 2, detection: { party: "identified" } },
        { key: target.uuid, zone: 3, detection: { party: "identified" } }
      ]
    });
    const before = [npc.toObject(), target.toObject()];
    const writes = globalThis.__writes.length;
    const messages = game.messages.size;
    dice(20);
    await assert.rejects(
      () =>
        executeAction({
          userId: "gm",
          shipUuid: npc.uuid,
          stationId: "scanner",
          actionId,
          options: { targetKey: target.uuid, manualDC: 15, skipDialog: true }
        }),
      /skill|statistic/i
    );
    assert.deepEqual([npc.toObject(), target.toObject()], before);
    assert.equal(globalThis.__writes.length, writes);
    assert.equal(game.messages.size, messages);
  });
}

test("NPC skill choice defaults to an existing alternative rather than a missing first skill", async () => {
  await setup();
  const npc = makeShip({
    id: "npc",
    role: "npc",
    stations: [{ id: "generator", type: "generator", grade: "commercial", malfunctioning: true }],
    extra: { sourceId: "custom-alternative", skills: { crafting: { base: 8 } } }
  });
  makeStarshipCombat({ objects: [{ key: npc.uuid, zone: 2 }] });
  dice(20);
  const result = await executeAction({
    userId: "gm",
    shipUuid: npc.uuid,
    stationId: "generator",
    actionId: "repair-station",
    options: { manualDC: 15, skipDialog: true }
  });
  assert.equal(result.ok, true);
  assert.equal(game.messages.contents.find((m) => m.rolls.length)?.rolls[0].total, 28);
  assert.equal(readStarship(npc).stations[0].malfunctioning, false);
});

test("Actor Directory custom NPC creation exposes uncrewed station actions", async () => {
  await setup();
  const { creationData } = await import("../../scripts/ui/actor-create.mjs");
  const npc = await Actor.create(creationData("tsc-npc", { name: "Directory custom", level: 1 }));
  const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
  assert.ok(ctx.stations.find((s) => s.type === "pilot").actionList.some((a) => a.id === "boost-thrusters"));
  assert.deepEqual(readStarship(npc).crew, []);
});

test("published NPC statblock does not gain custom station actions", async () => {
  await setup();
  const npc = makeShip({ id: "published", role: "npc", stations: stations(), extra: { sourceId: "published-statblock" } });
  const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
  assert.ok(!ctx.npcActions.some((a) => a.id === "boost-thrusters"));
});

test("custom NPC movement and shields execute without an operator", async () => {
  await setup();
  const npc = makeShip({
    id: "custom",
    role: "npc",
    stations: stations(),
    sp: 0,
    extra: { sourceId: "custom-created", sp: { value: 0, max: 10 } }
  });
  const combat = makeStarshipCombat({ objects: [{ key: npc.uuid, zone: 2 }] });
  for (const actionId of ["boost-thrusters", "generate-shields"])
    assert.equal((await executeAction({ userId: "gm", shipUuid: npc.uuid, actionId, options: { skipDialog: true } })).ok, true);
  assert.equal(combat.flags["sf2e-tactical-starship-combat"].tsc.objects[0].zone, 2);
  assert.ok(readStarship(npc).sp.value > 0);
  assert.deepEqual(readStarship(npc).crew, []);
});

test("custom NPC gives every station its own repair actions", async () => {
  await setup();
  const npc = makeShip({ role: "npc", stations: stations(), extra: { sourceId: "custom-repairs", skills: { computers: 8, crafting: 8 } } });
  const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
  assert.ok(ctx.stations.every((s) => s.actionList.some((a) => a.id === "repair-station")));
  assert.ok(
    ctx.stations.filter((s) => ["generator", "scanners"].includes(s.type)).every((s) => s.actionList.some((a) => a.id === "jump-start"))
  );
});

test("custom NPC fallback does not advertise hard operator-only actions", async () => {
  await setup();
  const npc = makeShip({
    role: "npc",
    stations: [...stations(), { id: "drone", type: "drone-console", grade: "commercial" }],
    extra: { sourceId: "custom-no-operator" }
  });
  const ctx = await buildSheetContext({ document: npc, isNpc: true, tab: "stations", tabs: ["stations"] });
  assert.ok(
    !ctx.npcActions.some((a) =>
      ["boost-battle-station", "deploy-drone", "retrieve-drone", "drone-block", "repair-hull-drone", "deploy-starship-mine"].includes(a.id)
    )
  );
});

for (const role of ["npc", "player"]) {
  test(`${role} shared action crew requirement uses classification, not crew size`, async () => {
    const { content } = await setup();
    content.actions.set("test-shared-any", {
      id: "test-shared-any",
      station: "any",
      cost: 1,
      effects: [{ type: "manual", text: "GM adjudication" }]
    });
    const pc = makeCharacter({ id: "pc", name: "Unstationed crew" });
    const ship = makeShip({ id: "ship", role, crew: [{ actorUuid: pc.uuid, role: "observer" }] });
    const request = { userId: "gm", shipUuid: ship.uuid, actionId: "test-shared-any", dryRun: true };
    if (role === "player") await assert.rejects(() => executeAction(request), /helming/i);
    else {
      const result = await executeAction(request);
      assert.equal(result.ok, true);
      assert.deepEqual(result.ctx.warnings, []);
      assert.equal(result.ctx.crew, null);
    }
  });
}
