import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFoundryMock, makeShip, makeCharacter, MockActor } from "../helpers/foundry-mock.mjs";
import { worldHazardChoices, compendiumHazardChoices } from "../../scripts/sensor/contact-service.mjs";
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

test("world choices expose numeric levels without guessing from names", () => {
  installFoundryMock();
  const low = makeShip({ id: "low", name: "Renamed (Lv 20)", level: -1 });
  const zero = makeShip({ id: "zero", level: 0 });
  const hazard = new MockActor({ id: "hazard", type: "hazard", system: { details: { level: { value: 7 } } } });
  const unknown = new MockActor({ id: "unknown", type: "hazard" });
  game.actors.set(hazard.id, hazard);
  game.actors.set(unknown.id, unknown);
  const choices = new Map(worldHazardChoices().map((choice) => [choice.uuid, choice]));
  assert.equal(choices.get(low.uuid).level, -1);
  assert.equal(choices.get(zero.uuid).level, 0);
  assert.equal(choices.get(hazard.uuid).level, 7);
  assert.equal(choices.get(unknown.uuid).level, null);
});

test("compendium choices request level fields and point to their own original", async () => {
  installFoundryMock();
  let requested;
  game.packs = [
    {
      documentName: "Actor",
      collection: "world.sources",
      metadata: { label: "Sources" },
      async getIndex({ fields }) {
        requested = fields;
        return [
          { _id: "ship", name: "Ship", type: "npc", flags: { [MODULE_ID]: { starship: { isStarship: true, level: -1 } } } },
          { _id: "hazard", name: "Hazard", type: "hazard", system: { details: { level: { value: 0 } } } }
        ];
      }
    }
  ];
  const choices = await compendiumHazardChoices();
  assert.ok(requested.includes(`flags.${MODULE_ID}.starship.level`));
  assert.ok(requested.includes("system.details.level.value"));
  assert.equal(choices.find((choice) => choice.kind === "starship").level, -1);
  assert.equal(choices.find((choice) => choice.kind === "hazard").level, 0);
  for (const choice of choices) assert.equal(choice.originalUuid, choice.uuid);
});

test("world originals use stored provenance, including copy chains, never names", () => {
  installFoundryMock();
  const uuid = "Compendium.world.sources.Actor.original";
  const source = makeShip({ id: "source", name: "Renamed" });
  source._stats = { compendiumSource: uuid };
  const legacy = makeShip({ id: "legacy" });
  legacy.flags.core = { sourceId: uuid };
  const imported = makeShip({ id: "imported" });
  imported.flags[MODULE_ID].contactImport = { sourceUuid: uuid };
  const sensor = makeShip({ id: "sensor" });
  sensor.flags[MODULE_ID].sensorContactInstance = { sourceUuid: source.uuid };
  const copy = makeShip({ id: "copy" });
  copy.flags[MODULE_ID].tacticalCopyOf = source.uuid;
  const noSource = makeShip({ id: "no-source", name: source.name });
  const cyclic = makeShip({ id: "cyclic" });
  cyclic.flags[MODULE_ID].tacticalCopyOf = cyclic.uuid;
  const choices = new Map(worldHazardChoices().map((choice) => [choice.uuid, choice]));
  for (const actor of [source, legacy, imported, sensor, copy]) assert.equal(choices.get(actor.uuid).originalUuid, uuid);
  for (const actor of [noSource, cyclic]) assert.equal(choices.get(actor.uuid).originalUuid, null);
});

test("original preview opens the native compendium sheet without selection or document writes", async () => {
  const { app, StartCombatWizard } = await loadWizard();
  const ship = makeShip({ id: "source", name: "Renamed", role: "npc" });
  const uuid = "Compendium.world.sources.Actor.original";
  ship._stats = { compendiumSource: uuid };
  const opened = [];
  globalThis.__extraUuids.set(uuid, { documentName: "Actor", pack: "world.sources", sheet: { render: (force) => opened.push(force) } });
  await app._prepareContext();
  app.selectCandidate(ship.uuid, true, "starship");
  const before = app.getDraft();
  const preview = StartCombatWizard.DEFAULT_OPTIONS.actions.previewOriginal;
  assert.equal(typeof preview, "function");
  let prevented = false;
  let stopped = false;
  await preview.call(
    app,
    {
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      }
    },
    { dataset: { uuid: ship.uuid, kind: "starship" } }
  );
  assert.deepEqual(opened, [true]);
  assert.ok(prevented && stopped);
  assert.equal((await app._prepareContext()).selectedCount, 1);
  assert.deepEqual(app.getDraft(), before);
  assert.deepEqual(globalThis.__writes, []);
});

