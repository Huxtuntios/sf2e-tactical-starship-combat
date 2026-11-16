import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFoundryMock, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";
import { normalizePreset, savePreset, listPresets } from "../../scripts/combat/presets.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rd = (p) => fs.readFileSync(path.join(root, p), "utf8");
const loadWizard = async () => {
  installFoundryMock();
  const { StartCombatWizard } = await import("../../scripts/ui/start-wizard.mjs");
  const app = new StartCombatWizard();
  app.render = async () => app;
  return { StartCombatWizard, app };
};

test("preset normalization keeps an explicit reuse boolean and omits an absent one", () => {
  assert.equal(normalizePreset({ enemies: [{ uuid: "Actor.a", reuse: false }] }).enemies[0].reuse, false);
  assert.equal(normalizePreset({ enemies: [{ uuid: "Actor.a", reuse: true }] }).enemies[0].reuse, true);
  assert.equal(Object.hasOwn(normalizePreset({ enemies: [{ uuid: "Actor.a" }] }).enemies[0], "reuse"), false);
});

test("a new eligible world NPC entry defaults reuse to enabled", async () => {
  const { app } = await loadWizard();
  const npc = makeShip({ id: "npc", role: "npc" });
  await app.loadDraft({ enemies: [{ uuid: npc.uuid, detection: "identified" }] });
  assert.equal(app.getDraft().enemies[0].reuse, true);
});

test("explicit false is retained and a legacy entry without the flag defaults to true", async () => {
  const { app } = await loadWizard();
  const npc = makeShip({ id: "npc", role: "npc" });
  await app.loadDraft({ enemies: [{ uuid: npc.uuid, detection: "identified", reuse: false }] });
  assert.equal(app.getDraft().enemies[0].reuse, false);
  await app.loadDraft({ enemies: [{ uuid: npc.uuid, detection: "identified" }] });
  assert.equal(app.getDraft().enemies[0].reuse, true);
});

test("reuse stays disabled for ineligible entries even with the new default", async () => {
  const { app } = await loadWizard();
  const npc = makeShip({ id: "npc", role: "npc" });
  await app.loadDraft({ enemies: [{ uuid: npc.uuid, count: 2, detection: "identified" }] });
  assert.equal(app.getDraft().enemies[0].reuse, false);
  await app.loadDraft({ enemies: [{ uuid: npc.uuid, detection: "hidden" }] });
  assert.equal(app.getDraft().enemies[0].reuse, false);
});

test("preset save/load round-trips an explicit false reuse value", async () => {
  const { app } = await loadWizard();
  const npc = makeShip({ id: "npc", role: "npc" });
  await app.loadDraft({ enemies: [{ uuid: npc.uuid, detection: "identified", reuse: false }] });
  const saved = await savePreset({ ...app.getDraft(), name: "reuse-false" });
  assert.equal(saved.enemies[0].reuse, false);
  const loaded = listPresets().find((p) => p.id === saved.id);
  const { app: app2 } = await loadWizard();
  await app2.loadDraft(loaded);
  assert.equal(app2.getDraft().enemies[0].reuse, false);
});

test("wizard exposes the review-window contract and no duplicated crew controls", async () => {
  const { StartCombatWizard } = await loadWizard();
  const { CombatReviewApp } = await import("../../scripts/ui/combat-review.mjs");
  const app = new StartCombatWizard();
  assert.equal(typeof app.reviewContext, "function");
  assert.equal(typeof app.confirmFromReview, "function");
  assert.equal(typeof app.isBusy, "function");
  const actions = StartCombatWizard.DEFAULT_OPTIONS.actions;
  assert.equal(typeof actions.openReview, "function");
  assert.equal(typeof actions.openCrewManager, "function");
  assert.equal(typeof actions.toggleMaximize, "function");
  assert.equal(actions.removeAssignment, undefined);
  assert.equal(StartCombatWizard.DEFAULT_OPTIONS.window.resizable, true);
  const tpl = rd("templates/start-wizard.hbs");
  assert.equal(tpl.includes("data-station="), false);
  assert.equal(tpl.includes("data-member"), false);
  assert.equal(tpl.includes("data-wizard-review"), false);
  assert.ok(tpl.includes("tsc-wizard-browse"));
  assert.ok(rd("templates/combat-review.hbs").includes("data-wizard-review"));
  assert.equal(typeof CombatReviewApp.DEFAULT_OPTIONS.actions.confirm, "function");
  assert.equal(typeof CombatReviewApp.DEFAULT_OPTIONS.actions.back, "function");
});

