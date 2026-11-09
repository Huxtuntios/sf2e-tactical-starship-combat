import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { stationEffects, replaceStationBoost } from "../../scripts/starship/effects.mjs";
import { validateManualModifiers, manualModifiersFor } from "../../scripts/actions/manual-modifiers.mjs";
import { damageFormula } from "../../scripts/actions/strike.mjs";
import { executeAction, sanitizeActionRequest } from "../../scripts/actions/action-engine.mjs";

const boost = (station, id = station) => ({
  id,
  slug: "boost-battle-station",
  station,
  timing: { combatId: "combat", combatantId: "pilot", round: 2 },
  modifiers: [{ selector: "station-damage", type: "status", value: 1 }]
});
const combat = { id: "combat", round: 1, turn: 0, turns: [{ id: "pilot" }, { id: "other" }] };
test("boost: station scope, unscoped legacy, combat changes, round expiry and refresh", () => {
  const g = boost("g"),
    p = boost("p"),
    old = boost(null);
  const effects = [g, p, old, { slug: "other", modifiers: [] }];
  assert.deepEqual(stationEffects(effects, "g", combat), [g, effects[3]]);
  assert.deepEqual(stationEffects(effects, "p", combat), [p, effects[3]]);
  assert.deepEqual(stationEffects(effects, "g", { ...combat, id: "new" }), [effects[3]]);
  assert.deepEqual(stationEffects(effects, "g", { ...combat, round: 2 }), [effects[3]]);
  assert.deepEqual(
    replaceStationBoost([g, p], boost("g", "new")).map((e) => e.id),
    ["p", "new"]
  );
});
test("validated manual modifiers have scope, unique trusted slugs and strict input limits", () => {
  const input = [
    { name: "Aid", source: "Ally", value: 2, type: "circumstance", scope: "attack", slug: "forged" },
    { name: "Focus", source: "", value: 1, type: "status", scope: "both" }
  ];
  const modifiers = validateManualModifiers(input);
  assert.equal(modifiers[0].slug, "tsc-manual-0");
  assert.deepEqual(
    manualModifiersFor(modifiers, "attack").map((m) => m.value),
    [2, 1]
  );
  assert.deepEqual(
    manualModifiersFor(modifiers, "damage").map((m) => m.value),
    [1]
  );
  for (const bad of [
    { ...input[0], value: 0 },
    { ...input[0], value: 101 },
    { ...input[0], value: "2" },
    { ...input[0], type: "bogus" },
    { ...input[0], scope: "forever" },
    { ...input[0], name: "  " }
  ])
    assert.throws(() => validateManualModifiers([bad]));
  assert.throws(() => validateManualModifiers(Array(7).fill(input[0])));
  assert.equal(sanitizeActionRequest({ options: { manualModifiers: input } }, { isGM: true }).options.manualModifiers, undefined);
});
test("damage modifiers stack by type, preserve penalty signs and double on a critical", () => {
  installFoundryMock();
  const ctx = {
    data: {
      effects: [
        boost("g"),
        { ...boost("g", "other"), slug: "other", modifiers: [{ selector: "station-damage", type: "status", value: 3 }] }
      ]
    },
    station: { id: "g" },
    stationRow: { damageDice: 1 },
    combat,
    manualModifiers: validateManualModifiers([{ name: "Aid", source: "", value: -2, type: "circumstance", scope: "damage" }])
  };
  assert.equal(damageFormula(ctx, { die: "1d6" }, false), "1d6+1");
  assert.equal(damageFormula(ctx, { die: "1d6" }, true), "(1d6+1)*2");
});
test("Boost execution validates owner, source, target and combat turn and persists separate station effects", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const pc = makeCharacter({ id: "eng", name: "Engineer", owners: ["p1"] });
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    owners: ["p1"],
    stations: [
      { id: "gen", type: "generator", grade: "commercial", helmedBy: pc.uuid },
      { id: "g", type: "gunnery", grade: "commercial" },
      { id: "p", type: "pilot", grade: "commercial" }
    ],
    crew: [{ actorUuid: pc.uuid, role: "crew", stationId: "gen" }]
  });
  const c = makeStarshipCombat();
  await c.createEmbeddedDocuments("Combatant", [{ actorId: pc.id, initiative: 20 }]);
  const run = (u, target, opts = {}) =>
    executeAction({
      user: game.users.get(u),
      shipUuid: ship.uuid,
      crewUuid: pc.uuid,
      actionId: "boost-battle-station",
      options: { targetStationId: target },
      ...opts
    });
  await assert.rejects(() => run("p2", "g"));
  await assert.rejects(() => run("p1", "not-a-station"));
  assert.equal((await run("p1", "g")).ok, true);
  assert.equal((await run("p1", "p")).ok, true);
  let effects = ship.flags["sf2e-tactical-starship-combat"].starship.effects;
  assert.deepEqual(
    effects
      .filter((e) => e.slug === "boost-battle-station")
      .map((e) => e.station)
      .sort(),
    ["g", "p"]
  );
  assert.equal(effects[0].operatorUuid, pc.uuid);
  await run("p1", "g");
  effects = ship.flags["sf2e-tactical-starship-combat"].starship.effects;
  assert.equal(effects.filter((e) => e.slug === "boost-battle-station").length, 2);
  c.turn = 1;
  await assert.rejects(() => run("p1", "g"));
});

test("damage uses the SF2e StatisticModifier API when it is available", () => {
  installFoundryMock();
  let seen;
  game.pf2e.Modifier = class {
    constructor(data) {
      Object.assign(this, data);
    }
  };
  game.pf2e.StatisticModifier = class {
    constructor(slug, mods) {
      seen = { slug, mods };
      this.totalModifier = 7;
    }
  };
  const ctx = {
    data: { effects: [boost("g")] },
    station: { id: "g" },
    stationRow: { damageDice: 1 },
    combat,
    manualModifiers: validateManualModifiers([{ name: "Aid", source: "Ally", value: 2, type: "circumstance", scope: "damage" }])
  };
  assert.equal(damageFormula(ctx, { die: "1d6" }, false), "1d6+7");
  assert.equal(seen.slug, "tsc-station-damage");
  assert.deepEqual(
    seen.mods.map((m) => [m.modifier, m.type]),
    [
      [1, "status"],
      [2, "circumstance"]
    ]
  );
  assert.notEqual(seen.mods[0].slug, seen.mods[1].slug);
});

test("modifier form parses scoped rows, rejects malformed entries and honors cancel", async () => {
  installFoundryMock();
  const { promptManualModifiers } = await import("../../scripts/ui/native-attack.mjs");
  let content;
  foundry.applications.ux = {};
  foundry.applications.ux.FormDataExtended = class {
    constructor(form) {
      this.object = form;
    }
  };
  foundry.applications.api.DialogV2.prompt = async (options) => {
    content = options.content;
    return options.ok.callback(null, { form: { name0: "Aid", source0: "Ally", value0: "+2", type0: "circumstance", scope0: "attack" } });
  };
  assert.deepEqual(await promptManualModifiers([{ label: "Boost", value: 1, type: "status" }]), [
    { name: "Aid", source: "Ally", value: 2, type: "circumstance", scope: "attack" }
  ]);
  assert.match(content, /Boost/);
  assert.match(content, /name5/);
  foundry.applications.api.DialogV2.prompt = async (options) =>
    options.ok.callback(null, { form: { name0: "Aid", value0: "1.5", type0: "status", scope0: "attack" } });
  await assert.rejects(() => promptManualModifiers([]));
  foundry.applications.api.DialogV2.prompt = async () => null;
  assert.equal(await promptManualModifiers([]), null);
});
