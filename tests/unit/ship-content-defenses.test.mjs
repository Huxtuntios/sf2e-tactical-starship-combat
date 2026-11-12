import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { STARSHIP_IMMUNITIES } from "../../scripts/engine/validation.mjs";
import { buildShipActorData, starshipFlagFromContent } from "../../scripts/content/ship-docs.mjs";
import { planStarshipUpdate } from "../../scripts/content/ship-update.mjs";
import { applyDamageInDraft } from "../../scripts/damage/damage-service.mjs";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";

const read = (file) => JSON.parse(readFileSync(new URL(`../../data/${file}`, import.meta.url), "utf8"));
const ships = read("index.json").starships.flatMap((file) => read(file).ships);
const without = (...types) => STARSHIP_IMMUNITIES.filter((type) => !types.includes(type));
const resistanceCases = {
  "": {},
  "bludgeoning 3": { bludgeoning: 3 },
  "cold 2": { cold: 2 },
  "cold 5, fire 5": { cold: 5, fire: 5 },
  "fire 10, piercing 10": { fire: 10, piercing: 10 },
  "fire 11": { fire: 11 },
  "fire 16": { fire: 16 },
  "fire 2": { fire: 2 },
  "fire 4": { fire: 4 },
  "fire 5": { fire: 5 },
  "piercing 2, slashing 2": { piercing: 2, slashing: 2 },
  "piercing 4": { piercing: 4 }
};
const weaknessCases = { "": {}, "fire 10": { fire: 10 }, "fire 20": { fire: 20 }, "fire 3": { fire: 3 }, "fire 6": { fire: 6 } };
const immunityCases = {
  "": [...STARSHIP_IMMUNITIES],
  "bleed, death effects, disease, drained, fatigued, paralyzed, poison, sickened": [
    "bleed",
    "death-effects",
    "disease",
    "drained",
    "fatigued",
    "paralyzed",
    "poison",
    "sickened"
  ],
  "cold, electricity": ["cold", "electricity"],
  "drained, paralyzed, sleep": ["drained", "paralyzed", "sleep"],
  "glitching, starship immunities (except poison and void)": ["glitching", ...without("poison", "void")],
  "mental, starship immunities": ["mental", ...STARSHIP_IMMUNITIES],
  "starship immunities": [...STARSHIP_IMMUNITIES],
  "starship immunities (except poison and void)": without("poison", "void"),
  "starship immunities (except spirit, vitality, void)": without("spirit", "vitality", "void")
};

test("every shipped defense string builds canonical module data without changing content", () => {
  const original = structuredClone(ships);
  for (const ship of ships) {
    const flag = starshipFlagFromContent(ship);
    assert.deepEqual(flag.resistances, resistanceCases[ship.resistances ?? ""], ship.id);
    assert.deepEqual(flag.weaknesses, weaknessCases[ship.weaknesses ?? ""], ship.id);
    assert.deepEqual(flag.immunities, immunityCases[ship.immunities ?? ""], ship.id);
  }
  for (const [field, cases] of Object.entries({ resistances: resistanceCases, weaknesses: weaknessCases, immunities: immunityCases }))
    assert.deepEqual([...new Set(ships.map((ship) => ship[field] ?? ""))].sort(), Object.keys(cases).sort(), field);
  assert.deepEqual(ships, original);
});

test("empty immunity sources retain the baseline; known aliases and duplicate values normalize", () => {
  for (const immunities of [undefined, null, "", "  "])
    assert.deepEqual(starshipFlagFromContent({ immunities }).immunities, STARSHIP_IMMUNITIES);
  assert.deepEqual(starshipFlagFromContent({ immunities: "Cold, Electric, death effects, cold" }).immunities, [
    "cold",
    "electricity",
    "death-effects"
  ]);
  assert.deepEqual(starshipFlagFromContent({ resistances: "fire 10, fire 5" }).resistances, { fire: 10 });
});

test("unknown or qualified prose is not turned into defenses or blanket immunities", () => {
  for (const text of [
    "fire 5 while shields are active",
    "cold 2 (except magical)",
    "fire 5 except cold, piercing 2",
    "mystery 10, fire 5",
    "fire 2 (except cold, electricity)",
    "mystery 10",
    "fire -2",
    "fire 0"
  ])
    for (const field of ["resistances", "weaknesses"]) assert.deepEqual(starshipFlagFromContent({ [field]: text })[field], {}, text);
  for (const immunities of [
    "immune to cold and electricity",
    "cold (except magical)",
    "starship immunities except poison",
    "starship immunities (except mystery)",
    "starship immunities (except poison and void while shielded)",
    "starship immunities (except fire)",
    "starship immunities (except poison, void",
    "starship immunities (except poison, (void))",
    "unknown prose"
  ])
    assert.deepEqual(starshipFlagFromContent({ immunities }).immunities, [], immunities);
});

