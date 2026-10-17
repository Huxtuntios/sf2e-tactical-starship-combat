import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";
import { MODULE_ID as M } from "../../scripts/constants.mjs";
import {
  normalizeSheetTheme,
  clientSheetTheme,
  sheetThemeOptions,
  paintSheetTheme,
  wireSheetTheme
} from "../../scripts/ui/sheet/sheet-theme.mjs";
import { MAP_PALETTES } from "../../scripts/sensor/appearance.mjs";
import { registerSettings } from "../../scripts/settings.mjs";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
function root(selects = []) {
  const css = new Map();
  return { dataset: {}, style: { setProperty: (k, v) => css.set(k, v) }, css, querySelectorAll: () => selects, contains: () => false };
}
function selector() {
  const handlers = [];
  return { dataset: {}, value: "dark", disabled: true, handlers, addEventListener: (name, callback) => handlers.push(callback) };
}

test("0.11.1 theme defaults and invalid settings fall back to dark", () => {
  installFoundryMock({ lang: "ru" });
  for (const value of [undefined, null, "bad", {}, "dark"]) assert.equal(normalizeSheetTheme(value), "dark");
  assert.equal(normalizeSheetTheme("light"), "light");
  assert.equal(clientSheetTheme(), "dark");
  const options = sheetThemeOptions();
  assert.deepEqual(
    options.map((o) => [o.id, o.selected]),
    [
      ["dark", true],
      ["light", false]
    ]
  );
  assert.deepEqual(
    options.map((o) => o.label),
    ["Тёмная", "Светлая"]
  );
});

test("0.11.1 Foundry registration is client-scoped, visible and not a world setting", () => {
  installFoundryMock();
  const registrations = new Map();
  game.settings.register = (module, key, value) => {
    assert.equal(module, M);
    registrations.set(key, value);
  };
  registerSettings();
  const setting = registrations.get("starshipSheetTheme");
  assert.equal(setting.scope, "client");
  assert.equal(setting.config, true);
  assert.equal(setting.default, "dark");
  assert.deepEqual(Object.keys(setting.choices), ["dark", "light"]);
  assert.equal(typeof setting.onChange, "function");
  assert.equal(registrations.get("sensorMapSize").scope, "world");
});

test("0.11.1 two clients can save different preferences without actor/combat/socket writes", async () => {
  installFoundryMock();
  const clientA = new Map(),
    clientB = new Map();
  let current = clientA;
  game.settings.get = (module, key) => current.get(key);
  game.settings.set = async (module, key, value) => {
    assert.equal(module, M);
    assert.equal(key, "starshipSheetTheme");
    current.set(key, value);
  };
  const sA = selector(),
    rA = root([sA]);
  wireSheetTheme({ element: rA });
  sA.value = "light";
  await sA.handlers[0]();
  assert.equal(clientSheetTheme(), "light");
  assert.equal(rA.dataset.sheetTheme, "light");
  current = clientB;
  const sB = selector(),
    rB = root([sB]);
  wireSheetTheme({ element: rB });
  assert.equal(clientSheetTheme(), "dark");
  assert.equal(rB.dataset.sheetTheme, "dark");
  current = clientA;
  assert.equal(clientSheetTheme(), "light");
  assert.deepEqual(globalThis.__writes, []);
  assert.deepEqual(globalThis.__socket, []);
});

test("0.11.1 read-only selectors are enabled and wired exactly once across partial renders", async () => {
  const { settings, setUser } = installFoundryMock();
  setUser("p1");
  const select = selector(),
    element = root([select]),
    sheet = { element, tab: "notes" };
  wireSheetTheme(sheet);
  wireSheetTheme(sheet);
  assert.equal(select.handlers.length, 1);
  assert.equal(select.disabled, false);
  select.value = "light";
  await select.handlers[0]();
  assert.equal(settings.get("starshipSheetTheme"), "light");
  assert.equal(element.dataset.sheetTheme, "light");
  assert.equal(sheet.tab, "notes");
  assert.deepEqual(globalThis.__writes, []);
  assert.deepEqual(globalThis.__socket, []);
  const newSelect = selector();
  element.querySelectorAll = () => [newSelect];
  wireSheetTheme(sheet);
  assert.equal(newSelect.value, "light");
  assert.equal(newSelect.handlers.length, 1);
});

