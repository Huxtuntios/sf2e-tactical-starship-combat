import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";
import { stageDroneBlock } from "../../scripts/actions/drone-block.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { applyDamageInDraft } from "../../scripts/damage/damage-service.mjs";
import { readStarship, patchStarship } from "../../scripts/starship/starship-state.mjs";
import { changeDrone } from "../../scripts/engine/drone-state.mjs";
import { Reactions } from "../../scripts/actions/reactions.mjs";
import { Content } from "../../scripts/content/loader.mjs";

async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
  Content.drones = JSON.parse(readFileSync("data/equipment/misc.json", "utf8")).drones;
  const crew = makeCharacter({ id: "operator", name: "Operator", owners: ["p1"] });
  crew.system.details = { level: { value: 8 } };
  const ship = makeShip({
    id: "target",
    name: "Target",
    sp: 10,
    stations: [{ id: "dc", type: "drone-console", grade: "commercial", helmedBy: crew.uuid }],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "dc" }],
    extra: { drones: [{ id: "d1", ref: "repair-drone", stationId: "dc", tscVersion: 1, deployed: true }], resistances: { fire: 3 } }
  });
  return { crew, ship };
}
const input = (draft, ship, crew, extra = {}) => ({
  draft,
  targetUuid: ship.uuid,
  stationId: "dc",
  crew,
  droneId: "d1",
  strikeId: "strike-1",
  worldTime: 100,
  ...extra
});

test("specific Strike consumes selected drone and combines resistance with ship IWR", async () => {
  const { crew, ship } = await setup();
  const draft = new Draft(null);
  const resistance = await stageDroneBlock(input(draft, ship, crew));
  assert.equal(resistance, 4);
  const dmg = await applyDamageInDraft(draft, ship.uuid, { amount: 10, damageType: "fire", strikeResistance: resistance, silent: true });
  assert.equal(dmg.resistanceReduction, 4);
  await draft.commit();
  const data = readStarship(ship);
  assert.equal(data.sp.value, 4);
  assert.equal(data.drones[0].deployed, false);
  assert.equal(data.drones[0].availableAt, 700);
  assert.equal(data.droneBlockReceipts[0].strikeId, "strike-1");
  assert.throws(
    () =>
      changeDrone(
        data,
        "deploy",
        { stationId: "dc", id: "d1" },
        { definition: Content.stations.get("drone-console"), droneTypes: Content.drones, worldTime: 699 }
      ),
    /cooldown/
  );
  assert.equal(
    changeDrone(
      data,
      "deploy",
      { stationId: "dc", id: "d1" },
      { definition: Content.stations.get("drone-console"), droneTypes: Content.drones, worldTime: 700 }
    ),
    true
  );
});

test("higher existing resistance wins and unbound unrelated damage gains no resistance", async () => {
  const { crew, ship } = await setup();
  await patchStarship(
    ship,
    (d) => {
      d.resistances = { fire: 8 };
    },
    { history: false }
  );
  const draft = new Draft(null);
  const resistance = await stageDroneBlock(input(draft, ship, crew));
  const blocked = await applyDamageInDraft(draft, ship.uuid, {
    amount: 10,
    damageType: "fire",
    strikeResistance: resistance,
    silent: true
  });
  assert.equal(blocked.resistanceReduction, 8);
  await draft.commit();
  const next = new Draft(null);
  const unrelated = await applyDamageInDraft(next, ship.uuid, { amount: 8, damageType: "cold", silent: true });
  assert.equal(unrelated.resistanceReduction, 0);
});

test("stale draft conflicts without consuming drone or overwriting intervening change", async () => {
  const { crew, ship } = await setup();
  const draft = new Draft(null);
  await stageDroneBlock(input(draft, ship, crew));
  await applyDamageInDraft(draft, ship.uuid, { amount: 8, damageType: "fire", strikeResistance: 4, silent: true });
  await patchStarship(
    ship,
    (d) => {
      d.sp.value = 2;
    },
    { history: false }
  );
  await assert.rejects(() => draft.commit());
  const data = readStarship(ship);
  assert.equal(data.sp.value, 2);
  assert.equal(data.drones[0].deployed, true);
  assert.equal(data.droneBlockReceipts, undefined);
});

