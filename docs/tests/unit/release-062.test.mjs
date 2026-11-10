import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildActionItemData, packActionType, SF2E_SCHEMA_VERSION, PACK_FLAG } from "../../scripts/content/action-docs.mjs";
import { buildPlayerShipData, buildShipActorData, buildHazardActorData } from "../../scripts/content/ship-docs.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test("every moduleSetting(...) key used in scripts/ is registered", () => {
  const settings = fs.readFileSync(path.join(root, "scripts/settings.mjs"), "utf8");
  const registered = new Set([...settings.matchAll(/reg\("([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
  const used = new Set();
  for (const f of walk(path.join(root, "scripts")).filter((f) => f.endsWith(".mjs")))
    for (const m of fs.readFileSync(f, "utf8").matchAll(/moduleSetting\("([A-Za-z0-9_]+)"\)/g)) used.add(m[1]);
  const missing = [...used].filter((k) => !registered.has(k));
  assert.deepEqual(missing, []);
  assert.ok(!used.has("sensorOrientation"));
});

test("tracker has no tactical-combat on/off toggle, only the start button", () => {
  const s = fs.readFileSync(path.join(root, "scripts/combat/tracker.mjs"), "utf8");
  assert.ok(!/data-tsc="(on|off)"/.test(s));
  assert.ok(!s.includes("setStarshipCombatEnabled"));
  assert.ok(s.includes('data-tsc="wizard"'));
  const w = fs.readFileSync(path.join(root, "scripts/ui/start-wizard.mjs"), "utf8");
  assert.ok(w.includes("openDashboard()"));
});

test("module-built actors carry the sf2e schema version", () => {
  const frame = {
    id: "f",
    size: "medium",
    sensorRange: 4,
    expansionBays: 2,
    description: "x",
    table: [{ level: 1, hp: 20, sp: 5, ac: 15, fort: 5, ref: 5, will: 5, speed: 3 }]
  };
  for (const d of [
    buildPlayerShipData({ name: "P", frame }),
    buildShipActorData({ id: "s", name: "S", level: 1, hp: 10 }),
    buildHazardActorData({ id: "h", name: "H", level: 1 })
  ])
    assert.equal(d.system._migration.version, SF2E_SCHEMA_VERSION);
});

test("starship action items are valid sf2e actions", () => {
  const { actions } = JSON.parse(fs.readFileSync(path.join(root, "data/actions/station-actions.json"), "utf8"));
  assert.ok(actions.length >= 30);
  for (const a of actions) {
    const it = buildActionItemData(a, { stationName: a.station });
    assert.equal(it.type, "action");
    assert.ok(["action", "reaction", "free"].includes(it.system.actionType.value));
    assert.ok(!it.system.traits.value.includes("station"));
    assert.ok(it.system.description.value.includes(`data-action-id="${a.id}"`));
    assert.equal(it.flags["sf2e-tactical-starship-combat"][PACK_FLAG].actionId, a.id);
    assert.ok(!("stationAction" in it.flags["sf2e-tactical-starship-combat"]));
  }
  assert.deepEqual(packActionType([1, 2]), { actionType: "action", actions: 1 });
  assert.deepEqual(packActionType("reaction"), { actionType: "reaction", actions: null });
  assert.ok(actions.some((a) => a.station === "npc"));
});

test("module.json declares the starship-actions Item pack and it is built", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
  const p = m.packs.find((x) => x.name === "starship-actions");
  assert.equal(p?.type, "Item");
  for (const x of m.packs) assert.ok(fs.existsSync(path.join(root, x.path, "CURRENT")), x.path);
});

test(
  "every pack opens with the real LevelDB reader (classic-level via fvtt-cli) and has unique ids",
  { skip: !fs.existsSync("node_modules/@foundryvtt/foundryvtt-cli") },
  async () => {
    const { extractPack } = await import("@foundryvtt/foundryvtt-cli");
    const os = await import("node:os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tsc-packs-"));
    for (const name of fs.readdirSync("packs")) {
      const out = path.join(tmp, name);
      await extractPack(path.join("packs", name), out, { log: false });
      const ids = fs
        .readdirSync(out, { recursive: true })
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8"))._id);
      assert.ok(ids.length > 0, `${name} is not empty`);
      assert.equal(new Set(ids).size, ids.length, `${name}: duplicate document ids`);
    }
  }
);
