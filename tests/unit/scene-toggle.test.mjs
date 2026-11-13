import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFoundryMock, loadContentFromDisk } from "../helpers/foundry-mock.mjs";

const r = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
}

/** Register a real window in the live registry, stub close, and guarantee deregistration afterwards. */
async function withOpenWindow(Class, body) {
  const app = new Class();
  let closed = 0;
  app.close = async () => {
    closed++;
  };
  app._onFirstRender({}, {});
  try {
    await body(() => closed);
  } finally {
    app._onClose({});
  }
}

test("scene button toggle closes an open Sensor Map instead of stacking another", async () => {
  await setup();
  const { SensorMapApplication } = await import("../../scripts/ui/sensor-map-app.mjs");
  const { toggleSensorMap } = await import("../../scripts/ui/launchers.mjs");
  await withOpenWindow(SensorMapApplication, async (closed) => {
    await toggleSensorMap();
    assert.equal(closed(), 1);
  });
});

test("scene button toggle closes an open Station HUD instead of stacking another", async () => {
  await setup();
  const { StationHUD } = await import("../../scripts/ui/station-hud.mjs");
  const { toggleStationHUD } = await import("../../scripts/ui/launchers.mjs");
  await withOpenWindow(StationHUD, async (closed) => {
    await toggleStationHUD();
    assert.equal(closed(), 1);
  });
});

test("scene button toggle closes an open Start Wizard instead of stacking another", async () => {
  await setup();
  const { StartCombatWizard } = await import("../../scripts/ui/start-wizard.mjs");
  const { toggleStartWizard } = await import("../../scripts/ui/launchers.mjs");
  await withOpenWindow(StartCombatWizard, async (closed) => {
    await toggleStartWizard();
    assert.equal(closed(), 1);
  });
});

test("scene button toggle opens the Start Wizard when none is open", async () => {
  await setup();
  const { StartCombatWizard } = await import("../../scripts/ui/start-wizard.mjs");
  const { toggleStartWizard } = await import("../../scripts/ui/launchers.mjs");
  const proto = StartCombatWizard.prototype;
  const original = proto.render;
  let opened = 0;
  proto.render = async function () {
    opened++;
    return this;
  };
  try {
    await toggleStartWizard();
    assert.equal(opened, 1);
  } finally {
    if (original) proto.render = original;
    else delete proto.render;
  }
});

test("scene button toggle closes an open Toolbox dialog", async () => {
  await setup();
  const { toggleToolbox } = await import("../../scripts/ui/launchers.mjs");
  let closed = 0;
  foundry.applications.instances = new Map([
    ["dialog-1", { rendered: true, options: { classes: ["sf2e-tsc", "tsc-toolbox-dialog"] }, close: async () => closed++ }]
  ]);
  await toggleToolbox();
  assert.equal(closed, 1);
});

test("scene button toggle closes every stacked Toolbox dialog and leaves other windows alone", async () => {
  await setup();
  const { toggleToolbox } = await import("../../scripts/ui/launchers.mjs");
  let closed = 0;
  let otherClosed = 0;
  const toolbox = () => ({ rendered: true, options: { classes: ["tsc-toolbox-dialog"] }, close: async () => closed++ });
  foundry.applications.instances = new Map([
    ["dialog-1", toolbox()],
    ["dialog-2", toolbox()],
    ["dialog-3", { rendered: false, options: { classes: ["tsc-toolbox-dialog"] }, close: async () => closed++ }],
    ["other", { rendered: true, options: { classes: ["something-else"] }, close: async () => otherClosed++ }]
  ]);
  await toggleToolbox();
  assert.equal(closed, 2);
  assert.equal(otherClosed, 0);
});

test("scene button toggle opens the Toolbox when none is open", async () => {
  await setup();
  const { toggleToolbox } = await import("../../scripts/ui/launchers.mjs");
  foundry.applications.instances = new Map();
  let opened = 0;
  foundry.applications.api.DialogV2.wait = async () => {
    opened++;
    return null;
  };
  await toggleToolbox();
  assert.equal(opened, 1);
});

test("all four scene buttons are wired to toggle launchers that close an open window", () => {
  const controls = r("scripts/ui/controls.mjs");
  assert.match(controls, /"tscSensorMap"[^\n]*toggleSensorMap/);
  assert.match(controls, /"tscStationHud"[^\n]*toggleStationHUD/);
  assert.match(controls, /"tscStart"[^\n]*toggleStartWizard/);
  assert.match(controls, /"tscToolbox"[^\n]*toggleToolbox/);
  const launchers = r("scripts/ui/launchers.mjs");
  for (const fn of ["toggleSensorMap", "toggleStationHUD", "toggleStartWizard", "toggleToolbox"])
    assert.match(launchers, new RegExp(`export async function ${fn}\\(`));
  assert.match(launchers, /openApps\(SensorMapApplication\)\[0\];\s*return ex \? ex\.close\(\)/);
  assert.match(launchers, /openApps\(StationHUD\)\[0\];\s*return ex \? ex\.close\(\)/);
  assert.match(launchers, /openApps\(StartCombatWizard\)\[0\];\s*return ex \? ex\.close\(\)/);
  assert.match(launchers, /foundry\.applications\.instances/);
  assert.match(launchers, /tsc-toolbox-dialog/);
});
