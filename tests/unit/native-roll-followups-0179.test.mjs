import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFoundryMock, loadContentFromDisk, makeCharacter, makeShip, makeStarshipCombat, dice } from "../helpers/foundry-mock.mjs";
import { dispatchSocketMessage, registerHandler, _trackPending } from "../../scripts/socket.mjs";
import { executeAction, registerActionHandlers } from "../../scripts/actions/action-engine.mjs";
import { resolveAreaFire } from "../../scripts/actions/strike.mjs";
import { executeEffects } from "../../scripts/actions/effects-exec.mjs";
import { computeShipStats } from "../../scripts/starship/stats.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";

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
    ship: async () => ({ actor: target, data: readStarship(target) })
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
