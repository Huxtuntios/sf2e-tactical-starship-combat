import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFoundryMock, loadContentFromDisk, makeShip, MockActor } from "../helpers/foundry-mock.mjs";
import { registerStarshipStatistics } from "../../scripts/starship/statistics-bridge.mjs";
import { shipStatistic } from "../../scripts/starship/stats.mjs";
import { normalizeNativeChecks } from "../../scripts/content/native-checks.mjs";
import { linkInline } from "../../scripts/content/inline-links.mjs";
import { checkLinksHTML, checkChatContent } from "../../scripts/content/inline-checks.mjs";
import { postActionCard } from "../../scripts/chat/chat-cards.mjs";
import { setContentTranslations } from "../../scripts/content/content-i18n.mjs";

const MODULE_ID = "sf2e-tactical-starship-combat";

// Модель публичного контракта Statistic, не запуск настоящего SF2e/Toolbelt.
class Statistic {
  constructor(actor, data) {
    this.actor = actor;
    this.data = data;
    this.slug = data.slug;
    this.mod = data.modifiers.reduce((sum, modifier) => sum + modifier.modifier, 0);
    this.check = {
      mod: this.mod,
      roll: async (options) => {
        actor.lastRoll = options;
        const roll = { total: 10 + this.mod, degreeOfSuccess: 2 };
        options.callback?.(roll, "success", { flags: { sf2e: { context: { type: "saving-throw" } } } });
        return roll;
      }
    };
  }
  clone({ modifiers }) {
    return new Statistic(this.actor, { ...this.data, modifiers: [...this.data.modifiers, ...modifiers] });
  }
}

async function scenario(role = "player") {
  installFoundryMock();
  await loadContentFromDisk();
  class Vehicle extends MockActor {
    getStatistic(slug, options) {
      this.lastLookup = { slug, options };
      return this.saves?.[slug] ?? this.nativeOther ?? null;
    }
  }
  class NPC extends Vehicle {}
  const classes = { vehicle: Vehicle, npc: NPC };
  const actor = makeShip({ id: "test-ship", name: "Test Ship", role, extra: { reflex: 6, skills: { piloting: 11 } } });
  Object.setPrototypeOf(actor, (role === "player" ? Vehicle : NPC).prototype);
  actor.saves = { fortitude: new Statistic(actor, { slug: "fortitude", modifiers: [{ modifier: 8 }] }) };
  const original = Vehicle.prototype.getStatistic;
  assert.equal(registerStarshipStatistics(classes), 2);
  return { actor, classes, original };
}

test("Toolbelt: getStatistic exposes all ship saves, Perception and real skills without writing actor data", async () => {
  const { actor } = await scenario();
  const before = JSON.stringify(actor.flags);
  for (const slug of ["fortitude", "reflex", "will", "perception", "piloting"])
    assert.equal(actor.getStatistic(slug).mod, shipStatistic(actor, slug).mod);
  assert.equal(actor.getStatistic("reflex").mod, 6);
  assert.equal(actor.getStatistic("piloting").mod, 11);
  assert.equal(actor.getStatistic("thievery"), null);
  assert.equal(JSON.stringify(actor.flags), before);
  assert.equal(globalThis.__writes.length, 0);
});

test("Toolbelt: native check.roll receives DC, origin, item, roll options and callback exactly once", async () => {
  const { actor } = await scenario();
  let callbacks = 0;
  const options = {
    dc: { value: 17 },
    item: { uuid: "Actor.attacker.Item.weapon" },
    origin: { uuid: "Actor.attacker" },
    skipDialog: true,
    extraRollOptions: ["damaging-effect"],
    createMessage: false,
    callback: (roll, success) => {
      callbacks++;
      assert.equal(roll.total, 16);
      assert.equal(success, "success");
    }
  };
  await actor.getStatistic("reflex").check.roll(options);
  assert.equal(actor.lastRoll, options);
  assert.equal(callbacks, 1);
  assert.equal(game.messages.size, 0, "bridge does not post a second roll");
});

test("bridge reads current ship penalties, not a cached modifier", async () => {
  const { actor } = await scenario();
  assert.equal(actor.getStatistic("reflex").mod, 6);
  actor.flags[MODULE_ID].starship.offKilter = true;
  assert.equal(actor.getStatistic("reflex").mod, 4);
  actor.flags[MODULE_ID].starship.inoperable = true;
  assert.equal(actor.getStatistic("reflex").mod, 0);
  actor.flags[MODULE_ID].starship.offKilter = false;
  actor.flags[MODULE_ID].starship.inoperable = false;
  assert.equal(actor.getStatistic("reflex").mod, 6);
});

