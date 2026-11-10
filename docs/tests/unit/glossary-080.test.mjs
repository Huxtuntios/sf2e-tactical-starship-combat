import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const glossary = read("../../lang/content/glossary.json");
const ui = read("../../lang/ru.json").SF2eTSC;

for (const section of ["grades", "damageTypes", "traits"]) {
  test(`glossary ${section} match the interface translation`, () => {
    for (const [key, value] of Object.entries(glossary[section])) {
      const uiValue = ui[section]?.[key];
      if (uiValue === undefined) continue;
      assert.equal(uiValue.toLowerCase(), value.toLowerCase(), `${section}.${key}`);
    }
  });
}

test("glossary covers every station grade and has no Latin letters", () => {
  for (const g of ["commercial", "tactical", "advanced", "superior", "elite", "ultimate", "paragon"]) assert.ok(glossary.grades[g], g);
  for (const [section, map] of Object.entries(glossary)) {
    if (section.startsWith("_")) continue;
    for (const [k, v] of Object.entries(map)) assert.ok(!/[A-Za-z]/.test(v), `${section}.${k}: ${v}`);
  }
});
