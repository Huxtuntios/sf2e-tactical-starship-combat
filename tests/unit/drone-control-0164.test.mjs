import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changeDrone } from "../../scripts/engine/drone-state.mjs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { weaponSummary } from "../../scripts/ui/weapon-summary.mjs";
const definition = JSON.parse(readFileSync("data/stations/stations.json")).stations.find((s) => s.id === "drone-console");
const droneTypes = JSON.parse(readFileSync("data/equipment/misc.json")).drones;
const env = { definition, droneTypes, worldTime: 100 };
const input = { stationId: "d", id: "drone-1", ref: "repair-drone" };
const fresh = () => ({ stations: [{ id: "d", type: "drone-console", grade: "commercial" }], drones: [] });

test("индивидуальный учёт, повторы, срок, сохранение лишних полей", () => {
  const d = fresh();
  assert.equal(changeDrone(d, "add", input, env), true);
  assert.equal(changeDrone(d, "add", input, env), false);
  d.drones[0].custom = { important: true };
  assert.equal(changeDrone(d, "deploy", input, env), true);
  assert.equal(changeDrone(d, "deploy", input, env), false);
  assert.equal(changeDrone(d, "retrieve", input, env), true);
  assert.equal(changeDrone(d, "retrieve", input, env), false);
  assert.deepEqual(d.drones[0].custom, { important: true });
  d.drones[0].availableAt = 101;
  assert.throws(() => changeDrone(d, "deploy", input, env), /cooldown/);
  assert.equal(changeDrone(d, "deploy", input, { ...env, worldTime: 101 }), true);
});
test("вместимость, старые записи и неверные команды", () => {
  const d = fresh();
  d.drones.push({ id: "legacy", custom: true });
  assert.throws(() => changeDrone(d, "add", input, env), /capacity/);
  assert.deepEqual(d.drones, [{ id: "legacy", custom: true }]);
  assert.throws(() => changeDrone(d, "deploy", { ...input, id: "legacy" }, env), /legacy/);
  assert.throws(() => changeDrone(fresh(), "add", { ...input, ref: "fiction" }, env), /invalid/);
  assert.throws(() => changeDrone(fresh(), "other", input, env), /invalid/);
  const malformed = fresh();
  malformed.drones = { old: true };
  assert.throws(() => changeDrone(malformed, "add", input, env), /legacy/);
  assert.deepEqual(malformed.drones, { old: true });
});
test("одновременные сокетные запросы, права и повтор без записи", async () => {
  installFoundryMock();
  const content = await loadContentFromDisk();
  content.drones = droneTypes;
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerShipHandlers();
  (await import("../../scripts/actions/action-engine.mjs")).registerActionHandlers();
  makeStarshipCombat();
  const actor = makeCharacter({ id: "pilot", name: "Pilot", owners: ["p1"] });
  const ship = makeShip({
    id: "s",
    name: "Ship",
    owners: ["p1"],
    stations: [{ id: "d", type: "drone-console", grade: "commercial", helmedBy: actor.uuid }],
    crew: [{ actorUuid: actor.uuid, role: "crew", stationId: "d" }]
  });
  const send = async (user, type, payload) => {
    let reply;
    await dispatchSocketMessage({ kind: "request", type, requestId: "x", payload }, user, {
      users: game.users,
      selfId: "gm",
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (r) => {
        reply = r;
      }
    });
    return reply;
  };
  const base = { shipUuid: ship.uuid, ...input };
  const results = await Promise.all([
    send("p1", "droneState", { ...base, op: "add" }),
    send("p1", "droneState", { ...base, id: "drone-2", op: "add" })
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(ship.flags["sf2e-tactical-starship-combat"].starship.drones.length, 1);
  const action = { shipUuid: ship.uuid, stationId: "d", actionId: "deploy-drone", crewUuid: actor.uuid, options: { droneId: "drone-1" } };
  assert.equal((await send("p2", "executeAction", action)).ok, false);
  assert.equal((await send("p1", "equipment", { shipUuid: ship.uuid, list: "drones", op: "add", item: {} })).ok, false);
  assert.equal((await send("p1", "executeAction", action)).ok, true);
  const writes = globalThis.__writes.length;
  const messages = game.messages.size;
  const { historyEntries } = await import("../../scripts/history/history.mjs");
  const historyCount = historyEntries(ship.uuid).length;
  assert.equal((await send("p1", "executeAction", action)).ok, true);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
  assert.equal(historyEntries(ship.uuid).length, historyCount);
});
test("оружие: тип и владение не выводятся из категории", () => {
  installFoundryMock();
  let result = weaponSummary({ id: "w", name: "W", die: "2d8", damageType: ["fire", "piercing"], category: "advanced", itemLevel: 3 });
  assert.match(result.option, /2d8/);
  assert.match(result.damageTypes, /fire/i);
  assert.equal(result.rank, "Not specified");
  result = weaponSummary({ name: "W", requiredProficiency: "expert" });
  assert.equal(result.rank, "Expert");
  assert.equal(result.damageTypes, "Not specified");
});

test("несколько проверок и исходный энричер обрабатываются независимо", async () => {
  const { linkInline } = await import("../../scripts/content/inline-links.mjs");
  const { checkLinksHTML } = await import("../../scripts/content/inline-checks.mjs");
  const text = "@Check[will|dc:20]{Will} and DC 15 Reflex save; 2d6 fire damage; frightened 2.";
  const linked = linkInline(text);
  assert.match(linked, /@Check\[will\|dc:20\]/);
  assert.match(linked, /@Check\[reflex\|dc:15\]/);
  assert.match(linked, /@Damage\[2d6\[fire\]\]/);
  assert.equal(linkInline(linked), linked);
  const html = checkLinksHTML(text);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /role="button"/);
});

test("повторное подключение ссылок и клавиатура не дублируют отправку", async () => {
  installFoundryMock();
  const { wireInlineClicks } = await import("../../scripts/ui/inline-clicks.mjs");
  const listeners = new Map();
  const root = {
    dataset: {},
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (name, fn) => {
      assert.equal(listeners.has(name), false);
      listeners.set(name, fn);
    }
  };
  wireInlineClicks(root);
  wireInlineClicks(root);
  let executed;
  const link = {
    dataset: { check: "will|dc:20", label: "Will" },
    classList: { contains: () => false },
    click: () => {
      executed = listeners.get("click")({ target: { closest: () => link }, preventDefault() {}, stopPropagation() {} });
    }
  };
  listeners.get("keydown")({ target: { closest: () => link }, key: "Enter", repeat: false, preventDefault() {} });
  await executed;
  assert.equal(game.messages.size, 1);
  listeners.get("keydown")({ target: { closest: () => link }, key: "Enter", repeat: true, preventDefault() {} });
  assert.equal(game.messages.size, 1);
});

test("станционное действие меняет состояние и поддерживает безопасный Undo", async () => {
  installFoundryMock();
  const content = await loadContentFromDisk();
  content.drones = droneTypes;
  makeStarshipCombat();
  const actor = makeCharacter({ id: "pilot", name: "Pilot", owners: ["p1"] });
  const ship = makeShip({
    id: "s",
    name: "Ship",
    owners: ["p1"],
    stations: [{ id: "d", type: "drone-console", grade: "commercial", helmedBy: actor.uuid }],
    crew: [{ actorUuid: actor.uuid, role: "crew", stationId: "d" }],
    extra: { drones: [{ id: "drone-1", ref: "repair-drone", stationId: "d", tscVersion: 1, deployed: false }] }
  });
  const { executeAction } = await import("../../scripts/actions/action-engine.mjs");
  const { historyEntries, undoChange, reversible } = await import("../../scripts/history/history.mjs");
  const req = {
    user: game.users.get("p1"),
    shipUuid: ship.uuid,
    crewUuid: actor.uuid,
    stationId: "d",
    actionId: "deploy-drone",
    options: { droneId: "drone-1" }
  };
  const result = await executeAction(req);
  assert.equal(result.changed, true);
  assert.equal(ship.flags["sf2e-tactical-starship-combat"].starship.drones[0].deployed, true);
  const record = historyEntries(ship.uuid)[0];
  assert.equal(record.flags["sf2e-tactical-starship-combat"].history.undoable, true);
  await undoChange(record.id);
  assert.equal(ship.flags["sf2e-tactical-starship-combat"].starship.drones[0].deployed, false);
  const a = { drones: [{ id: "x", tscVersion: 1, deployed: false, mines: [] }] };
  const b = { drones: [{ id: "x", tscVersion: 1, deployed: true, mines: [{ id: "mine" }] }] };
  assert.equal(reversible(a, b), false);
});
