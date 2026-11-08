import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { MAP_PALETTES } from "../../scripts/sensor/appearance.mjs";
import {
  normalizeSheetTheme,
  clientSheetTheme,
  activeModuleTheme,
  paintSheetTheme,
  refreshModuleThemes,
  registerModuleThemeHooks
} from "../../scripts/ui/sheet/sheet-theme.mjs";
import { registerSettings } from "../../scripts/settings.mjs";

function root(classes = []) {
  const css = new Map();
  return { dataset: {}, classList: { contains: (name) => classes.includes(name) }, style: { setProperty: (k, v) => css.set(k, v) }, css };
}
test("the existing client setting gains Follow Foundry without migrating stored preferences", () => {
  installFoundryMock();
  const registrations = new Map();
  game.settings.register = (_module, key, value) => registrations.set(key, value);
  registerSettings();
  const setting = registrations.get("starshipSheetTheme");
  assert.equal(setting.scope, "client");
  assert.equal(setting.default, "foundry");
  assert.deepEqual(Object.keys(setting.choices), ["foundry", "light", "dark"]);
  for (const value of ["dark", "light"]) assert.equal(normalizeSheetTheme(value), value);
  for (const value of [undefined, null, "bad", {}]) assert.equal(normalizeSheetTheme(value), "foundry");
});
test("follow application setting; forced modes ignore core; empty falls back to app class", () => {
  installFoundryMock();
  let core = "light",
    setting = "foundry";
  game.settings.get = (module) => (module === MODULE_ID ? setting : { colorScheme: { applications: core } });
  assert.equal(clientSheetTheme(), "foundry");
  assert.equal(activeModuleTheme(), "light");
  setting = "dark";
  assert.equal(activeModuleTheme(), "dark");
  setting = "light";
  core = "dark";
  assert.equal(activeModuleTheme(), "light");
  setting = "foundry";
  assert.equal(activeModuleTheme(), "dark");
  core = "";
  assert.equal(activeModuleTheme(undefined, root(["theme-light"])), "light");
  assert.equal(activeModuleTheme(undefined, root(["theme-dark"])), "dark");
  assert.equal(activeModuleTheme(undefined, root()), "dark");
});
test("repaint preserves drafts, map overrides, and changes no document or other root", () => {
  installFoundryMock();
  const sheet = root(),
    map = root(["tsc-sensor-map"]),
    other = root();
  map.dataset.tscTextColor = "#123456";
  const draft = { value: "unsaved" };
  for (const theme of ["light", "dark"]) {
    paintSheetTheme(sheet, theme);
    paintSheetTheme(map, theme);
    assert.equal(sheet.dataset.sheetTheme, theme);
    assert.equal(sheet.css.get("--tsc-bg"), MAP_PALETTES[theme].bg);
    assert.equal(map.dataset.mapTheme, theme);
    assert.equal(map.css.get("--tsc-text"), "#123456");
    assert.equal(map.css.get("--tsc-bg"), MAP_PALETTES[theme].bg);
  }
  assert.equal(other.dataset.sheetTheme, undefined);
  assert.equal(draft.value, "unsaved");
  assert.deepEqual(globalThis.__writes, []);
  assert.deepEqual(globalThis.__socket, []);
});
test("client event repaints all module roots without a render, and ignores unrelated setting changes", () => {
  installFoundryMock();
  let core = "light",
    preference = "foundry";
  game.settings.get = (m) => (m === MODULE_ID ? preference : { colorScheme: { applications: core } });
  const a = root(),
    b = root(["tsc-sensor-map"]);
  let calls = 0;
  globalThis.document = {
    querySelectorAll: () => {
      calls++;
      return [a, b];
    }
  };
  const hooks = {};
  globalThis.Hooks = {
    on: (name, fn) => {
      hooks[name] = fn;
    }
  };
  registerModuleThemeHooks();
  hooks.clientSettingChanged("core.other", {});
  assert.equal(calls, 0);
  hooks.clientSettingChanged("core.uiConfig", {});
  assert.equal(a.dataset.sheetTheme, "light");
  assert.equal(b.dataset.mapTheme, "light");
  core = "dark";
  hooks.clientSettingChanged("core.uiConfig", {});
  assert.equal(a.dataset.sheetTheme, "dark");
  preference = "light";
  core = "dark";
  hooks.clientSettingChanged("core.uiConfig", {});
  assert.equal(a.dataset.sheetTheme, "dark");
  refreshModuleThemes();
  assert.equal(a.dataset.sheetTheme, "light");
  delete globalThis.document;
});
test("module-owned dialog call sites declare isolated class", () => {
  function walk(dir) {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : d.name.endsWith(".mjs") ? [`${dir}/${d.name}`] : []));
  }
  for (const file of walk("scripts")) {
    const s = fs.readFileSync(file, "utf8");
    for (const m of s.matchAll(/DialogV2\.(?:prompt|confirm|wait)\(\{([\s\S]{0,300})/g)) assert.match(m[1], /classes: \["sf2e-tsc"/, file);
  }
});
