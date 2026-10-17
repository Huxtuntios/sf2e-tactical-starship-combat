import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildHazardActorData } from "../../scripts/content/ship-docs.mjs";

function walk(d) {
  return fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".mjs") ? [path.join(d, e.name)] : []));
}

test("0.8.4 no deprecated global FormDataExtended", () => {
  for (const f of walk("scripts"))
    assert.doesNotMatch(fs.readFileSync(f, "utf8").replace(/foundry\.applications\.ux\.FormDataExtended/g, ""), /FormDataExtended/, f);
});

test("0.8.4 hazard level in name and compendium browser fields", () => {
  const h = {
    id: "slime",
    name: "Slime Infestation",
    level: 3,
    traits: ["Environmental", "starship"],
    rarity: "common",
    source: { book: "Starfinder Tech Core", page: 250 }
  };
  const d = buildHazardActorData(h, { levelInName: true });
  assert.equal(d.name, "Slime Infestation (Lv 3)");
  assert.equal(buildHazardActorData(h).name, "Slime Infestation");
  assert.equal(buildHazardActorData(h, { levelInName: true, i18n: { levelShort: "ур." } }).name, "Slime Infestation (ур. 3)");
  assert.deepEqual(d.system.traits, { value: ["environmental", "starship"], rarity: "common" });
  assert.equal(d.system.details.publication.title, "Starfinder Tech Core");
  assert.equal(d.system.details.level.value, 3);
  assert.equal(d.system.details.isComplex, false);
  assert.equal(d.prototypeToken.name, "Slime Infestation");
});

test("0.8.4 crew drop listener is guarded per element, not per sheet", () => {
  const s = fs.readFileSync("scripts/ui/sheet/sheet-listeners.mjs", "utf8");
  assert.doesNotMatch(s, /_tscRootListeners/);
  assert.match(s, /el\.dataset\.tscCrewDrop/);
  assert.match(s, /Crew\.add\(sheet\.document\.uuid/);
});
