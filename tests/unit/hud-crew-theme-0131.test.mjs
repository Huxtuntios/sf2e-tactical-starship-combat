import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
const read = (p) => fs.readFileSync(p, "utf8");
test("HUD, Crew, sheet and map appearance do not expose competing theme controls", () => {
  for (const p of ["templates/station-hud.hbs", "templates/crew-panel.hbs", "templates/starship-sheet-header.hbs"])
    assert.doesNotMatch(read(p), /data-sheet-theme-select/);
  assert.doesNotMatch(read("templates/map-appearance.hbs"), /name="theme"/);
  const h = Handlebars.create();
  h.registerHelper("localize", (k) => k);
  h.registerHelper("eq", (a, b) => a === b);
  h.registerPartial("tscOccupant", "<span>Operator</span>");
  h.registerPartial("modules/sf2e-tactical-starship-combat/templates/crew-ship.hbs", read("templates/crew-ship.hbs"));
  for (const [template, ctx] of [
    ["station-hud", { none: true }],
    ["crew-panel", { empty: true }]
  ]) {
    const html = h
      .compile(read(`templates/${template}.hbs`))(ctx)
      .trim();
    assert.match(html, /^<section/);
    assert.ok(html.endsWith("</section>"));
  }
});
