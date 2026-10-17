import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { linkInline } from "../../scripts/content/inline-links.mjs";
import { checkLinksHTML } from "../../scripts/content/inline-checks.mjs";

test("EN damage forms become @Damage with the original text as label", () => {
  assert.equal(linkInline("2d8+7 fire damage"), "@Damage[(2d8+7)[fire]]{2d8+7 fire damage}");
  assert.equal(linkInline("2d6+3 piercing"), "@Damage[(2d6+3)[piercing]]{2d6+3 piercing}");
  assert.equal(linkInline("1d6 persistent acid damage"), "@Damage[1d6[persistent,acid]]{1d6 persistent acid damage}");
});
test("RU damage forms become @Damage", () => {
  assert.match(linkInline("2d10+13 урона огнём"), /^@Damage\[\(2d10\+13\)\[fire\]\]\{2d10\+13 урона огнём\}$/);
  assert.match(linkInline("4d6 колющего урона"), /@Damage\[4d6\[piercing\]\]/);
  assert.match(linkInline("1d6 продолжительного урона огнём"), /@Damage\[1d6\[persistent,fire\]\]/);
  assert.match(linkInline("2d6 колющий"), /@Damage\[2d6\[piercing\]\]/);
  assert.match(linkInline("3d8 ментального урона"), /@Damage\[3d8\[mental\]\]/);
});
test("conditions EN + RU become @TscCondition, false positives stay text", () => {
  assert.equal(linkInline("is frightened 2"), "is @TscCondition[frightened|value:2]{frightened 2}");
  assert.match(linkInline("off-guard"), /@TscCondition\[off-guard\]/);
  assert.match(linkInline("застигнут врасплох"), /@TscCondition\[off-guard\]\{застигнут врасплох\}/);
  assert.match(linkInline("напугано 2"), /@TscCondition\[frightened\|value:2\]/);
  assert.match(linkInline("сбой 3"), /@TscCondition\[glitching\|value:3\]/);
  for (const t of ["Скрытности", "невидимость", "штраф состояния", "the hidden compartment"]) assert.equal(linkInline(t), t);
});
test("linking is idempotent and leaves existing enrichers alone", () => {
  const s = "(@Check[reflex|dc:33|basic]{КС 33}) 2d6 колющего урона и напуган 1";
  const once = linkInline(s);
  assert.equal(linkInline(once), once);
  assert.equal((once.match(/@Damage\[/g) ?? []).length, 1);
});
test("module windows render damage and condition links", () => {
  const h = checkLinksHTML("Takes 2d8 fire damage and is off-guard.");
  assert.match(h, /class="tsc-check tsc-damage" data-inline="@Damage\[2d8\[fire\]\]"/);
  assert.match(h, /class="tsc-cond" data-condition="off-guard"/);
});
test(
  "packs contain damage and condition links",
  { skip: fs.existsSync("packs-src") ? false : "packs-src/ not present (release build)" },
  () => {
    const all = fs
      .readdirSync("packs-src", { recursive: true })
      .filter((f) => String(f).endsWith(".json"))
      .map((f) => fs.readFileSync(`packs-src/${f}`, "utf8"))
      .join("\n");
    assert.match(all, /@Damage\[/);
    assert.match(all, /@TscCondition\[/);
  }
);
