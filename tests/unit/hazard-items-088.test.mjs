import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHazardActorData, hazardAbilityHTML, parseStrikeDamage, hazardCost } from "../../scripts/content/ship-docs.mjs";

const raw = JSON.parse(readFileSync(new URL("../../data/hazards/hazards.json", import.meta.url), "utf8"));
const hazards = Array.isArray(raw) ? raw : raw.hazards;
const MARK = /\[(reaction|one-action|two-actions|three-actions|free-action|passive)\]/;

test("hazard abilities and strikes are embedded items, not description text", () => {
  const iv = buildHazardActorData(hazards.find((h) => h.id === "infernal-vice"));
  const desc = iv.system.details.description;
  assert.ok(!desc.includes("Infernal Grasp") && !desc.includes("infernal chain") && !MARK.test(desc));
  assert.equal(iv.items.length, 5);
  const by = Object.fromEntries(iv.items.map((i) => [i.system.slug, i]));
  assert.equal(by["infernal-grasp"].type, "action");
  assert.equal(by["infernal-grasp"].system.actionType.value, "reaction");
  assert.match(
    by["infernal-grasp"].system.description.value,
    /^<p><strong>Trigger<\/strong> A starship enters the trap’s zone<\/p><hr \/><p><strong>Effect<\/strong> The trap makes/
  );
  assert.equal(by["chain-wrap"].system.actionType.value, "passive");
  assert.equal(by["heat-up"].system.actions.value, 1);
  assert.deepEqual(by["heat-up"].system.traits.value, ["starship", "divine", "fire", "unholy"]);
  assert.ok(by["heat-up"].system.description.value.includes("@Damage[2d8[fire]]"));
  assert.ok(by["heat-up"].system.description.value.includes("@Check[fortitude|dc:22|basic]"));
  assert.ok(by["hell-s-hush"].system.description.value.includes("@Check[will|dc:22]"));
  const s = by["infernal-chain"];
  assert.equal(s.type, "melee");
  assert.equal(s.name, "Infernal chain");
  assert.equal(s.system.bonus.value, 15);
  assert.deepEqual(Object.values(s.system.damageRolls), [{ damage: "2d8+7", damageType: "piercing", category: null }]);
  assert.deepEqual(s.system.attackEffects.value, ["chain-wrap"]);
  assert.ok(s.system.description.value.includes("range 4 zones"));
  assert.ok(iv.items.every((i) => !i.img.includes("undefined")));
});

test("every hazard: no ability markers left in the description, one item per ability and strike", () => {
  for (const h of hazards) {
    const d = buildHazardActorData(h);
    assert.ok(!MARK.test(d.system.details.description), h.id);
    assert.equal(d.items.length, (h.actions ?? []).length + (h.strikes ?? []).length, h.id);
    for (const i of d.items) if (i.type === "melee") assert.ok(Object.keys(i.system.damageRolls).length > 0, `${h.id} ${i.name}`);
  }
});

test("degrees of success and Russian markers are formatted like sf2e items", () => {
  const en = hazardAbilityHTML(
    "Effect Boom, DC 18 Will save. Critical Success Fine. Success Frightened 1. Failure Takes 3d8 mental damage. Critical Failure Worse."
  );
  assert.equal(
    en,
    "<p><strong>Effect</strong> Boom, @Check[will|dc:18]{Will save}.</p><hr /><p><strong>Critical Success</strong> Fine.</p><p><strong>Success</strong> @TscCondition[frightened|value:1]{Frightened 1}.</p><p><strong>Failure</strong> Takes @Damage[3d8[mental]]{3d8 mental damage}.</p><p><strong>Critical Failure</strong> Worse.</p>"
  );
  const ru = { trigger: "Триггер", effect: "Эффект" };
  assert.equal(
    hazardAbilityHTML("Триггер Звездолёт входит в зону; Эффект Удар.", (k) => ru[k]),
    "<p><strong>Триггер</strong> Звездолёт входит в зону</p><hr /><p><strong>Эффект</strong> Удар.</p>"
  );
  assert.deepEqual(
    parseStrikeDamage("2d6+5 electricity plus 1d6 fire").rolls.map((r) => r.damageType),
    ["electricity", "fire"]
  );
  assert.deepEqual(hazardCost("two-actions"), { actionType: "action", actions: 2 });
  assert.deepEqual(hazardCost("free-action"), { actionType: "free", actions: null });
});
