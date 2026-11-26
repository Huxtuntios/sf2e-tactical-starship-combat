import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
const source = fs.readFileSync(new URL("../../templates/starship-sheet.hbs", import.meta.url), "utf8");

async function setup(fortify, lang = "en", isNpc = true) {
  installFoundryMock({ lang });
  await loadContentFromDisk();
  const actor = makeShip({
    id: `fortify-${lang}-${isNpc}`,
    name: "Fortify fixture",
    role: isNpc ? "npc" : "player",
    extra: { fort: 12, fortify, sourceId: "preserved-source", unknownField: { keep: true } }
  });
  const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
  const sheet = { document: actor, isNpc, tab: "overview", tabs: ["overview"] };
  return { actor, sheet, context: await buildSheetContext(sheet) };
}

function render(context) {
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => game.i18n.localize(key));
  h.registerHelper("eq", (a, b) => a === b);
  return h.compile(source)(context);
}

for (const lang of ["en", "ru"]) {
  test(`${lang}: NPC overview renders the module Fortify value beside defenses`, async () => {
    const { actor, context } = await setup(7, lang);
    assert.equal(context.ship.fortify, 7);
    assert.equal(context.ship.fort, 12, "Fortify is not the Fortitude save");
    assert.equal(actor.flags[M].starship.sourceId, "preserved-source");
    assert.deepEqual(actor.flags[M].starship.unknownField, { keep: true });
    const label = game.i18n.localize("SF2eTSC.edit.fortify");
    const html = render(context);
    assert.match(html, /data-fortify-stat/);
    assert.ok(html.includes(`<label>${label}</label>`));
    assert.match(html, new RegExp(`<label>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</label>\\s*<strong>7</strong>`));
  });
}

test("NPC overview defaults a missing Fortify value to zero", async () => {
  const { context } = await setup(null);
  assert.equal(context.ship.fortify, 0);
  const html = render(context);
  assert.match(html, /data-fortify-stat/);
  assert.match(html, /<strong>0<\/strong>/);
});

test("NPC sheet refresh reads the updated Fortify value", async () => {
  const { actor, sheet } = await setup(3);
  const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
  assert.match(render(await buildSheetContext(sheet)), /<strong>3<\/strong>/);
  await actor.update({ [`flags.${M}.starship.fortify`]: 9 });
  const refreshed = await buildSheetContext(sheet);
  assert.equal(refreshed.ship.fortify, 9);
  assert.match(render(refreshed), /<strong>9<\/strong>/);
});

test("player overview does not gain an NPC-only Fortify cell", async () => {
  const { context } = await setup(7, "en", false);
  assert.doesNotMatch(render(context), /data-fortify-stat/);
});
