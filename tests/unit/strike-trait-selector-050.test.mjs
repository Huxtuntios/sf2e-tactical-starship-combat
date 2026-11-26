import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
const nativeCatalogs = {
  weaponTraits: { agile: "SF2eTSC.traits.agile", tech: "SF2eTSC.traits.tech" },
  npcAttackTraits: { unarmed: "SF2eTSC.traits.unarmed" },
  actionTraits: { attack: "SF2eTSC.traits.attack", manipulate: "SF2eTSC.traits.manipulate" },
  vehicleTraits: { starship: "SF2eTSC.traits.starship", area: "SF2eTSC.traits.area" }
};

function renderEditor(context) {
  const h = Handlebars.create();
  h.registerHelper("localize", (key, options) => (options?.hash ? game.i18n.format(key, options.hash) : game.i18n.localize(key)));
  h.registerHelper("eq", (a, b) => a === b);
  return h.compile(fs.readFileSync("templates/ship-editor.hbs", "utf8"))(context);
}

async function editorFixture(lang = "en") {
  installFoundryMock({ lang });
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  const actor = makeShip({
    id: `strike-traits-${lang}`,
    name: "Strike trait fixture",
    role: "npc",
    extra: {
      strikes: [
        {
          name: "Legacy Strike",
          kind: "ranged",
          attack: 7,
          damage: "1d6 fire",
          traits: ["agile", "legacy custom trait"]
        }
      ]
    }
  });
  const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
  const sheet = { document: actor, isNpc: true, tab: "config", tabs: ["overview", "config"] };
  return { actor, sheet, context: await buildSheetContext(sheet) };
}

test("Strike trait catalog unions verified system catalogs with module traits and localizes labels", async () => {
  installFoundryMock({ lang: "ru" });
  const edit = await import("../../scripts/ui/sheet-edit.mjs");
  assert.equal(typeof edit.strikeTraitCatalog, "function", "Strike trait catalog is missing");
  const catalog = edit.strikeTraitCatalog(nativeCatalogs);
  const values = catalog.map((entry) => entry.value);
  for (const value of ["agile", "unarmed", "attack", "manipulate", "starship", "area", "ordnance", "tech", "range increment 4 zones"]) {
    assert.ok(values.includes(value), `catalog is missing ${value}`);
  }
  assert.equal(new Set(values).size, values.length, "catalog contains duplicate trait slugs");
  assert.equal(catalog.find((entry) => entry.value === "agile").label, "Быстрое");
  assert.equal(catalog.find((entry) => entry.value === "unarmed").label, "Безоружное");
  assert.equal(catalog.find((entry) => entry.value === "ordnance").label, "Боеприпас");
  assert.equal(catalog.find((entry) => entry.value === "range increment 4 zones").label, "Шаг дистанции 4 зон");
  assert.equal(catalog.find((entry) => entry.value === "starship").label, "starship");
});

test("Strike trait catalog falls back to verified module snapshots when system config is unavailable", async () => {
  installFoundryMock({ lang: "en" });
  const edit = await import("../../scripts/ui/sheet-edit.mjs");
  const catalog = edit.strikeTraitCatalog({});
  const values = new Set(catalog.map((entry) => entry.value));
  for (const value of ["agile", "unarmed", "attack", "manipulate", "starship", "ordnance", "range increment 10 zones", "volley 2 zones"]) {
    assert.ok(values.has(value), `fallback catalog is missing ${value}`);
  }
});

test("Strike trait search matches localized labels and stored slugs", async () => {
  installFoundryMock({ lang: "ru" });
  const edit = await import("../../scripts/ui/sheet-edit.mjs");
  const catalog = edit.strikeTraitCatalog(nativeCatalogs);
  assert.deepEqual(
    edit.filterStrikeTraits(catalog, "Быстр").map((entry) => entry.value),
    ["agile"]
  );
  assert.deepEqual(
    edit.filterStrikeTraits(catalog, "range increment 4").map((entry) => entry.value),
    ["range increment 4 zones"]
  );
  assert.equal(edit.filterStrikeTraits(catalog, "  ").length, catalog.length);
});

