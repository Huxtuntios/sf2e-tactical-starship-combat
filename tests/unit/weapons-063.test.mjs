import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWeaponItemData, splitWeaponTraits, weaponEntry, parseDie, SYSTEM_WEAPON_TRAITS } from "../../scripts/content/weapon-docs.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const weapons = JSON.parse(fs.readFileSync(path.join(root, "data/equipment/weapons.json"), "utf8")).weapons;

test("weapon traits split into system slugs and starship-only traits", () => {
  const r = splitWeaponTraits(["tech", "area (cone)", "ordinance", "Agile"]);
  assert.deepEqual(r.system, ["tech", "agile"]);
  assert.deepEqual(r.other, ["area (cone)", "ordnance"]);
});

test("every pack weapon is a valid sf2e weapon item with system traits only", () => {
  for (const w of weapons) {
    const d = buildWeaponItemData(w);
    assert.equal(d.type, "weapon");
    assert.ok(
      d.system.traits.value.every((t) => SYSTEM_WEAPON_TRAITS.has(t)),
      w.id
    );
    assert.ok(d.system._migration.version >= 0.959);
    assert.equal(d.flags["sf2e-tactical-starship-combat"].packWeapon.weaponRef, w.id);
    assert.match(d.system.damage.die, /^d\d+$/);
  }
});

test("ship weapon entry keeps catalogue data", () => {
  const e = weaponEntry(weapons[0], "wpn-1");
  assert.equal(e.weaponRef, weapons[0].id);
  assert.equal(e.id, "wpn-1");
  assert.equal(e.stationId, null);
  assert.deepEqual(parseDie("2d10"), { dice: 2, die: "d10" });
});

test("starship-weapons pack declared and built", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
  assert.ok(m.packs.some((p) => p.name === "starship-weapons" && p.type === "Item"));
  assert.ok(m.packFolders[0].packs.includes("starship-weapons"));
  assert.ok(fs.existsSync(path.join(root, "packs/starship-weapons/CURRENT")));
});

test("drop is intercepted and sheet wires the listener", () => {
  const src = fs.readFileSync(path.join(root, "scripts/starship/pack-drop.mjs"), "utf8");
  assert.ok(src.includes('Hooks.on("preCreateItem"') && src.includes("return false"));
  assert.ok(fs.readFileSync(path.join(root, "scripts/ui/starship-sheet.mjs"), "utf8").includes("wirePackDrop(this)"));
  assert.ok(fs.readFileSync(path.join(root, "scripts/main.mjs"), "utf8").includes("registerPackDrop()"));
});