test("refuses invalid selection, missing time and protocol without side effects", async () => {
  const { crew, ship } = await setup();
  for (const extra of [{ droneId: "other" }, { worldTime: null }, { crew: null }, { strikeId: null }]) {
    const draft = new Draft(null);
    await assert.rejects(() => stageDroneBlock(input(draft, ship, crew, extra)));
    assert.equal(readStarship(ship).drones[0].deployed, true);
  }
  await patchStarship(
    ship,
    (d) => {
      d.upgrades.push({ id: "u", ref: "drone-shield-protocol", stationId: "dc" });
    },
    { history: false }
  );
  const draft = new Draft(null);
  await assert.rejects(() => stageDroneBlock(input(draft, ship, crew)));
  const offer = Reactions.eligible(readStarship(ship), null, null).find((o) => o.actionId === "drone-block");
  assert.equal(offer.manualOnly, true);
  assert.deepEqual(offer.drones, [{ id: "d1", ref: "repair-drone" }]);
});

test("prompt binds response to offered drone and authenticated operator", async () => {
  const { crew, ship } = await setup();
  foundry.applications.api.DialogV2.prompt = async () => "automatic";
  const { resolveReactionResponse } = await import("../../scripts/actions/reactions.mjs");
  const draft = new Draft(null);
  const entry = await draft.ship(ship.uuid);
  const attacker = makeShip({ id: "enemy", name: "Enemy", role: "npc" });
  let prompted = false;
  game.socket.emit = (_event, msg) => {
    if (msg.kind !== "event" || msg.type !== "reactionPrompt") return;
    prompted = true;
    const req = msg.payload.requestId;
    assert.throws(() => resolveReactionResponse({ user: game.users.get("p2"), payload: { requestId: req, use: true, droneId: "d1" } }));
    assert.throws(() => resolveReactionResponse({ user: game.users.get("p1"), payload: { requestId: req, use: true, droneId: "other" } }));
    assert.equal(resolveReactionResponse({ user: game.users.get("p1"), payload: { requestId: req, use: true, droneId: "d1" } }), true);
    assert.equal(resolveReactionResponse({ user: game.users.get("p1"), payload: { requestId: req, use: true, droneId: "d1" } }), false);
  };
  const rx = await Reactions.ask(
    { draft, tsc: null, combat: null, ship: attacker, options: {}, strikeId: "strike-unique" },
    { uuid: ship.uuid, actor: ship, data: entry.data },
    { amount: 10, traits: [], crit: false }
  );
  assert.equal(prompted, true);
  assert.equal(rx.resistance, 4);
  await applyDamageInDraft(draft, ship.uuid, { amount: 10, damageType: "fire", strikeResistance: rx.resistance, silent: true });
  await draft.commit();
  assert.equal(readStarship(ship).drones[0].deployed, false);
  assert.equal(readStarship(ship).sp.value, 4);
  assert.equal(crew.system.details.level.value, 8);
});

test("duplicate Strike receipt is rejected even if drone was redeployed", async () => {
  const { crew, ship } = await setup();
  const draft = new Draft(null);
  await stageDroneBlock(input(draft, ship, crew));
  await draft.commit();
  await patchStarship(
    ship,
    (d) => {
      d.drones[0].deployed = true;
    },
    { history: false }
  );
  await assert.rejects(() => stageDroneBlock(input(new Draft(null), ship, crew)));
  assert.equal(readStarship(ship).drones[0].deployed, true);
});