test("Strike trait selection adds, removes and prevents duplicate slugs while preserving custom text", async () => {
  const edit = await import("../../scripts/ui/sheet-edit.mjs");
  assert.equal(typeof edit.toggleStrikeTrait, "function", "Strike trait selection helper is missing");
  assert.deepEqual(edit.toggleStrikeTrait([], "agile", true), ["agile"]);
  assert.deepEqual(edit.toggleStrikeTrait(["agile"], "agile", true), ["agile"]);
  assert.deepEqual(edit.toggleStrikeTrait(["agile", "tech"], "agile", false), ["tech"]);
  assert.deepEqual(edit.uniqueStrikeTraits([" agile ", "agile", "Tech", "legacy custom trait"]), ["agile", "Tech", "legacy custom trait"]);
  const form = {
    querySelectorAll(selector) {
      assert.equal(selector, '[name="strikeTraits"]:checked');
      return [{ value: "agile" }, { value: "agile" }, { value: "legacy custom trait" }];
    }
  };
  assert.deepEqual(edit.readStrikeTraits(form), ["agile", "legacy custom trait"]);
});

test("existing Strike custom traits still render and persist through the CSV storage schema", async () => {
  const { actor, context } = await editorFixture("ru");
  assert.deepEqual(context.edit.strikes[0].traits, ["agile", "legacy custom trait"]);
  assert.equal(context.edit.strikes[0].traitsText, "agile, legacy custom trait");
  const html = renderEditor(context);
  assert.match(html, /data-list="strikes"[^>]*data-key="traits"[^>]*value="agile, legacy custom trait"/);

  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const { Ship } = await import("../../scripts/starship/ship-service.mjs");
  await Ship.equipment(actor.uuid, "strikes", "update", {
    index: 0,
    item: { traits: ["agile", "legacy custom trait"] }
  });
  assert.deepEqual(actor.flags[M].starship.strikes[0].traits, ["agile", "legacy custom trait"]);
});

test("Add Strike waits for trait selection, stores chosen slugs and cancellation writes nothing", async (t) => {
  installFoundryMock({ lang: "en" });
  CONFIG.PF2E = nativeCatalogs;
  await loadContentFromDisk();
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const actor = makeShip({ id: "strike-create", name: "Strike create", role: "npc", extra: { strikes: [] } });
  const sheet = { document: actor };
  const { ApplicationV2 } = foundry.applications.api;
  const originalRender = ApplicationV2.prototype.render;
  const originalClose = ApplicationV2.prototype.close;
  const dialogs = [];
  ApplicationV2.prototype.render = async function () {
    dialogs.push(this);
    return this;
  };
  ApplicationV2.prototype.close = async function (options = {}) {
    await this._onClose?.(options);
    return this;
  };
  t.after(() => {
    ApplicationV2.prototype.render = originalRender;
    ApplicationV2.prototype.close = originalClose;
  });

  const actions = await import("../../scripts/ui/sheet/sheet-actions.mjs");
  const actorWrites = () => globalThis.__writes.filter((write) => write.doc === actor.uuid).length;
  const writesBefore = actorWrites();
  const adding = actions.addListItem.call(sheet, null, { dataset: { list: "strikes" } });
  await new Promise(setImmediate);
  assert.equal(dialogs.length, 1, "Add Strike must open the trait selector before writing");
  assert.equal(actorWrites(), writesBefore, "opening the trait selector must not write the Actor");
  await dialogs[0].close({ result: ["agile", "range increment 4 zones"] });
  await adding;
  assert.deepEqual(actor.flags[M].starship.strikes[0].traits, ["agile", "range increment 4 zones"]);

  const cancelling = actions.addListItem.call(sheet, null, { dataset: { list: "strikes" } });
  await new Promise(setImmediate);
  assert.equal(dialogs.length, 2);
  await dialogs[1].close();
  await cancelling;
  assert.equal(actorWrites(), writesBefore + 1, "only the confirmed creation may write the Actor");
  assert.equal(actor.flags[M].starship.strikes.length, 1, "cancelled creation must not add a Strike");
});
