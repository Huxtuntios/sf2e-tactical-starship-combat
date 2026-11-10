// Offline smoke test: imports EVERY module with minimal Foundry stubs to catch syntax errors, broken imports and
// top-level runtime errors. This is NOT a replacement for testing inside a real Foundry v14 world (see docs/testing.md).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
class Stub {
  constructor() {}
  static DEFAULT_OPTIONS = {};
  static PARTS = {};
}
globalThis.foundry = {
  applications: {
    api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: {} },
    sheets: { ActorSheetV2: Stub },
    handlebars: { loadTemplates() {} },
    apps: { DocumentSheetConfig: { registerSheet() {} } }
  },
  utils: {
    randomID: () => "abc123",
    deepClone: (o) => structuredClone(o),
    debounce: (f) => f,
    escapeHTML: (s) => s,
    setProperty() {},
    expandObject: (o) => o,
    saveDataToFile() {}
  }
};
Object.assign(globalThis, {
  Hooks: { on() {}, once() {}, callAll() {} },
  game: {
    settings: { get: () => null, register() {} },
    i18n: { localize: (k) => k, format: (k) => k, has: () => true },
    users: [],
    actors: [],
    modules: new Map(),
    system: { id: "sf2e" }
  },
  ui: { notifications: {} },
  canvas: {},
  CONFIG: {},
  Handlebars: { registerHelper() {} },
  FormDataExtended: class {},
  PIXI: {},
  CONST: {},
  ChatMessage: {},
  Roll: class {},
  Actor: class {},
  Combat: class {},
  Folder: class {},
  DocumentSheetConfig: {},
  loadTemplates() {},
  fromUuid: async () => null,
  fromUuidSync: () => null
});
const walk = (d) =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".mjs") ? [path.join(d, e.name)] : []));

for (const f of walk(path.join(root, "scripts"))) {
  test(`imports cleanly: ${path.relative(root, f)}`, async () => {
    await import(pathToFileURL(f).href);
  });
}
test("content builders produce valid actor data", async () => {
  const { loadAll } = await import(pathToFileURL(path.join(root, "tools/validate-content.mjs")).href);
  const { buildShipActorData, buildHazardActorData, buildPlayerShipData } = await import(
    pathToFileURL(path.join(root, "scripts/content/ship-docs.mjs")).href
  );
  const c = loadAll();
  for (const s of c.ships) {
    const d = buildShipActorData(s);
    assert.equal(d.type, "npc");
    assert.equal(d.flags["sf2e-tactical-starship-combat"].starship.isStarship, true);
    assert.ok(d.system.attributes.hp.max > 0, s.id);
  }
  for (const h of c.hazards) {
    const d = buildHazardActorData(h);
    assert.equal(d.type, "hazard");
    assert.equal(d.system.details.isComplex, h.isComplex);
  }
  for (const fr of c.frames) {
    const d = buildPlayerShipData({ name: "T", frame: fr, level: 5 });
    assert.equal(d.type, "vehicle");
    assert.equal(d.system.attributes.hp.max, fr.table[4].hp);
  }
});