test("sheet attack prompts on damage application and protects against reapplication", async () => {
  const { crew, ship } = await setup();
  foundry.applications.api.DialogV2.prompt = async () => "automatic";
  const { makeStarshipCombat, dice } = await import("../helpers/foundry-mock.mjs");
  const { executeNativeAttack } = await import("../../scripts/chat/native-attack.mjs");
  const { rollAttackCardDamage, applyAttackCardDamage } = await import("../../scripts/chat/attack-card/service.mjs");
  const { resolveReactionResponse } = await import("../../scripts/actions/reactions.mjs");
  const attacker = makeCharacter({ id: "gunner", name: "Gunner", owners: ["p2"] });
  const firing = makeShip({
    id: "firing",
    name: "Firing",
    stations: [{ id: "gun", type: "gunnery", grade: "commercial", helmedBy: attacker.uuid, weaponId: "w1" }],
    weapons: [{ id: "w1", weaponRef: "coilgun", name: "Coilgun" }],
    crew: [{ actorUuid: attacker.uuid, role: "crew", stationId: "gun" }]
  });
  const combat = makeStarshipCombat({
    objects: [
      { key: firing.uuid, zone: 2, alwaysVisible: true },
      { key: ship.uuid, zone: 3, detection: { party: "identified" } }
    ]
  });
  game.socket.emit = (_event, msg) => {
    if (msg.kind === "event" && msg.type === "reactionPrompt")
      resolveReactionResponse({ user: game.users.get("p1"), payload: { requestId: msg.payload.requestId, use: true, droneId: "d1" } });
  };
  dice(20, 3);
  const attack = await executeNativeAttack({
    user: game.users.get("p2"),
    payload: {
      eventId: "sheet_drone_block_01",
      combatId: combat.id,
      shipUuid: firing.uuid,
      actionId: "strike",
      crewUuid: attacker.uuid,
      stationId: "gun",
      options: { sheetRoll: true, weaponId: "w1", targetKey: ship.uuid }
    }
  });
  await rollAttackCardDamage({ user: game.users.get("p2"), payload: { messageId: attack.messageId } });
  await applyAttackCardDamage({ user: game.users.get("gm"), payload: { messageId: attack.messageId } });
  assert.equal(readStarship(ship).drones[0].deployed, false);
  assert.ok(readStarship(ship).appliedStrikeReceipts.includes(`chat:${attack.messageId}`));
  await assert.rejects(() => applyAttackCardDamage({ user: game.users.get("gm"), payload: { messageId: attack.messageId } }));
  assert.equal(crew.system.details.level.value, 8);
});

test("station Strike consumes exactly the chosen drone and applies its resistance", async () => {
  const { ship } = await setup();
  foundry.applications.api.DialogV2.prompt = async () => "automatic";
  const { makeStarshipCombat, dice } = await import("../helpers/foundry-mock.mjs");
  const { executeNativeAttack } = await import("../../scripts/chat/native-attack.mjs");
  const { resolveReactionResponse } = await import("../../scripts/actions/reactions.mjs");
  const gunner = makeCharacter({ id: "gunner", name: "Gunner", owners: ["p2"] });
  const firing = makeShip({
    id: "firing",
    name: "Firing",
    stations: [{ id: "gun", type: "gunnery", grade: "commercial", helmedBy: gunner.uuid, weaponId: "w1" }],
    weapons: [{ id: "w1", weaponRef: "coilgun", name: "Coilgun" }],
    crew: [{ actorUuid: gunner.uuid, role: "crew", stationId: "gun" }]
  });
  const combat = makeStarshipCombat({
    objects: [
      { key: firing.uuid, zone: 2, alwaysVisible: true },
      { key: ship.uuid, zone: 3, detection: { party: "identified" } }
    ]
  });
  game.socket.emit = (_event, msg) => {
    if (msg.kind === "event" && msg.type === "reactionPrompt")
      resolveReactionResponse({ user: game.users.get("p1"), payload: { requestId: msg.payload.requestId, use: true, droneId: "d1" } });
  };
  dice(20, 3);
  const payload = {
    eventId: "station_drone_block_01",
    combatId: combat.id,
    shipUuid: firing.uuid,
    actionId: "strike",
    crewUuid: gunner.uuid,
    stationId: "gun",
    options: { weaponId: "w1", targetKey: ship.uuid }
  };
  await executeNativeAttack({ user: game.users.get("p2"), payload });
  const first = readStarship(ship);
  assert.equal(first.drones[0].deployed, false);
  assert.equal(first.droneBlockReceipts[0].strikeId, payload.eventId);
  assert.equal(first.sp.value, 8); // crit 1d6*2 = 6, resistance 4
  await executeNativeAttack({ user: game.users.get("p2"), payload });
  assert.equal(readStarship(ship).sp.value, first.sp.value);
});

test("mine closure is GM-only, non-destructive and idempotent", async () => {
  const { ship } = await setup();
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  await patchStarship(
    ship,
    (d) => {
      d.drones[0].mines = [{ id: "m1", droneId: "d1", shipUuid: ship.uuid, zone: 2, state: "armed" }];
    },
    { history: false }
  );
  registerShipHandlers();
  const output = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (m) => output.push(m) };
  const payload = { shipUuid: ship.uuid, stationId: "dc", droneId: "d1", mineId: "m1", resolution: "detonated" };
  const send = (who) => dispatchSocketMessage({ kind: "request", type: "closeDroneMine", requestId: who, payload }, who, env);
  await send("p1");
  assert.equal(output.at(-1).ok, false);
  assert.equal(readStarship(ship).drones[0].mines[0].state, "armed");
  await send("gm");
  assert.equal(output.at(-1).result.changed, true);
  assert.equal(readStarship(ship).drones[0].mines[0].state, "detonated");
  assert.equal(readStarship(ship).sp.value, 10);
  await send("gm");
  assert.equal(output.at(-1).result.changed, false);
  assert.equal(readStarship(ship).drones[0].mines.length, 1);
});