test("NPC native modifiers survive; repeated calls do not stack the module delta", async () => {
  const { actor } = await scenario("npc");
  actor._source = { system: { saves: { reflex: { value: 6 } } } };
  actor.saves.reflex = new Statistic(actor, { slug: "reflex", modifiers: [{ modifier: 6 }, { modifier: 2 }] });
  actor.flags[MODULE_ID].starship.offKilter = true;
  for (let i = 0; i < 3; i++) assert.equal(actor.getStatistic("reflex").mod, 6, "6 base + 2 native - 2 off-kilter");
  assert.equal(actor.saves.reflex.mod, 8, "native preparation is not mutated");
});

test("ordinary actors, unknown statistics and previous wrappers retain their original contract", async () => {
  const { actor, classes } = await scenario();
  const ordinary = new classes.vehicle({ type: "vehicle" });
  const marker = { native: true };
  ordinary.nativeOther = marker;
  const options = { item: "existing integration" };
  assert.equal(ordinary.getStatistic("reflex", options), marker);
  assert.deepEqual(ordinary.lastLookup, { slug: "reflex", options });
  actor.nativeOther = marker;
  assert.equal(actor.getStatistic("armor", options), marker);
  const wrapped = classes.vehicle.prototype.getStatistic;
  assert.equal(registerStarshipStatistics(classes), 0);
  assert.equal(classes.vehicle.prototype.getStatistic, wrapped);
  assert.equal(registerStarshipStatistics({}), 0);
});

test("save links keep basic/DC params but have no duplicate DC or redundant outer parentheses", () => {
  const ru = "(конус 1 зона, аналоговое), Урон 1d8+3 колющий (@Check[reflex|dc:17|basic]{КС 17 простой спасбросок Рефлекса})";
  const linked = linkInline(ru);
  assert.match(linked, /@Damage\[\(1d8\+3\)\[piercing\]\]/);
  assert.match(linked, /@Check\[reflex\|dc:17\|basic\]\{простой спасбросок Рефлекса\}/);
  assert.ok(!linked.includes("(@Check["));
  assert.ok(!linked.includes("КС 17"));
  assert.match(linked, /^\(конус 1 зона, аналоговое\)/, "area/traits parentheses remain");
  assert.equal(linkInline(linked), linked);
  assert.equal(linkInline("(DC 17 basic Reflex save)"), "@Check[reflex|dc:17|basic]{basic Reflex save}");
});

test("custom labels, DC visibility and HTML attributes are not replaced indiscriminately", () => {
  assert.equal(normalizeNativeChecks("@Check[reflex|dc:17|showDC:gm]{Dodge}"), "@Check[reflex|dc:17|showDC:gm]{Dodge}");
  assert.equal(normalizeNativeChecks("@Check[reflex|dc:17]{DC 18 special}"), "@Check[reflex|dc:17]{DC 18 special}");
  assert.equal(normalizeNativeChecks("@Check[reflex|dc:@self.level]{Custom}"), "@Check[reflex|dc:@self.level]{Custom}");
  const attribute = '<a data-source="(@Check[reflex|dc:17]{DC 17 Reflex})">x</a>';
  assert.equal(normalizeNativeChecks(attribute), attribute);
  assert.equal(normalizeNativeChecks("@Check[reflex|dc:17]{КС 17}"), "@Check[reflex|dc:17]");
  const nested = normalizeNativeChecks("((@Check[reflex|dc:17]{DC 17 Reflex}))");
  assert.equal(nested, "@Check[reflex|dc:17]{Reflex}");
  assert.equal(normalizeNativeChecks(nested), nested);
});

test("module-only windows retain DC labels; reposted chat uses native SF2e DC display", () => {
  assert.match(checkLinksHTML("DC 17 basic Reflex save"), /data-label="DC 17 basic Reflex save"/);
  assert.equal(
    checkChatContent("reflex|dc:17|basic", "КС 17 простой спасбросок Рефлекса"),
    "<p>@Check[reflex|dc:17|basic]{простой спасбросок Рефлекса}</p>"
  );
});

test("actual Barrow Dirgesinger action card has normalized save text and native damage markup", async () => {
  const { actor } = await scenario("npc");
  const ships = JSON.parse(fs.readFileSync("data/starships/corpse-fleet.json", "utf8")).ships;
  const source = ships.flatMap((ship) => ship.actions ?? []).find((action) => action.name === "fragment launcher");
  assert.ok(source);
  const translations = JSON.parse(fs.readFileSync("lang/content/ru.json", "utf8"));
  setContentTranslations("ru", translations.strings ?? translations);
  const { ct } = await import("../../scripts/content/content-i18n.mjs");
  await postActionCard({ actor, action: { id: "fragment-launcher", name: source.name }, manual: [ct(source.text)] });
  const content = game.messages.contents.at(-1).content;
  assert.match(content, /@Damage\[\(1d8\+3\)\[piercing\]\]/);
  assert.match(content, /@Check\[reflex\|dc:17\|basic\]\{простой спасбросок Рефлекса\}/);
  assert.ok(!content.includes("(@Check"));
  setContentTranslations("en", {});
});
