import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFoundryMock, loadContentFromDisk, makeCharacter, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { stageDroneBlock, stageDroneShieldProtocolBlock } from "../../scripts/actions/drone-block.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { moveOwnedMine } from "../../scripts/actions/mine-resolution.mjs";
import { changeDrone } from "../../scripts/engine/drone-state.mjs";
import { readStarship, patchStarship } from "../../scripts/starship/starship-state.mjs";
import { confirmDroneBlock, Reactions } from "../../scripts/actions/reactions.mjs";
import { Content } from "../../scripts/content/loader.mjs";

// AoN verifies base Drone Block's zero resistance at level 1 and 10-minute return. Other interactions remain conservative
// because the available rules text does not expressly resolve them.
const crew = (level) => ({ uuid: "Actor.op", system: { details: { level: { value: level } } } });
function draftOf(extra = {}) {
  const data = {
    stations: [{ id: "s", type: "drone-console", helmedBy: "Actor.op" }],
    upgrades: [],
    drones: [
      { id: "d1", stationId: "s", tscVersion: 1, ref: "scramble-drone", deployed: true, tscInterceptUsed: true },
      {
        id: "d2",
        stationId: "s",
        tscVersion: 1,
        ref: "pyrotechnics-drone",
        deployed: true,
        mineStock: [{ id: "stored-1", installed: { mods: ["smart-mine"] } }],
        mines: [{ id: "m1", droneId: "d2", operatorUuid: "Actor.op", combatId: "c", zone: 3, state: "armed" }]
      }
    ],
    ...extra
  };
  const entry = { data, before: structuredClone(data) };
  return { entry, draft: { ship: async () => entry } };
}
const stage = (draft, over = {}) =>
  stageDroneBlock({
    draft,
    targetUuid: "Actor.ship",
    stationId: "s",
    crew: crew(7),
    droneId: "d1",
    strikeId: "strike-1",
    worldTime: 1000,
    ...over
  });

async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
  Content.drones = JSON.parse(readFileSync("data/equipment/misc.json", "utf8")).drones;
  const operator = makeCharacter({ id: "protocol-operator", name: "Operator", owners: ["p1"] });
  operator.system.details = { level: { value: 8 } };
  const ship = makeShip({
    id: "protocol-target",
    name: "Defender",
    stations: [{ id: "dc", type: "drone-console", grade: "commercial", helmedBy: operator.uuid }],
    crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "dc" }],
    extra: { drones: [{ id: "d1", ref: "repair-drone", stationId: "dc", tscVersion: 1, deployed: true }] }
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 1 }] });
  await combat.createEmbeddedDocuments("Combatant", [{ _id: "protocol-operator-turn", actorId: operator.id, initiative: 20 }]);
  return { operator, ship, combat };
}

test("resistance is half the operator's level rounded down; the drone is retrieved for 10 minutes", async () => {
  installFoundryMock();
  for (const [level, expected] of [
    [1, 0],
    [2, 1],
    [7, 3],
    [20, 10]
  ]) {
    const { draft, entry } = draftOf();
    assert.equal(await stage(draft, { crew: crew(level) }), expected, `level ${level}`);
    const d = entry.data.drones[0];
    assert.deepEqual([d.deployed, d.availableAt], [false, 1600]);
    assert.deepEqual(entry.data.droneBlockReceipts, [{ strikeId: "strike-1", droneId: "d1", stationId: "s", crewUuid: "Actor.op" }]);
    assert.ok(entry.writeOptions.expected);
  }
});

test("invalid requests change nothing: wrong crew, undeployed or foreign drone, malfunction, protocol, replay, bad level/time", async () => {
  installFoundryMock();
  const cases = [
    [{ crew: { ...crew(7), uuid: "Actor.other" } }],
    [{ droneId: "missing" }],
    [{ strikeId: "" }],
    [{ worldTime: NaN }],
    [{ crew: crew(0) }],
    [{ crew: crew(2.5) }],
    [{}, (d) => (d.drones[0].deployed = false)],
    [{}, (d) => (d.drones[0].tscVersion = 2)],
    [{}, (d) => (d.stations[0].malfunctioning = true)],
    [{}, (d) => (d.destroyed = true)],
    [{}, (d) => d.upgrades.push({ ref: "drone-shield-protocol", stationId: "s" })],
    [{}, (d) => (d.droneBlockReceipts = [{ strikeId: "strike-1" }])],
    [{}, (d) => (d.droneBlockReceipts = "broken")]
  ];
  for (const [over, mutate] of cases) {
    const { draft, entry } = draftOf();
    mutate?.(entry.data);
    const before = structuredClone(entry.data);
    await assert.rejects(stage(draft, over), JSON.stringify(over));
    assert.deepEqual(entry.data, before, JSON.stringify(over));
  }
});

