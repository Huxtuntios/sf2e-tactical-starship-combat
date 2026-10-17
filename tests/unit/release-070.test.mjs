import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const rd = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
import { readdirSync } from "node:fs";
const rdAll = (files, dir) =>
  [
    ...files.map(rd),
    ...(dir
      ? readdirSync(new URL(`../../${dir}`, import.meta.url))
          .filter((f) => /\.(mjs|hbs)$/.test(f))
          .map((f) => rd(`${dir}/${f}`))
      : [])
  ].join("\n");
const ATTACK = () => rdAll(["scripts/chat/attack-card.mjs"], "scripts/chat/attack-card");
const SENSOR = () => rdAll(["scripts/ui/sensor-map-app.mjs"], "scripts/sensor");
const SENSOR_HBS = () =>
  ["templates/sensor-map-bar.hbs", "templates/sensor-map-zones.hbs", "templates/sensor-map-detail.hbs"].map(rd).join("\n");
const SHEET = () => rdAll(["scripts/ui/starship-sheet.mjs"], "scripts/ui/sheet");

test("0.7.0: sheets use MAP buttons, no dropdown", () => {
  for (const p of ["templates/starship-sheet.hbs"]) {
    const s = rd(p);
    assert.ok(!s.includes("data-map-for"), p);
    assert.ok(s.includes('data-map="{{choice}}"'), p);
  }
  assert.ok(!SHEET().includes("select[data-map-for]"));
});

test("0.7.0: attack card uses MAP buttons and passes the choice to sensor-map targeting", () => {
  const s = ATTACK();
  assert.ok(!s.includes("<select data-tsc-map"));
  assert.ok(s.includes("data-tsc-map-choice"));
  assert.match(s, /beginCardTargeting\(message\.id, chosenMap\(\)\)/);
  assert.match(s, /clientResolve\(messageId, key, cardMapChoice\.get\(messageId\) \?\? mapChoice\)/);
});

test("0.7.0: sensor map hover does not re-render (target pick works)", () => {
  const s = SENSOR();
  const line = s.split("\n").find((l) => l.includes('addEventListener("mouseenter"'));
  assert.ok(line && !line.includes("this.render("), line);
  assert.ok(SENSOR_HBS().includes("data-tsc-preview"));
});

test("0.7.0: crew changes refresh ship apps", () => {
  const s = rd("scripts/main.mjs");
  for (const h of ["updateItem", "createItem", "deleteItem", "updateActiveEffect"]) assert.ok(s.includes(`"${h}"`), h);
  assert.ok(SENSOR().includes('"settings", "crew"'));
});

test("0.7.0: attackButtons computes totals with MAP", async () => {
  const { attackButtons } = await import("../../scripts/rolls/ship-rolls.mjs");
  assert.deepEqual(
    attackButtons(9, []).map((b) => b.total),
    ["+9", "+4", "-1"]
  );
  assert.deepEqual(
    attackButtons(9, ["agile"]).map((b) => b.total),
    ["+9", "+5", "+1"]
  );
  assert.equal(attackButtons(null, []).length, 3);
});

test("0.7.0: version", () => {
  const v = JSON.parse(rd("module.json")).version;
  assert.match(v, /^0\.(7|8|9|10|11|12|13|14)\.\d+$/);
  assert.equal(JSON.parse(rd("package.json")).version, v);
});
