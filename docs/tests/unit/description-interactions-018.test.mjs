import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { upgradeEntries } from "../../scripts/engine/upgrades.mjs";
import { upgradeDescriptionHTML } from "../../scripts/content/upgrade-docs.mjs";
import { linkInline } from "../../scripts/content/inline-links.mjs";
import { checkLinksHTML, safeInlineDamage } from "../../scripts/content/inline-checks.mjs";
import { safeDiceFormula } from "../../scripts/content/inline-dice.mjs";

const defs = JSON.parse(fs.readFileSync("data/equipment/upgrades.json")).upgrades;
const entries = upgradeEntries(defs);
const ru = JSON.parse(fs.readFileSync("lang/content/ru.json")).strings;
const tr = (s) => ru[s] ?? s;
const pick = (ref, variant) => entries.find((e) => e.ref === ref && e.variant === variant);

test("all four ramming prow grades inherit their source type in EN and RU, including compendium view", () => {
  for (const [grade, die] of [
    ["tactical", "4d8"],
    ["advanced", "6d8"],
    ["superior", "8d8"],
    ["elite", "10d8"]
  ])
    for (const translate of [(s) => s, tr]) {
      const e = pick("ramming-prow", grade),
        before = JSON.stringify(e);
      const html = upgradeDescriptionHTML(e, { tr: translate });
      assert.equal((html.match(new RegExp(`@Damage\\[${die}\\[bludgeoning\\]\\]`, "g")) ?? []).length, 2);
      assert.ok(!html.includes("@Damage[2d8[bludgeoning]]"));
      assert.equal(JSON.stringify(e), before);
      assert.equal(upgradeDescriptionHTML(e, { tr: translate }), html);
    }
});
test("nova variant offers two distinct attunement types, not merged damage", () => {
  for (const [grade, die] of [
    ["tactical", "4d8"],
    ["advanced", "6d8"],
    ["superior", "8d8"],
    ["elite", "10d8"]
  ])
    for (const translate of [(s) => s, tr]) {
      const html = upgradeDescriptionHTML(pick("nova-prow", grade), { tr: translate });
      assert.equal((html.match(new RegExp(`@Damage\\[${die}\\[fire\\]\\]`, "g")) ?? []).length, 2);
      assert.equal((html.match(new RegExp(`@Damage\\[${die}\\[bludgeoning\\]\\]`, "g")) ?? []).length, 2);
      assert.ok(!html.includes("@Damage[2d8["));
    }
});
test("missing or changed action data and custom overrides do not invent inherited type", () => {
  for (const changes of [{ custom: true }, { activations: [] }, { variantText: ["Deals 8d8 damage and 2d6 damage."] }]) {
    const e = { ...pick("ramming-prow", "superior"), ...changes };
    const html = upgradeDescriptionHTML(e);
    assert.doesNotMatch(html, /@Damage\[8d8\[bludgeoning\]\]/);
  }
});
test("single explicit structured component carries type and modifier, replacement reference is not an extra roll", () => {
  const options = { sourceDamageParts: [{ id: "a", formula: "2d8", type: "fire" }] };
  const result = linkInline("8d8 + 4 damage instead of 2d8 damage", options);
  assert.equal(result, "@Damage[(8d8+4)[fire]]{8d8 + 4 damage} instead of 2d8 damage");
  assert.equal(linkInline(result, options), result);
  assert.match(linkInline("8d8 урона", options), /@Damage\[8d8\[fire\]\]/);
});
test("explicit type wins; ambiguous and extra damage never gain guessed type", () => {
  const options = {
    sourceDamageParts: [
      { id: "a", type: "fire" },
      { id: "b", type: "electricity" }
    ]
  };
  assert.equal(linkInline("8d8 damage", options), "8d8 damage");
  assert.match(linkInline("8d8 damage", { ...options, componentId: "b" }), /@Damage\[8d8\[electricity\]\]/);
  assert.equal(linkInline("8d8 damage", { sourceDamageParts: [{ type: "untyped" }] }), "8d8 damage");
  assert.match(linkInline("8d8 electricity damage", { sourceDamageParts: [{ type: "fire" }] }), /@Damage\[8d8\[electricity\]\]/);
  assert.equal(linkInline("additional 2d6 damage", { sourceDamageParts: [{ type: "fire" }] }), "additional 2d6 damage");
  assert.equal(linkInline("8d8 damage and 1d6 damage", { sourceDamageParts: [{ type: "fire" }] }), "8d8 damage and 1d6 damage");
  assert.match(checkLinksHTML("8d8 damage", { sourceDamageParts: [{ type: "fire" }] }), /data-inline="@Damage\[8d8\[fire\]\]"/);
  const both = linkInline("2d8 fire damage and 1d6 electricity damage");
  assert.match(both, /@Damage\[2d8\[fire\]\]/);
  assert.match(both, /@Damage\[1d6\[electricity\]\]/);
});
test("explicit checks, conditions and native enrichers do not corrupt adjacent links", () => {
  const html = checkLinksHTML(
    "@Check[will|dc:20]{Will} and DC 15 Reflex save; frightened 2; @UUID[Compendium.sf2e.conditions.Item.abc]{Dazzled}"
  );
  assert.equal((html.match(/data-check=/g) ?? []).length, 2);
  assert.match(html, /data-condition="frightened" data-value="2"/);
  assert.match(html, /data-tsc-native="@UUID/);
  assert.equal((html.match(/data-condition="dazzled"/g) ?? []).length, 0);
  const original = '<a href="/foo">2d8 fire damage and frightened 2</a>';
  assert.equal(linkInline(original), original);
});
test("safe dice and damage enforce bounds and reject executable and unknown expressions", () => {
  assert.equal(safeDiceFormula("3d8 + 4"), "3d8+4");
  for (const invalid of ["0d8", "999d8", "2d9999", "1d8+@actor.level", "1d8;alert(1)", "1d8/2"])
    assert.equal(safeDiceFormula(invalid), null);
  assert.equal(safeInlineDamage("@Damage[(3d8+4)[fire]]"), "@Damage[(3d8+4)[fire]]");
  for (const invalid of ["@Damage[999d8[fire]]", "@Damage[2d6[unknown]]", "@Damage[2d6[fire]|options:foo]"])
    assert.equal(safeInlineDamage(invalid), null);
  assert.doesNotMatch(checkLinksHTML("[[/r 1d8+@actor.level]]"), /data-dice/);
  assert.doesNotMatch(checkLinksHTML("@Damage[999d8[fire]]"), /data-inline/);
});
test("non-damage shield and travel dice link only the explicit base roll and not advancement increments", () => {
  for (const translate of [(s) => s, tr]) {
    const shield = upgradeDescriptionHTML(pick("solar-generator-crystal", null), { tr: translate, render: checkLinksHTML });
    assert.equal((shield.match(/data-dice="1d8"/g) ?? []).length, 1);
    const travel = upgradeDescriptionHTML(pick("telepod", null), { tr: translate, render: checkLinksHTML });
    assert.equal((travel.match(/data-dice="1d4"/g) ?? []).length, 1);
  }
});

test("Russian explicit DC checks and the operator solarian class DC link correctly", async () => {
  const { linkContextDCs } = await import("../../scripts/rolls/context-dc.mjs");
  assert.match(linkInline("КС 15 простой спасбросок Рефлекса"), /@Check\[reflex\|dc:15\|basic\]/);
  assert.match(linkInline("КС 17 проверка Ремесла"), /@Check\[crafting\|dc:17\]/);
  assert.match(linkInline("КС 5 плоская проверка"), /@Check\[flat\|dc:5\]/);
  const text = "простой спасбросок Стойкости против вашего КС класса соляриана";
  const crew = { skills: {}, classDCs: { solarian: { dc: { value: 22 } } } };
  assert.match(linkContextDCs(text, { crew }), /@Check\[fortitude\|dc:22\|basic\]/);
  assert.equal(linkContextDCs(text, {}), text);
});

test("Thasteron Burst variants show their final explicitly typed dice in both action and variant", () => {
  for (const [grade, dice] of [
    ["tactical", "2d12"],
    ["advanced", "3d12"],
    ["superior", "8d12"],
    ["elite", "10d12"],
    ["ultimate", "12d12"],
    ["paragon", "14d12"]
  ]) {
    for (const translate of [(s) => s, tr]) {
      const html = upgradeDescriptionHTML(pick("thasteron-afterburner", grade), { tr: translate });
      assert.equal((html.match(new RegExp(`@Damage\\[${dice}\\[fire\\]\\]`, "g")) ?? []).length, 2);
      assert.ok(!html.includes("@Damage[1d12[fire]]"));
    }
  }
});