test("Drone Shield Protocol offers a GM-confirmed manual path without base retrieval or cooldown", async () => {
  const { operator, ship, combat } = await setup();
  await patchStarship(
    ship,
    (data) => {
      data.upgrades.push({ id: "shield-protocol", ref: "drone-shield-protocol", stationId: "dc" });
    },
    { history: false }
  );
  const { resolveReactionResponse } = await import("../../scripts/actions/reactions.mjs");
  let prompt;
  foundry.applications.api.DialogV2.prompt = async (config) => {
    prompt = config;
    return "manual";
  };
  game.socket.emit = (_event, message) => {
    if (message.kind === "event" && message.type === "reactionPrompt")
      resolveReactionResponse({
        user: game.users.get("p1"),
        payload: { requestId: message.payload.requestId, use: true, droneId: "d1" }
      });
  };
  const draft = new Draft(combat);
  const entry = await draft.ship(ship.uuid);
  const attacker = makeShip({ id: "protocol-attacker", name: "Raider", role: "npc" });
  const result = await Reactions.ask(
    { draft, tsc: draft.tsc, combat, options: {}, strikeId: "protocol-strike", ship: attacker },
    { uuid: ship.uuid, actor: ship, data: entry.data },
    { amount: 12, traits: [], crit: false, attackLabel: "Plasma bolt" }
  );
  assert.equal(result.resistance, 4);
  assert.equal(result.manualDamage.protocolManual, true);
  assert.match(prompt.content, /up to two blocks/);
  assert.match(prompt.content, /first block destroys it/);
  assert.doesNotMatch(prompt.content, /value="automatic"/);
  await draft.commit();

  const after = readStarship(ship);
  assert.equal(after.drones[0].deployed, true);
  assert.equal(after.drones[0].availableAt, undefined);
  assert.equal(after.drones[0].tscProtocolBlocks, 1);
  assert.equal(after.drones[0].tscProtocolFetchPending, true);
  assert.equal(after.droneBlockReceipts, undefined);
  assert.equal(after.droneProtocolManualReceipts, undefined);
  const protocolReceipt = JSON.parse(after.drones[0].tscProtocolReceipts[0]);
  assert.equal(protocolReceipt[1], "block");
  assert.equal(protocolReceipt[4], "protocol-strike");
  const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
  const { default: Handlebars } = await import("handlebars");
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => game.i18n.localize(key));
  h.registerHelper("eq", (a, b) => a === b);
  for (const partial of ["tscOccupant", "tscStationUpgrades", "tscShipUpgrades", "tscUpgradeItem"]) h.registerPartial(partial, "");
  h.registerPartial("modules/sf2e-tactical-starship-combat/templates/crew-ship.hbs", "");
  const html = h.compile(readFileSync("templates/starship-sheet.hbs", "utf8"))(
    await buildSheetContext({ document: ship, isNpc: false, tab: "stations", tabs: ["stations"] })
  );
  assert.match(html, /Blocks recorded 1\/2/);
  assert.match(html, /data-action="protocolDroneManual" data-op="fetch"/);
  const replay = new Draft(combat);
  await assert.rejects(() =>
    stageDroneShieldProtocolBlock({
      draft: replay,
      targetUuid: ship.uuid,
      stationId: "dc",
      crew: operator,
      droneId: "d1",
      strikeId: "protocol-strike",
      combat
    })
  );
  assert.equal(readStarship(ship).drones[0].tscProtocolBlocks, 1);
});