test("the auto-open review setting is registered and localized in EN and RU", () => {
  const settings = rd("scripts/settings.mjs");
  assert.match(settings, /reg\("autoOpenCombatReview"/);
  assert.match(settings, /autoOpenCombatReview[\s\S]*?default: true/);
  for (const lang of ["en", "ru"]) {
    const json = JSON.parse(rd(`lang/${lang}.json`));
    assert.ok(json.SF2eTSC.settings.autoOpenCombatReview.name);
    assert.ok(json.SF2eTSC.settings.autoOpenCombatReview.hint);
    assert.ok(json.SF2eTSC.wizard.crewSummary);
    assert.ok(json.SF2eTSC.wizard.maximize);
  }
});

test("a live Crew Manager edit refreshes the draft player assignments", async () => {
  const { app } = await loadWizard();
  const crew = makeCharacter({ id: "pilot", name: "Pilot" });
  const ship = makeShip({ id: "player", role: "player", stations: [{ id: "pilot", type: "pilot", helmedBy: null }] });
  await app.loadDraft({ playerShips: [{ uuid: ship.uuid, zone: 2 }] });
  assert.equal(app.getDraft().playerShips[0].stationAssignments.find((s) => s.stationId === "pilot").actorUuid, null);
  ship.flags[MODULE_ID].starship.stations[0].helmedBy = crew.uuid;
  ship.flags[MODULE_ID].starship.crew = [{ actorUuid: crew.uuid, name: crew.name, role: "crew", stationId: "pilot" }];
  assert.equal(app.wants("actor", ship), true);
  assert.equal(app.getDraft().playerShips[0].stationAssignments.find((s) => s.stationId === "pilot").actorUuid, crew.uuid);
});

test("a live edit that deletes a station prunes it from the draft assignments", async () => {
  const { app } = await loadWizard();
  const ship = makeShip({
    id: "player",
    role: "player",
    stations: [
      { id: "pilot", type: "pilot", helmedBy: null },
      { id: "gun", type: "gunner", helmedBy: null }
    ]
  });
  await app.loadDraft({ playerShips: [{ uuid: ship.uuid, zone: 2 }] });
  ship.flags[MODULE_ID].starship.stations = [{ id: "pilot", type: "pilot", helmedBy: null }];
  app.wants("actor", ship);
  assert.deepEqual(
    app.getDraft().playerShips[0].stationAssignments.map((s) => s.stationId),
    ["pilot"]
  );
});

test("a preset assignment naming a deleted station is pruned on load", async () => {
  const { app } = await loadWizard();
  const crew = makeCharacter({ id: "pilot", name: "Pilot" });
  const ship = makeShip({ id: "player", role: "player", stations: [{ id: "pilot", type: "pilot", helmedBy: null }] });
  await app.loadDraft({
    playerShips: [
      {
        uuid: ship.uuid,
        zone: 2,
        stationAssignments: [
          { stationId: "ghost", actorUuid: crew.uuid },
          { stationId: "pilot", actorUuid: crew.uuid }
        ]
      }
    ]
  });
  const assignments = app.getDraft().playerShips[0].stationAssignments;
  assert.equal(
    assignments.some((s) => s.stationId === "ghost"),
    false
  );
  assert.equal(assignments.find((s) => s.stationId === "pilot").actorUuid, crew.uuid);
});

test("the browser auto-opens when empty and collapses when composing unless manually expanded", async () => {
  const { app } = await loadWizard();
  assert.ok(rd("templates/start-wizard.hbs").includes("{{#if browseOpen}}open{{/if}}"));
  assert.equal((await app._prepareContext()).browseOpen, true);
  const npc = makeShip({ id: "npc", role: "npc" });
  await app.loadDraft({ enemies: [{ uuid: npc.uuid, detection: "identified" }] });
  assert.equal((await app._prepareContext()).browseOpen, false);
});
