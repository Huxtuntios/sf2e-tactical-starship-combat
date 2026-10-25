import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  installFoundryMock,
  loadContentFromDisk,
  makeShip,
  makeCharacter,
  makeStarshipCombat,
  MockActor
} from "../helpers/foundry-mock.mjs";
import { nativeSystemId, modulePackId, systemSupport, missingStarfinderSkills } from "../../scripts/utils/system.mjs";
import { pf2ePackDocument } from "../../tools/pf2e-packs.mjs";
import { buildActionItemData } from "../../scripts/content/action-docs.mjs";
import { buildHazardItems } from "../../scripts/content/ship-docs.mjs";
import { rollTypedDamage } from "../../scripts/rolls/typed-damage.mjs";
import { Initiative } from "../../scripts/combat/initiative.mjs";
import { registerStarshipStatistics } from "../../scripts/starship/statistics-bridge.mjs";
import { applyToolbeltDamage } from "../../scripts/integrations/toolbelt-damage-service.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
const root = new URL("../../", import.meta.url);
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, root), "utf8"));
const manifest = read("module.json");
function pf2e() {
  installFoundryMock();
  game.system = { id: "pf2e", version: "8.6.1" };
  game.modules.set("sf2e-anachronism", { active: true, version: "2.4.0" });
  CONFIG.PF2E = { skills: { computers: {}, piloting: {} } };
}

test("PF2e requires active, compatible Anachronism; SF2e remains independent", () => {
  assert.deepEqual(systemSupport({ id: "sf2e" }, null), { supported: true });
  const system = { id: "pf2e", version: "8.6.1" };
  for (const module of [null, { active: false, version: "2.4.0" }]) assert.equal(systemSupport(system, module).key, "anachronismRequired");
  assert.equal(systemSupport(system, { active: true, version: "2.3.1" }).key, "anachronismVersion");
  assert.equal(systemSupport({ id: "pf2e", version: "8.5.9" }, { active: true, version: "2.4.0" }).key, "pf2eVersion");
  assert.equal(systemSupport(system, { active: true, version: "2.4.0" }).supported, true);
  assert.equal(systemSupport({ id: "other" }).key, "unsupported");
});

test("PF2e skills are verified without adding guesses or mutating CONFIG", () => {
  pf2e();
  assert.deepEqual(missingStarfinderSkills(), []);
  delete CONFIG.PF2E.skills.piloting;
  const before = JSON.stringify(CONFIG);
  assert.deepEqual(missingStarfinderSkills(), ["piloting"]);
  assert.equal(JSON.stringify(CONFIG), before);
  game.system.id = "sf2e";
  assert.deepEqual(missingStarfinderSkills(), []);
});

test("native namespace and upgrade pack selection follow the active system", () => {
  pf2e();
  assert.equal(nativeSystemId(), "pf2e");
  assert.equal(modulePackId("starship-upgrades"), `${MODULE_ID}.starship-upgrades-pf2e`);
  game.system.id = "sf2e";
  assert.equal(nativeSystemId(), "sf2e");
  assert.equal(modulePackId("starship-upgrades"), `${MODULE_ID}.starship-upgrades`);
});

test("manifest provides matched system-scoped packs without imposing Anachronism on SF2e", () => {
  const sf = manifest.packs.filter((p) => p.system === "sf2e");
  assert.equal(sf.length, 11);
  assert.equal(manifest.packs.filter((p) => p.system === "pf2e").length, 11);
  assert.equal(
    manifest.relationships.requires.some((p) => p.id === "sf2e-anachronism"),
    false
  );
  for (const pack of sf) {
    const pf = manifest.packs.find((p) => p.name === `${pack.name}-pf2e`);
    assert.equal(pf.system, "pf2e");
    assert.equal(pf.type, pack.type);
    assert.ok(fs.existsSync(new URL(`${pf.path}/CURRENT`, root)));
  }
});

test("every derived PF2e pack matches its SF2e source, preserving all IDs and rules", () => {
  const names = manifest.packs.filter((p) => p.system === "sf2e").map((p) => p.name);
  let count = 0;
  for (const name of names) {
    const files = fs.readdirSync(new URL(`packs-src/${name}/`, root)).filter((f) => f.endsWith(".json"));
    assert.deepEqual(fs.readdirSync(new URL(`packs-src/${name}-pf2e/`, root)).sort(), files.sort());
    for (const file of files) {
      const sf = read(`packs-src/${name}/${file}`);
      const pf = read(`packs-src/${name}-pf2e/${file}`);
      assert.deepEqual(pf, pf2ePackDocument(sf, names));
      assert.equal(pf._id, sf._id);
      assert.equal(pf._key, sf._key);
      assert.ok(!JSON.stringify(pf).includes("systems/sf2e/"));
      count++;
    }
  }
  assert.equal(count, 538);
});

test("PF2e pack conversion is non-mutating and refuses unverified external UUIDs", () => {
  const source = {
    _id: "unchanged",
    system: { rules: [{ key: "FlatModifier", value: 2 }] },
    flags: { sf2e: { test: true } },
    _stats: { systemId: "sf2e" },
    img: "systems/sf2e/icons/actions/OneAction.webp",
    text: `@UUID[Compendium.${MODULE_ID}.guide.JournalEntry.unchanged]`
  };
  const before = structuredClone(source);
  const converted = pf2ePackDocument(source, ["guide"]);
  assert.deepEqual(source, before);
  assert.deepEqual(converted.system.rules, source.system.rules);
  assert.equal(converted.flags.pf2e.test, true);
  assert.equal(converted._stats.systemId, "pf2e");
  assert.ok(converted.text.includes("guide-pf2e.JournalEntry.unchanged"));
  assert.throws(() => pf2ePackDocument({ text: "Compendium.sf2e.actions.Item.unknown" }, []), /Unmapped/);
  assert.throws(() => pf2ePackDocument({ text: `Compendium.${MODULE_ID}.unknown.Item.id` }, []), /Unknown/);
});