test("starship sheet reports drone cooldown only from finite world time", async () => {
  const { ship } = await setup();
  await patchStarship(
    ship,
    (data) => {
      data.drones[0].deployed = false;
      data.drones[0].availableAt = 700;
    },
    { history: false }
  );
  const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
  const { default: Handlebars } = await import("handlebars");
  const h = Handlebars.create();
  h.registerHelper("localize", (key) => game.i18n.localize(key));
  h.registerHelper("eq", (a, b) => a === b);
  for (const partial of ["tscOccupant", "tscStationUpgrades", "tscShipUpgrades", "tscUpgradeItem"]) h.registerPartial(partial, "");
  h.registerPartial("modules/sf2e-tactical-starship-combat/templates/crew-ship.hbs", "");
  const context = () => buildSheetContext({ document: ship, isNpc: false, tab: "stations", tabs: ["stations"] });

  game.time.worldTime = 400;
  let sheet = await context();
  assert.equal(sheet.stations[0].droneRows[0].cooldownLabel, "Redeploy in 5 min");
  assert.match(h.compile(readFileSync("templates/starship-sheet.hbs", "utf8"))(sheet), /Redeploy in 5 min/);

  game.time.worldTime = undefined;
  sheet = await context();
  assert.equal(sheet.stations[0].droneRows[0].cooldownLabel, game.i18n.localize("SF2eTSC.droneControl.cooldownUnknown"));

  game.time.worldTime = 700;
  sheet = await context();
  assert.equal(sheet.stations[0].droneRows[0].cooldownLabel, game.i18n.localize("SF2eTSC.droneControl.redeployReady"));
});

test("Drone Block preserves Intercept Munitions use; only explicit Retrieve resets it", async () => {
  installFoundryMock();
  const { draft, entry } = draftOf();
  await stage(draft);
  assert.equal(entry.data.drones[0].tscInterceptUsed, true);
  // Обычное действие Retrieve сбрасывает её (для сравнения).
  const data = structuredClone(entry.before);
  changeDrone(
    data,
    "retrieve",
    { stationId: "s", id: "d1" },
    { droneTypes: [{ id: "scramble-drone" }, { id: "pyrotechnics-drone" }], definition: {}, worldTime: 0 }
  );
  assert.equal(data.drones[0].tscInterceptUsed, false);
});

test("Drone Block preserves armed Pyrotechnics Drone mine records without enabling use while the drone is returned", async () => {
  installFoundryMock();
  const { draft, entry } = draftOf();
  await stage(draft, { droneId: "d2" });
  const mine = entry.data.drones[1].mines[0];
  assert.equal(mine.state, "armed"); // мина не снимается автоматически
  assert.deepEqual(entry.data.drones[1].mineStock, entry.before.drones[1].mineStock);
  assert.throws(
    () =>
      moveOwnedMine({
        data: entry.data,
        shipUuid: "Actor.ship",
        stationId: "s",
        droneId: "d2",
        mineId: "m1",
        combatId: "c",
        shipZone: 3,
        sensorRange: 6,
        zones: 12,
        destination: 4,
        origin: 3,
        moveId: "move1",
        operatorUuid: "Actor.op"
      }),
    /drone|mine/
  );
});

test("GM confirmation names the specific Strike and offers automatic or manual damage resolution", async () => {
  installFoundryMock();
  let prompt;
  foundry.applications.api.DialogV2.prompt = async (config) => {
    prompt = config;
    return "manual";
  };
  assert.equal(
    await confirmDroneBlock({
      target: "Defender",
      attacker: "Raider",
      attack: "Plasma bolt",
      amount: 12,
      resistance: 3,
      drone: "Scramble Drone",
      notes: ["Retrieve Drone interaction needs GM review."]
    }),
    "manual"
  );
  assert.match(prompt.content, /Plasma bolt/);
  assert.match(prompt.content, /Defender/);
  assert.match(prompt.content, /value="automatic"/);
  assert.match(prompt.content, /value="manual"/);
  assert.match(prompt.content, /Retrieve Drone interaction needs GM review/);
});

test("GM protocol confirmation is manual-only and never promises the base cooldown", async () => {
  installFoundryMock();
  let prompt;
  foundry.applications.api.DialogV2.prompt = async (config) => {
    prompt = config;
    return config.ok.callback(null, { form: { elements: {} } });
  };
  assert.equal(
    await confirmDroneBlock({
      target: "Defender",
      attacker: "Raider",
      attack: "Plasma bolt",
      amount: 12,
      resistance: 3,
      drone: "Scramble Drone",
      manualOnly: true
    }),
    "manual"
  );
  assert.match(prompt.content, /up to two blocks/);
  assert.match(prompt.content, /first block destroys it/);
  assert.doesNotMatch(prompt.content, /value="automatic"/);
  assert.match(prompt.content, /10-minute cooldown/);
});
