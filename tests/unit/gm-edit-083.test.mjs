import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { statusPatches, clampPool, gmEditRequests } from "../../scripts/sensor/gm-edit.mjs";

function statusOf(d) {
  if (d.destroyed) return "destroyed";
  if (d.compromised > 0) return "compromised";
  if (d.inoperable) return "inoperable";
  if (d.wrecked > 0) return "wrecked";
  if (d.offKilter) return "off-kilter";
  return "operational";
}
// mirrors the patchShip handler: keys applied, then compromised === 0 clears inoperable
function apply(d, patch) {
  Object.assign(d, patch);
  if (patch.compromised === 0) d.inoperable = false;
  return d;
}

test("0.8.3 status patches produce the chosen status from any state", () => {
  const states = ["operational", "off-kilter", "compromised", "inoperable", "wrecked", "destroyed"];
  for (const from of states)
    for (const to of states) {
      let d = { destroyed: false, compromised: 0, inoperable: false, wrecked: 0, offKilter: false };
      for (const p of statusPatches(from)) d = apply(d, p);
      for (const p of statusPatches(to)) d = apply(d, p);
      assert.equal(statusOf(d), to, `${from} -> ${to}`);
    }
  assert.deepEqual(statusPatches("nope"), []);
});

test("0.8.3 GM edit requests", () => {
  assert.equal(clampPool("50", 40), 40);
  assert.equal(clampPool(-3, 40), 0);
  assert.equal(clampPool("x", 40), null);
  assert.deepEqual(gmEditRequests({ field: "hp", value: "25", shipUuid: "A", max: "40" }), [
    { name: "patchShip", payload: { shipUuid: "A", patch: { hp: { value: 25 } } } }
  ]);
  assert.deepEqual(gmEditRequests({ field: "sp", value: "99", shipUuid: "A", max: "10" })[0].payload.patch, { sp: { value: 10 } });
  assert.deepEqual(gmEditRequests({ field: "heading", value: "left", current: "right", key: "K", combatId: "C" }), [
    { name: "sensorUpdate", payload: { op: "flip", combatId: "C", key: "K" } }
  ]);
  assert.deepEqual(gmEditRequests({ field: "heading", value: "left", current: "left" }), []);
  assert.equal(gmEditRequests({ field: "status", value: "inoperable", shipUuid: "A" }).length, 2);
});

test("0.8.3 sheet listeners no longer call wirePackDrop without the sheet", () => {
  assert.doesNotMatch(fs.readFileSync("scripts/ui/sheet/sheet-listeners.mjs", "utf8"), /wirePackDrop\(this\)/);
  assert.match(fs.readFileSync("scripts/ui/starship-sheet.mjs", "utf8"), /wirePackDrop\(this\)/);
  for (const f of fs.readdirSync("scripts/ui/sheet")) {
    const s = fs.readFileSync(`scripts/ui/sheet/${f}`, "utf8").replace(/fn\.apply\(this, a\)/g, "");
    // plain exported helpers must not use `this`; only sheet-actions.mjs (called with this = sheet) may
    if (f !== "sheet-actions.mjs") assert.doesNotMatch(s, /\bthis\b/, f);
  }
  assert.match(fs.readFileSync("templates/sensor-map-detail.hbs", "utf8"), /data-gm-ship="status"/);
});
