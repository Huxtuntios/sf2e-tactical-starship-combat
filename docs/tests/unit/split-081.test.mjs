import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.foundry ??= { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {} } } };
const { mergeParts } = await import("../../scripts/ui/base-app.mjs");
const SM = await import("../../scripts/ui/sheet/sheet-model.mjs");
const MM = await import("../../scripts/sensor/map-model.mjs");
const AM = await import("../../scripts/chat/attack-card/model.mjs");

const arr = (s) => (s === null ? null : [...s].sort());

test("0.8.1 mergeParts: null (full render) wins, sets are unioned", () => {
  assert.equal(mergeParts(undefined, null), null);
  assert.deepEqual(arr(mergeParts(undefined, ["a"])), ["a"]);
  assert.deepEqual(arr(mergeParts(new Set(["a"]), ["b", "a"])), ["a", "b"]);
  assert.equal(mergeParts(new Set(["a"]), null), null);
  assert.equal(mergeParts(null, ["a"]), null);
});

test("0.8.1 sheet parts plan", () => {
  assert.deepEqual(SM.SHEET_PART_IDS, ["header", "tabs", "body"]);
  assert.deepEqual(SM.sheetPartsFor("tab"), ["tabs", "body"]);
  assert.deepEqual(SM.sheetPartsFor("combat"), ["header", "body"]);
  assert.equal(SM.sheetPartsFor("settings"), null);
  for (const ch of Object.keys(SM.SHEET_PARTS)) for (const p of SM.SHEET_PARTS[ch]) assert.ok(SM.SHEET_PART_IDS.includes(p), `${ch}:${p}`);
});

test("0.8.1 sheet model helpers", () => {
  const rows = SM.tabRows(SM.TABS, "stations", false);
  assert.equal(rows.find((r) => r.id === "stations").active, true);
  assert.equal(rows.find((r) => r.id === "config").visible, false);
  assert.equal(SM.tabRows(SM.NPC_TABS, "overview", true).find((r) => r.id === "config").visible, true);
  const msg = SM.npcIssueText({ code: "badDamage", field: "damage", value: 5 }, "Laser", (k, d) => `${k}|${d.name}|${d.field}|${d.value}`);
  assert.equal(msg, "SF2eTSC.ui.npcIssue.badDamage|Laser|damage|5");
  assert.equal(SM.escHTML(`<b a="1">'&`), "&lt;b a=&quot;1&quot;&gt;&#39;&amp;");
  const el = { dataset: {} };
  assert.equal(SM.wireOnce(el, "Field"), true);
  assert.equal(SM.wireOnce(el, "Field"), false);
  assert.equal(SM.wireOnce(el, "List"), true);
});

test("0.8.1 sensor map parts plan", () => {
  assert.deepEqual(MM.sensorPartsFor("targeting"), ["bar", "zones"]);
  assert.deepEqual(MM.sensorPartsFor("actor"), ["zones", "detail", "dock"]);
  assert.equal(MM.sensorPartsFor("combat"), null);
  assert.deepEqual(MM.PLAYER_SENSOR_OPS, ["move", "shift"]);
  for (const ch of Object.keys(MM.SENSOR_PARTS))
    for (const p of MM.SENSOR_PARTS[ch]) assert.ok(["bar", "zones", "detail", "dock"].includes(p));
});

test("0.8.1 attack card model is pure", () => {
  assert.equal(AM.fmt(3), "+3");
  assert.equal(AM.fmt(-2), "-2");
  assert.equal(AM.canStartResolve({ status: "open" }, false), true);
  assert.equal(AM.canStartResolve({ status: "open" }, true), false);
  assert.equal(AM.canStartResolve({ status: "resolved" }, false), false);
  assert.equal(AM.isCardAttack({ builtin: "strike", targeting: { type: "starship" } }), true);
  assert.equal(AM.isCardAttack({ builtin: "scan" }), false);
});

test("0.8.1 sheet and map use parts, large files are split", () => {
  const sheet = fs.readFileSync("scripts/ui/starship-sheet.mjs", "utf8");
  assert.match(sheet, /header:.*tabs:.*body:/s);
  assert.match(sheet, /partsFor\(channel\)/);
  for (const f of [
    "starship-sheet-header",
    "starship-sheet-tabs",
    "sensor-map-dock",
    "station-hud",
    "sensor-map-bar",
    "sensor-map-zones",
    "sensor-map-detail"
  ]) {
    assert.ok(fs.existsSync(`templates/${f}.hbs`), f);
    assert.ok(fs.readFileSync("scripts/main.mjs", "utf8").includes(`"${f}"`), f);
  }
  assert.ok(!fs.existsSync("templates/sensor-map.hbs"));
  for (const f of ["scripts/ui/starship-sheet.mjs", "scripts/chat/attack-card.mjs", "scripts/ui/sensor-map-app.mjs"]) {
    assert.ok(Buffer.byteLength(fs.readFileSync(f, "utf8"), "utf8") < 40 * 1024, f);
  }
});