test("PF2e runtime action and hazard builders use PF2e action icons", () => {
  pf2e();
  assert.equal(buildActionItemData({ id: "test", name: "Test", cost: 1 }).img, "systems/pf2e/icons/actions/OneAction.webp");
  const items = buildHazardItems({ id: "test", actions: [{ name: "Test", cost: "one-action", text: "Test" }], strikes: [] });
  assert.ok(items.length > 0);
  for (const item of items) assert.ok(item.img.startsWith("systems/pf2e/"));
});

test("PF2e typed damage and module attack cards write only PF2e native flags", async () => {
  pf2e();
  await rollTypedDamage("{8[piercing]}", { attackCardId: "attack" });
  const flags = game.messages.contents.at(-1).flags;
  assert.equal(flags.pf2e.context.type, "damage-roll");
  assert.equal(flags.pf2e.suppressDamageButtons, true);
  assert.equal(flags.sf2e, undefined);
  assert.equal(flags[MODULE_ID].attackCardDamage, "attack");
});

test("PF2e compromised initiative writes native priority and preserves the current turn", async () => {
  pf2e();
  const ship = makeShip({ id: "ship", name: "Ship" });
  const pc = makeCharacter({ id: "pc", name: "Pilot" });
  const combat = makeStarshipCombat();
  const [current] = await combat.createEmbeddedDocuments("Combatant", [
    { actorId: pc.id, initiative: 18, flags: { pf2e: { overridePriority: { 18: 1 } } } }
  ]);
  combat.turn = 0;
  const created = await Initiative.enterCompromised(combat, ship);
  assert.equal(created.flags.pf2e.overridePriority[18], 0);
  assert.equal(created.flags.sf2e, undefined);
  assert.equal(combat.combatant.id, current.id);
  assert.equal(await Initiative.enterCompromised(combat, ship), null);
});

test("PF2e ship bridge exposes all three saves without changing ordinary actors", async () => {
  pf2e();
  await loadContentFromDisk();
  class Statistic {
    constructor(actor, data) {
      this.mod = data.modifiers.reduce((sum, mod) => sum + mod.modifier, 0);
      this.slug = data.slug;
    }
    clone() {
      return this;
    }
  }
  class Vehicle extends MockActor {
    getStatistic() {
      return "ordinary";
    }
  }
  const ship = makeShip({ id: "ship", name: "Ship", extra: { fort: 8, reflex: 6, will: 7 } });
  Object.setPrototypeOf(ship, Vehicle.prototype);
  ship.saves = { fortitude: new Statistic(ship, { slug: "fortitude", modifiers: [{ modifier: 8 }] }) };
  registerStarshipStatistics({ vehicle: Vehicle });
  for (const [slug, value] of [
    ["fortitude", 8],
    ["reflex", 6],
    ["will", 7]
  ])
    assert.equal(ship.getStatistic(slug).mod, value);
  assert.equal(new Vehicle({ type: "vehicle" }).getStatistic("reflex"), "ordinary");
});

test("PF2e Toolbelt damage reads PF2e context and uses the ship engine exactly once", async () => {
  pf2e();
  await loadContentFromDisk();
  game.modules.set("pf2e-toolbelt", { active: true });
  const ship = makeShip({ id: "ship", name: "Ship", hp: 30, sp: 12 });
  const roll = { instances: [{ total: 8, type: "piercing", persistent: false, kinds: new Set(["damage"]) }], options: {} };
  const message = await ChatMessage.create({ rolls: [roll], flags: { pf2e: { context: { options: ["item:trait:bypassing"] } } } });
  message.isDamageRoll = true;
  const request = {
    user: game.user,
    payload: { messageId: message.id, targetUuid: ship.uuid, mode: "shields", multiplier: 1, rollIndex: 0 }
  };
  await applyToolbeltDamage(request);
  assert.equal(ship.system.attributes.hp.value, 22);
  assert.equal(ship.flags[MODULE_ID].starship.sp.value, 12);
  await assert.rejects(applyToolbeltDamage(request));
});

test("PF2e conditions prefer native documents and include additional Anachronism entries", async () => {
  pf2e();
  game.packs = new Map([
    [
      "pf2e.conditions",
      { collection: "pf2e.conditions", getIndex: async () => [{ _id: "fear", name: "Frightened", system: { slug: "frightened" } }] }
    ],
    [
      "sf2e-anachronism.conditions",
      {
        collection: "sf2e-anachronism.conditions",
        getIndex: async () => [{ _id: "supp", name: "Suppressed", system: { slug: "suppressed" } }]
      }
    ]
  ]);
  const { findCondition } = await import("../../scripts/content/condition-enricher.mjs?pf2e-test");
  assert.equal((await findCondition("frightened")).uuid, "Compendium.pf2e.conditions.Item.fear");
  assert.equal((await findCondition("suppressed")).uuid, "Compendium.sf2e-anachronism.conditions.Item.supp");
});
