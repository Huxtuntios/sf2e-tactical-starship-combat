import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = ["scripts/ui/sensor-map-app.mjs", "scripts/sensor/map-model.mjs", "scripts/sensor/map-handlers.mjs"]
  .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
  .join("\n");
const hbs = ["bar", "zones", "detail"].map((p) => fs.readFileSync(path.join(root, `templates/sensor-map-${p}.hbs`), "utf8")).join("\n");
const css = fs.readFileSync(path.join(root, "styles/main.css"), "utf8");

test("sensor map: drag and drop + player move permissions", () => {
  assert.ok(src.includes("#wireDragDrop") && src.includes("dragstart") && src.includes('"drop"'));
  assert.ok(src.includes('export const PLAYER_SENSOR_OPS = ["move", "shift"]'));
  assert.ok(/case "move":/.test(src));
  assert.ok(src.includes("canMoveKey(user, getTsc(combat), payload.key)"));
  assert.ok(hbs.includes("detail.canMove"));
});

test("sensor map keeps scroll position", () => {
  assert.ok(src.includes("_preRender") && src.includes("#restoreScroll"));
});

test("vertical orientation is gone", () => {
  assert.ok(!src.includes("toggleOrientation"));
  assert.ok(!hbs.includes("toggleOrientation"));
  assert.ok(!css.includes('[data-orientation="vertical"]'));
  const wiz = fs.readFileSync(path.join(root, "templates/start-wizard.hbs"), "utf8");
  assert.ok(!wiz.includes('name="orientation"'));
});