test("sheet mine buttons render with the correct mine, drone, station and GM visibility", async () => {
  const { ship } = await setup();
  const { buildSheetContext } = await import("../../scripts/ui/sheet/sheet-context.mjs");
  const { default: Handlebars } = await import("handlebars");
  await patchStarship(
    ship,
    (d) => {
      d.drones[0].mines = [
        { id: "m1", droneId: "d1", shipUuid: ship.uuid, zone: 2, state: "armed" },
        { id: "m2", droneId: "d1", shipUuid: ship.uuid, zone: 3, state: "removed" }
      ];
    },
    { history: false }
  );
  const h = Handlebars.create();
  h.registerHelper("localize", (k) => k);
  h.registerHelper("eq", (a, b) => a === b);
  for (const p of ["tscOccupant", "tscStationUpgrades", "tscShipUpgrades", "tscUpgradeItem"]) h.registerPartial(p, "");
  for (const file of ["crew-ship.hbs"]) h.registerPartial(`modules/sf2e-tactical-starship-combat/templates/${file}`, "");
  const ctx = await buildSheetContext({ document: ship, isNpc: false, tab: "stations", tabs: [] });
  const render = h.compile(readFileSync("templates/starship-sheet.hbs", "utf8"));
  const gm = render(ctx);
  assert.match(gm, /data-station-id="dc" data-drone-id="d1" data-mine-id="m1"/);
  assert.doesNotMatch(gm, /data-mine-id="m2"/);
  ctx.isGM = false;
  assert.doesNotMatch(render(ctx), /data-action="closeDroneMine"/);
});

test("a failed chat update cannot apply the same sheet damage twice", async () => {
  const { ship } = await setup();
  const { applyAttackCardDamage } = await import("../../scripts/chat/attack-card/service.mjs");
  const M = "sf2e-tactical-starship-combat";
  const attacker = makeShip({ id: "source", name: "Source", role: "npc" });
  const message = await ChatMessage.create({
    flags: {
      [M]: {
        attackCard: {
          native: true,
          status: "resolved",
          createdBy: "gm",
          request: { shipUuid: attacker.uuid },
          ship: { name: "Source" },
          result: { pendingDamage: { targetUuid: ship.uuid, damageType: "fire", traits: [], source: "Weapon" } },
          damageRoll: { total: 6 }
        }
      }
    }
  });
  // No deployed drone: keep the test focused on the target's durable apply receipt.
  await patchStarship(
    ship,
    (d) => {
      d.drones[0].deployed = false;
    },
    { history: false }
  );
  const update = message.update.bind(message);
  message.update = async () => {
    throw new Error("chat update failed");
  };
  await assert.rejects(
    () => applyAttackCardDamage({ user: game.users.get("gm"), payload: { messageId: message.id } }),
    /chat update failed/
  );
  const after = readStarship(ship).sp.value;
  message.update = update;
  await assert.rejects(() => applyAttackCardDamage({ user: game.users.get("gm"), payload: { messageId: message.id } }));
  assert.equal(readStarship(ship).sp.value, after);
});

test("declined reaction leaves drone and damage unchanged", async () => {
  const { ship } = await setup();
  const { resolveReactionResponse } = await import("../../scripts/actions/reactions.mjs");
  const draft = new Draft(null);
  const entry = await draft.ship(ship.uuid);
  const attacker = makeShip({ id: "source", name: "Secret Enemy", role: "npc" });
  let exposedName;
  game.socket.emit = (_event, msg) => {
    if (msg.kind === "event" && msg.type === "reactionPrompt") {
      exposedName = msg.payload.attacker;
      resolveReactionResponse({ user: game.users.get("p1"), payload: { requestId: msg.payload.requestId, use: false } });
    }
  };
  const rx = await Reactions.ask(
    { draft, tsc: null, combat: null, ship: attacker, options: {}, strikeId: "declined-strike" },
    { uuid: ship.uuid, actor: ship, data: entry.data },
    { amount: 8, traits: [], crit: false }
  );
  assert.equal(rx.resistance, undefined);
  assert.notEqual(exposedName, "Secret Enemy");
  assert.equal(entry.data.drones[0].deployed, true);
  assert.equal(entry.data.droneBlockReceipts, undefined);
});