async function damageShip(source, damageType, amount = 5, traits = []) {
  const actor = buildShipActorData(source);
  const original = structuredClone(actor);
  const data = { ...structuredClone(actor.flags[MODULE_ID].starship), hp: structuredClone(actor.system.attributes.hp) };
  const result = await applyDamageInDraft(
    { ship: async () => ({ actor, data }), log() {}, event() {}, afterCommit() {} },
    "Actor.test-defense",
    { amount, damageType, traits, silent: true }
  );
  assert.deepEqual(actor, original, "damage changes only the test draft, not the source actor");
  return result;
}

test("real Burning Nail fire damage 5 becomes 3; cold and dual resistances reach the damage service", async () => {
  installFoundryMock();
  const nail = ships.find((ship) => ship.id === "infernex-burning-nail");
  assert.equal(nail.resistances, "fire 2");
  const result = await damageShip(nail, "fire");
  assert.equal(result.resistanceReduction, 2);
  assert.equal(result.mitigatedDamage, 3);
  assert.equal(result.hullDamage, 3);
  for (const text of ["cold 2", "cold 5, fire 5", "piercing 2, slashing 2", "fire 10, piercing 10"]) {
    const ship = ships.find((entry) => entry.resistances === text);
    for (const [type, value] of Object.entries(resistanceCases[text])) {
      const damage = await damageShip(ship, type, 20);
      assert.equal(damage.resistanceReduction, value, `${ship.id}/${type}`);
      assert.equal(damage.mitigatedDamage, 20 - value);
    }
  }
});

test("Xenowarden fire weaknesses increase damage even when immunity source is missing", async () => {
  installFoundryMock();
  for (const ship of ships.filter((entry) => entry.weaknesses)) {
    assert.equal(ship.faction, "Xenowardens");
    const result = await damageShip(ship, "fire");
    const weakness = weaknessCases[ship.weaknesses].fire;
    assert.equal(result.weaknessIncrease, weakness, ship.id);
    assert.equal(result.mitigatedDamage, 5 + weakness);
  }
});

test("listed exceptions and explicit immunity lists remain effective without a blanket NPC baseline", async () => {
  installFoundryMock();
  for (const [text, excluded] of [
    ["starship immunities (except poison and void)", ["poison", "void"]],
    ["glitching, starship immunities (except poison and void)", ["poison", "void"]],
    ["starship immunities (except spirit, vitality, void)", ["spirit", "vitality", "void"]],
    ["bleed, death effects, disease, drained, fatigued, paralyzed, poison, sickened", ["spirit", "vitality", "void"]],
    ["cold, electricity", ["poison", "void", "spirit"]],
    ["drained, paralyzed, sleep", ["poison", "void", "spirit"]]
  ]) {
    const ship = ships.find((entry) => entry.immunities === text);
    for (const type of excluded) assert.equal((await damageShip(ship, type)).immune, false, `${ship.id}/${type}`);
    for (const type of immunityCases[text]) {
      const result = await damageShip(ship, "fire", 5, [type]);
      assert.equal(result.immune, true, `${ship.id}/${type}`);
      assert.equal(result.mitigatedDamage, 0);
    }
  }
  assert.equal(
    (
      await damageShip(
        ships.find((ship) => ship.immunities === "starship immunities"),
        "void"
      )
    ).immune,
    true
  );
});

test("builder keeps source defense notes; explicit compendium update adopts fresh defenses without mutating snapshots", () => {
  const source = ships.find((ship) => ship.id === "infernex-burning-nail");
  const originalSource = structuredClone(source);
  const fresh = buildShipActorData(source);
  assert.ok(fresh.system.details.publicNotes.includes(source.resistances));
  assert.ok(fresh.system.details.publicNotes.includes(source.immunities));
  const actor = {
    name: fresh.name,
    hp: { value: source.hp - 3, max: source.hp },
    flag: {
      ...structuredClone(fresh.flags[MODULE_ID].starship),
      resistances: {},
      crew: [{ actorUuid: "Actor.crew", stationId: null }],
      gmNotes: "Keep me"
    }
  };
  const originalActor = structuredClone(actor);
  const originalFresh = structuredClone(fresh);
  const update = planStarshipUpdate(actor, fresh, { moduleId: MODULE_ID });
  assert.deepEqual(update[`flags.${MODULE_ID}.starship`].resistances, { fire: 2 });
  assert.deepEqual(update[`flags.${MODULE_ID}.starship`].crew, actor.flag.crew);
  assert.equal(update[`flags.${MODULE_ID}.starship`].gmNotes, "Keep me");
  assert.equal(update["system.attributes.hp.value"], source.hp - 3);
  assert.deepEqual(actor, originalActor);
  assert.deepEqual(fresh, originalFresh);
  assert.deepEqual(source, originalSource);
});
