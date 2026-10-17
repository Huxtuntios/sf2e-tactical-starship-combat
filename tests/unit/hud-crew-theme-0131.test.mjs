import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk } from "../helpers/foundry-mock.mjs";
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
test("0.13.1 Station HUD theme picker is inside the only root in empty and populated templates", () => {
  const h = Handlebars.create();
  h.registerHelper("localize", (k) => k);
  h.registerPartial("tscOccupant", "<span>Operator</span>");
  const render = h.compile(read("templates/station-hud.hbs"));
  for (const none of [true, false]) {
    const html = render({
      none,
      actions: [{ id: "a", name: "Action", enabled: true }],
      sheetThemes: [{ id: "light", label: "Light" }]
    }).trim();
    assert.match(html, /^<section class="tsc-hud-root">\s*<label/);
    assert.ok(html.endsWith("</section>"));
    assert.equal((html.match(/<section\b/g) ?? []).length, 1);
    assert.equal((html.match(/data-sheet-theme-select/g) ?? []).length, 1);
  }
});
test("0.13.1 Crew Manager exposes the shared client theme and listens for local theme changes", async () => {
  const { settings } = installFoundryMock();
  await loadContentFromDisk();
  settings.set("starshipSheetTheme", "light");
  const { CrewManager } = await import("../../scripts/ui/crew-manager.mjs");
  const app = new CrewManager();
  const context = await app._prepareContext();
  assert.ok(CrewManager.DEFAULT_OPTIONS.classes.includes("tsc-crew-manager"));
  assert.ok(app.channels.includes("sheetTheme"));
  assert.deepEqual(
    context.sheetThemes.map((o) => [o.id, o.selected]),
    [
      ["dark", false],
      ["light", true]
    ]
  );
  assert.match(read("scripts/ui/crew-manager.mjs"), /wireSheetTheme\(this\)/);
  assert.match(read("styles/main.css"), /tsc-crew-manager\[data-sheet-theme="?light"?\]/);
});
test("0.13.1 Crew Manager keeps its selector inside the single root for empty and populated panels", () => {
  const h = Handlebars.create();
  h.registerHelper("localize", (k) => k);
  h.registerHelper("eq", (a, b) => a === b);
  h.registerPartial("tscOccupant", "<span>Operator</span>");
  h.registerPartial("modules/sf2e-tactical-starship-combat/templates/crew-ship.hbs", read("templates/crew-ship.hbs"));
  const render = h.compile(read("templates/crew-panel.hbs"));
  for (const empty of [true, false]) {
    const html = render({
      empty,
      ships: empty ? [] : [{ name: "Ship", rows: [{ player: "Player", canChange: true }] }],
      sheetThemes: [{ id: "dark", label: "Dark" }]
    }).trim();
    assert.match(html, /^<section class="tsc-crew-root">\s*<label/);
    assert.ok(html.endsWith("</section>"));
    assert.equal((html.match(/<section\b/g) ?? []).length, 1);
    assert.equal((html.match(/data-sheet-theme-select/g) ?? []).length, 1);
  }
});