test("a missing compendium original reports failure without importing a replacement", async () => {
  const { app, StartCombatWizard } = await loadWizard();
  const hazard = new MockActor({ id: "hazard", type: "hazard" });
  hazard._stats = { compendiumSource: "Compendium.world.sources.Actor.missing" };
  game.actors.set(hazard.id, hazard);
  await app._prepareContext();
  const preview = StartCombatWizard.DEFAULT_OPTIONS.actions.previewOriginal;
  assert.equal(typeof preview, "function");
  await preview.call(app, { preventDefault() {}, stopPropagation() {} }, { dataset: { uuid: hazard.uuid, kind: "hazard" } });
  assert.equal(globalThis.__notes.at(-1)?.[1], game.i18n.localize("SF2eTSC.wizard.originalUnavailable"));
  assert.equal(game.actors.size, 1);
  assert.deepEqual(globalThis.__writes, []);
});

for (const failure of ["resolve", "render", "world", "item"]) {
  test(`original preview handles ${failure} failure without writes`, async () => {
    const { app, StartCombatWizard } = await loadWizard();
    const ship = makeShip({ id: "source" });
    ship._stats = { compendiumSource: "Compendium.world.sources.Actor.original" };
    await app._prepareContext();
    let rendered = 0;
    globalThis.fromUuid = async () => {
      if (failure === "resolve") throw new Error("permission denied");
      return {
        documentName: failure === "item" ? "Item" : "Actor",
        pack: failure === "world" ? null : "world.sources",
        sheet: {
          render() {
            rendered++;
            throw new Error("sheet unavailable");
          }
        }
      };
    };
    await StartCombatWizard.DEFAULT_OPTIONS.actions.previewOriginal.call(
      app,
      { preventDefault() {}, stopPropagation() {} },
      { dataset: { uuid: ship.uuid, kind: "starship" } }
    );
    assert.equal(rendered, failure === "render" ? 1 : 0);
    assert.equal(globalThis.__notes.at(-1)?.[1], game.i18n.localize("SF2eTSC.wizard.originalUnavailable"));
    assert.deepEqual(globalThis.__writes, []);
  });
}

test("closing the wizard while the original loads does not open a late sheet", async () => {
  const { app, StartCombatWizard } = await loadWizard();
  const ship = makeShip({ id: "source" });
  ship._stats = { compendiumSource: "Compendium.world.sources.Actor.original" };
  await app._prepareContext();
  let resolve;
  let rendered = 0;
  globalThis.fromUuid = () =>
    new Promise((done) => {
      resolve = done;
    });
  const opening = StartCombatWizard.DEFAULT_OPTIONS.actions.previewOriginal.call(
    app,
    { preventDefault() {}, stopPropagation() {} },
    { dataset: { uuid: ship.uuid, kind: "starship" } }
  );
  await app.close();
  resolve({
    documentName: "Actor",
    pack: "world.sources",
    sheet: {
      render() {
        rendered++;
      }
    }
  });
  await opening;
  assert.equal(rendered, 0);
  assert.deepEqual(globalThis.__writes, []);
});

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

test("an unrelated ship update keeps preset station choices; a real source change adopts them", async () => {
  const { app } = await loadWizard();
  const chosen = makeCharacter({ id: "chosen", name: "Chosen" });
  const source = makeCharacter({ id: "source", name: "Source" });
  const ship = makeShip({
    id: "player",
    role: "player",
    stations: [{ id: "pilot", type: "pilot", helmedBy: source.uuid }],
    crew: [{ actorUuid: source.uuid, name: source.name, role: "crew", stationId: "pilot" }]
  });
  await app.loadDraft({
    playerShips: [{ uuid: ship.uuid, zone: 2, stationAssignments: [{ stationId: "pilot", actorUuid: chosen.uuid }] }]
  });
  const pilot = () => app.getDraft().playerShips[0].stationAssignments.find((s) => s.stationId === "pilot").actorUuid;
  assert.equal(pilot(), chosen.uuid);
  ship.name = "Renamed ship";
  ship.system.attributes.hp.value = 1;
  app.wants("actor", ship);
  assert.equal(pilot(), chosen.uuid, "rename/HP update must not discard the preset choice");
  ship.flags[MODULE_ID].starship.stations[0].helmedBy = null;
  app.wants("actor", ship);
  assert.equal(pilot(), null, "a real station release is adopted into the draft");
});