test("0.11.1 setting-save failure restores the local selection and reports an error", async () => {
  installFoundryMock();
  game.settings.set = async () => {
    throw new Error("setting failed");
  };
  const select = selector(),
    element = root([select]);
  wireSheetTheme({ element });
  select.value = "light";
  await select.handlers[0]();
  assert.equal(element.dataset.sheetTheme, "dark");
  assert.equal(select.value, "dark");
  assert.equal(globalThis.__notes.at(-1)[0], "error");
  assert.deepEqual(globalThis.__writes, []);
});

test("0.11.1 painting both palettes changes only the sheet root, never the map appearance", () => {
  const element = root();
  const before = structuredClone(MAP_PALETTES);
  for (const theme of ["light", "dark"]) {
    paintSheetTheme(element, theme);
    assert.equal(element.dataset.sheetTheme, theme);
    for (const [key, value] of Object.entries(MAP_PALETTES[theme])) assert.equal(element.css.get(`--tsc-${key}`), value);
    assert.equal(element.dataset.mapTheme, undefined);
    assert.equal(element.dataset.mapMode, undefined);
  }
  assert.deepEqual(MAP_PALETTES, before);
});

test("0.11.1 setting changes refresh all local open ship sheets, but not Sensor Map or active tabs", async () => {
  const { settings } = installFoundryMock();
  const registrations = new Map();
  game.settings.register = (module, key, value) => registrations.set(key, value);
  registerSettings();
  const { LiveMixin } = await import("../../scripts/ui/base-app.mjs");
  class LocalSheet extends LiveMixin(class {}) {
    channels = ["sheetTheme"];
    rendered = true;
    element = root();
    tab = "equipment";
    renders = 0;
    partsFor() {
      return ["header"];
    }
    render(options) {
      this.renders++;
      this.lastParts = options.parts;
      paintSheetTheme(this.element);
    }
  }
  class LocalMap extends LocalSheet {
    channels = ["settings", "combat"];
  }
  const a = new LocalSheet(),
    b = new LocalSheet(),
    map = new LocalMap();
  for (const app of [a, b, map]) app._onFirstRender({}, {});
  try {
    settings.set("starshipSheetTheme", "light");
    await registrations.get("starshipSheetTheme").onChange("light");
    await new Promise((r) => setTimeout(r, 100));
    for (const app of [a, b]) {
      assert.equal(app.renders, 1);
      assert.equal(app.element.dataset.sheetTheme, "light");
      assert.deepEqual(app.lastParts, ["header"]);
      assert.equal(app.tab, "equipment");
    }
    assert.equal(map.renders, 0);
    assert.equal(map.element.dataset.sheetTheme, undefined);
  } finally {
    for (const app of [a, b, map]) app._onClose({});
  }
});

test("0.11.1 player and NPC contexts both inherit the saved local theme", async () => {
  const { settings } = installFoundryMock();
  await loadContentFromDisk();
  settings.set("starshipSheetTheme", "light");
  const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
  for (const role of ["player", "npc"]) {
    const actor = makeShip({ id: role, name: role, role });
    const context = await buildSheetContext({ document: actor, isNpc: role === "npc", tab: "overview", tabs: ["overview"] });
    assert.equal(context.sheetThemeOptions.find((o) => o.id === "light").selected, true);
    assert.equal(context.isNpc, role === "npc");
  }
});

test("0.11.1 header selector is available to observers, not bound to actor data", () => {
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => key);
  const render = h.compile(read("templates/starship-sheet-header.hbs"));
  for (const isNpc of [false, true]) {
    const html = render({
      isNpc,
      isGM: false,
      perms: {},
      ship: { hp: {}, sp: {} },
      sheetThemeOptions: [{ id: "light", label: "Светлая", selected: true }]
    });
    assert.match(html, /data-sheet-theme-select/);
    assert.match(html, /value="light" selected/);
    assert.ok(!/data-sheet-theme-select[^>]*data-field/.test(html));
  }
  const src = read("scripts/ui/starship-sheet.mjs");
  assert.match(src, /wireSheetTheme\(this\)/);
  assert.match(src, /"sheetTheme"/);
  const css = read("styles/main.css");
  for (const selector of [".tsc-sub td", ".tsc-station.malf", ".tsc-warn-box", "button.active", ".tsc-bars .bar em"])
    assert.ok(css.includes(selector), selector);
});
