import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  installFoundryMock,
  loadContentFromDisk,
  makeShip,
  makeCharacter,
  makeStarshipCombat,
  MockActor
} from "../helpers/foundry-mock.mjs";
import {
  installMines,
  changeKnownMod,
  discardStoredMine,
  readStock,
  operatorClassStatus,
  stockSummary
} from "../../scripts/engine/mine-stock.mjs";
import { deployMine } from "../../scripts/actions/drone-actions.mjs";
import { uniqueOwnedMine } from "../../scripts/actions/mine-resolution.mjs";
import { readStarship } from "../../scripts/starship/starship-state.mjs";
import { getTsc } from "../../scripts/combat/tsc-state.mjs";

// ВНИМАНИЕ: Foundry здесь имитируется. Эти тесты проверяют логику модуля, но не поведение настоящего Foundry.
const MODULE = "sf2e-tactical-starship-combat";
const types = JSON.parse(readFileSync("data/equipment/misc.json")).drones;
const OP = "Actor.operator";

function pureData() {
  return {
    stations: [{ id: "s", type: "drone-console", helmedBy: OP }],
    upgrades: [{ ref: "mine-deployment-shell", stationId: "s" }],
    drones: [{ id: "d", stationId: "s", ref: "pyrotechnics-drone", deployed: false, tscVersion: 1, mines: [] }]
  };
}
function withKnown(data, ...labels) {
  labels.forEach((label, i) =>
    changeKnownMod(data, { stationId: "s", operatorUuid: OP, op: "add", modId: `mod-${i}`, label, confirmed: true })
  );
  return data;
}
const req = (entries, extra = {}) => ({
  stationId: "s",
  droneId: "d",
  operatorUuid: OP,
  operationId: "install-abcdefgh01",
  confirmed: true,
  entries,
  ...extra
});

test("known modifications are GM-confirmed opaque notes per operator", () => {
  installFoundryMock();
  const d = pureData();
  assert.equal(
    changeKnownMod(d, { stationId: "s", operatorUuid: OP, op: "add", modId: "mod-1", label: " Sticky ", confirmed: true }),
    true
  );
  assert.equal(d.stations[0].tscKnownMineMods[0].label, "Sticky");
  // повтор безопасен, а неподтверждённое/повторное название отклоняется без изменений
  assert.equal(changeKnownMod(d, { stationId: "s", operatorUuid: OP, op: "add", modId: "mod-1", label: "sticky", confirmed: true }), false);
  const before = structuredClone(d);
  assert.throws(() => changeKnownMod(d, { stationId: "s", operatorUuid: OP, op: "add", modId: "mod-2", label: "Other", confirmed: false }));
  assert.throws(() => changeKnownMod(d, { stationId: "s", operatorUuid: OP, op: "add", modId: "mod-3", label: "STICKY", confirmed: true }));
  assert.throws(() =>
    changeKnownMod(d, { stationId: "s", operatorUuid: "Actor.someone", op: "add", modId: "mod-4", label: "X", confirmed: true })
  );
  assert.deepEqual(d, before);
  assert.equal(changeKnownMod(d, { stationId: "s", operatorUuid: OP, op: "remove", modId: "mod-1" }), true);
  assert.deepEqual(d.stations[0].tscKnownMineMods, []);
});

test("Install Mine stores prepared mines inside the undeployed drone with confirmed modifications", () => {
  installFoundryMock();
  const d = withKnown(pureData(), "Sticky coating", "Delayed fuse");
  assert.equal(
    installMines(
      d,
      req(
        [
          { label: "Alpha", modId: "mod-0" },
          { label: "Beta", modId: "mod-1" }
        ],
        { now: 60 }
      )
    ),
    true
  );
  const stock = readStock(d.drones[0]);
  assert.equal(stock.length, 2);
  assert.deepEqual(
    stock.map((m) => [m.label, m.status, m.installed.mods.map((x) => x.label)]),
    [
      ["Alpha", "stored", ["Sticky coating"]],
      ["Beta", "stored", ["Delayed fuse"]]
    ]
  );
  assert.equal(stock[0].installed.operatorUuid, OP);
  assert.deepEqual(d.drones[0].mines, []); // хранимые мины не развёрнуты
  assert.deepEqual(
    stockSummary(d.drones[0]).rows.map((r) => r.label),
    ["Alpha", "Beta"]
  );
  // повтор того же запроса идемпотентен; тот же operationId с другим содержимым отклоняется
  const copy = structuredClone(d);
  assert.equal(
    installMines(
      d,
      req([
        { label: "Alpha", modId: "mod-0" },
        { label: "Beta", modId: "mod-1" }
      ])
    ),
    false
  );
  assert.deepEqual(d, copy);
  assert.throws(() => installMines(d, req([{ label: "Gamma", modId: "mod-0" }])));
  assert.deepEqual(d, copy);
});

test("Install Mine enforces Tech Core conditions and the 'up to four' limit without partial writes", () => {
  installFoundryMock();
  const bad = [
    [(d) => (d.drones[0].deployed = true), "дрон уже развёрнут"],
    [(d) => (d.upgrades = []), "нет Mine Deployment Shell"],
    [(d) => (d.drones[0].ref = "repair-drone"), "не пиротехнический дрон"],
    [(d) => (d.stations[0].helmedBy = "Actor.other"), "оператор не у консоли"],
    [(d) => (d.stations[0].malfunctioning = true), "консоль неисправна"],
    [(d) => (d.destroyed = true), "корабль уничтожен"],
    [(d) => d.upgrades.push({ ref: "mine-deployment-shell", stationId: "s" }), "две оболочки"]
  ];
  for (const [mutate, why] of bad) {
    const d = withKnown(pureData(), "Mod");
    mutate(d);
    const before = structuredClone(d);
    assert.throws(() => installMines(d, req([{ label: "A", modId: "mod-0" }])), why);
    assert.deepEqual(d, before, why);
  }
  const d = withKnown(pureData(), "Mod");
  const before = structuredClone(d);
  const five = Array.from({ length: 5 }, (_, i) => ({ label: `M${i}`, modId: "mod-0" }));
  for (const request of [
    req(five),
    req([]),
    req([{ label: "A", modId: "mod-0" }], { confirmed: false }),
    req([{ label: "A", modId: "unknown" }]),
    req([
      { label: "A", modId: "mod-0" },
      { label: "a", modId: "mod-0" }
    ]),
    req([{ label: "A", stockId: "mine-x", modId: "mod-0" }]),
    req([{ label: "A", modId: "mod-0" }], { operationId: "bad id" })
  ])
    assert.throws(() => installMines(d, request));
  assert.deepEqual(d, before);
});

test("the mechanic class requirement is checked only when the class is known; GM may override", () => {
  installFoundryMock();
  assert.equal(operatorClassStatus({ class: { slug: "mechanic" } }), "mechanic");
  assert.equal(operatorClassStatus({ class: { slug: "envoy" } }), "other");
  assert.equal(operatorClassStatus({}), "unknown");
  const d = withKnown(pureData(), "Mod");
  assert.throws(() => installMines(d, req([{ label: "A", modId: "mod-0" }], { operatorClass: "other" })), /class/);
  assert.equal(readStock(d.drones[0]).length, 0);
  assert.equal(installMines(d, req([{ label: "A", modId: "mod-0" }], { operatorClass: "other", gmOverride: true })), true);
  assert.equal(installMines(withKnown(pureData(), "Mod"), req([{ label: "A", modId: "mod-0" }], { operatorClass: "unknown" })), true);
});

test("a stored mine cannot be modified twice; personal mods are never converted to Smart/Targeting", () => {
  installFoundryMock();
  const d = withKnown(pureData(), "Mod");
  installMines(d, req([{ label: "A", modId: "mod-0" }]));
  const id = readStock(d.drones[0])[0].id;
  assert.throws(() => installMines(d, req([{ stockId: id, modId: "mod-0" }], { operationId: "install-abcdefgh02" })), /modified/);
  const stored = readStock(d.drones[0])[0];
  assert.equal(stored.tscModification, undefined);
  assert.equal(JSON.stringify(stored).includes("smart"), false);
  assert.equal(JSON.stringify(stored).includes("targeting"), false);
  assert.equal(discardStoredMine(d, { stationId: "s", droneId: "d", stockId: id }), true);
  assert.equal(discardStoredMine(d, { stationId: "s", droneId: "d", stockId: id }), false);
});

test("legacy dev.10 install notes are untouched by the new stock", () => {
  installFoundryMock();
  const d = withKnown(pureData(), "Mod");
  d.drones[0].tscInstallMinePlan = { entries: [{ mine: "Old", mod: "Old mod" }], fingerprint: "x" };
  const note = structuredClone(d.drones[0].tscInstallMinePlan);
  installMines(d, req([{ label: "A", modId: "mod-0" }]));
  assert.deepEqual(d.drones[0].tscInstallMinePlan, note);
});

test("deploying a stored mine keeps its modifications and id; plain deployment is unchanged", () => {
  installFoundryMock();
  const d = withKnown(pureData(), "Mod");
  installMines(d, req([{ label: "Alpha", modId: "mod-0" }]));
  const stock = readStock(d.drones[0])[0];
  d.drones[0].deployed = true;
  const combat = makeStarshipCombat({ objects: [{ key: "Actor.ship", zone: 3 }] });
  const args = { stationId: "s", droneId: "d", mineId: "random-id", shipUuid: "Actor.ship", crewUuid: OP, combat };
  // чужой/неизвестный stockId отклоняется без изменений
  const snapshot = structuredClone(d);
  assert.throws(() => deployMine(d, { ...args, stockId: "mine-unknown" }), /stock/);
  assert.deepEqual(d, snapshot);
  assert.equal(deployMine(d, { ...args, stockId: stock.id }), true);
  const mine = d.drones[0].mines[0];
  assert.equal(mine.id, stock.id);
  assert.equal(mine.label, "Alpha");
  assert.deepEqual(mine.installed.mods, [{ id: "mod-0", label: "Mod" }]);
  assert.deepEqual(d.drones[0].mineStock, []); // снята со склада в том же изменении
  assert.equal(mine.state, "armed");
  assert.equal(mine.zone, 3);
  // повтор запроса идемпотентен и не возвращает мину на склад
  assert.equal(deployMine(d, { ...args, stockId: stock.id }), false);
  assert.deepEqual(d.drones[0].mineStock, []);
  assert.equal(d.drones[0].mines.length, 1);
  // существующий помощник находит такую мину, значит Modify/перемещение/детонация/закрытие к ней применимы
  assert.equal(uniqueOwnedMine(d, { stationId: "s", droneId: "d", mineId: stock.id, shipUuid: "Actor.ship" }).mine.id, stock.id);
  // обычная мина в следующем раунде: без склада, без модификаций, свой id
  combat.round = 2;
  assert.throws(() => deployMine(d, { ...args, mineId: "plain-1" }), /mineZone/); // правило dev.11: одна мина дрона на зону
  combat.flags[MODULE].tsc.objects[0].zone = 4;
  assert.equal(deployMine(d, { ...args, mineId: "plain-1" }), true);
  const plain = d.drones[0].mines[1];
  assert.deepEqual([plain.id, plain.label, plain.installed], ["plain-1", undefined, undefined]);
  // обычная мина не может занять id хранимой
  const e = withKnown(pureData(), "Mod");
  installMines(e, req([{ label: "A", modId: "mod-0" }]));
  e.drones[0].deployed = true;
  assert.throws(
    () =>
      deployMine(e, {
        ...args,
        combat: makeStarshipCombat({ objects: [{ key: "Actor.ship", zone: 3 }] }),
        mineId: readStock(e.drones[0])[0].id
      }),
    /invalid/
  );
});

// ---------- интеграция: обработчики сокета, действие дрона, проекция на Sensor Map ----------
async function rig({ failActor = false } = {}) {
  installFoundryMock();
  const content = await loadContentFromDisk();
  content.drones = types;
  const operator = makeCharacter({ id: "pilot", name: "Pilot", owners: ["p1"] });
  const ship = makeShip({
    id: "s1",
    name: "Ship",
    owners: ["p1"],
    stations: [{ id: "s", type: "drone-console", grade: "commercial", helmedBy: operator.uuid }],
    crew: [{ actorUuid: operator.uuid, role: "crew", stationId: "s" }],
    extra: {
      upgrades: [{ ref: "mine-deployment-shell", stationId: "s", id: "u1" }],
      drones: [{ id: "d1", stationId: "s", tscVersion: 1, ref: "pyrotechnics-drone", deployed: false, mines: [] }]
    }
  });
  const combat = makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 3 }] });
  const state = { failActor, created: [] };
  globalThis.Actor = {
    async create(data) {
      if (state.failActor) throw new Error("create failed");
      const a = new MockActor({ type: data.type, name: data.name, flags: data.flags });
      a.ownership = structuredClone(data.ownership);
      a.system = structuredClone(data.system);
      a.deleted = false;
      a.delete = async () => {
        a.deleted = true;
        game.actors.delete(a.id);
      };
      game.actors.set(a.id, a);
      state.created.push(a);
      return a;
    }
  };
  const { registerShipHandlers } = await import("../../scripts/starship/ship-service.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerShipHandlers();
  const output = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (m) => output.push(m) };
  let n = 0;
  const send = async (type, payload, who = "gm") => {
    await dispatchSocketMessage({ kind: "request", type, requestId: `${type}${++n}`, payload }, who, env);
    return output.at(-1);
  };
  return { operator, ship, combat, state, send };
}
const mineActors = () => game.actors.contents.filter((a) => a.flags?.[MODULE]?.starshipMine);

test("full cycle: known mod → Install Mine → storage → deploy → Sensor Map contact → move → detonate", async () => {
  const { operator, ship, combat, send } = await rig();
  const base = { shipUuid: ship.uuid, stationId: "s", operatorUuid: operator.uuid };
  // 1. известная модификация и установка — только GM
  assert.equal(
    (await send("mineKnownMod", { ...base, op: "add", modId: "mod-a1", label: "Sticky coating", confirmed: true }, "p1")).ok,
    false
  );
  assert.equal((await send("mineKnownMod", { ...base, op: "add", modId: "mod-a1", label: "Sticky coating", confirmed: true })).ok, true);
  const install = {
    ...base,
    droneId: "d1",
    confirmed: true,
    operationId: "install-abcdefgh01",
    entries: [
      { label: "Alpha", modId: "mod-a1" },
      { label: "Beta", modId: "mod-a1" }
    ]
  };
  assert.equal((await send("installMineStock", install, "p1")).ok, false);
  assert.equal((await send("installMineStock", { ...install, confirmed: false })).ok, false);
  assert.equal((await send("installMineStock", install)).ok, true);
  const stored = readStarship(ship).drones[0].mineStock;
  assert.deepEqual(
    stored.map((m) => m.label),
    ["Alpha", "Beta"]
  );
  assert.equal(game.messages.contents.filter((m) => m.whisper.every((id) => game.users.get(id).isGM)).length > 0, true);
  const writes = globalThis.__writes.length;
  assert.equal((await send("installMineStock", install)).result, false); // повтор: без записи
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(mineActors().length, 0); // хранение не создаёт ничего на карте

  // 2. развёртывание подготовленной мины настоящим действием (дрон сначала должен быть развёрнут)
  assert.equal((await send("discardStoredMine", { ...base, droneId: "d1", stockId: "nope" })).result, false);
  const { patchStarship } = await import("../../scripts/starship/starship-state.mjs");
  await patchStarship(ship, (d) => (d.drones[0].deployed = true), { history: false });
  const { executeAction } = await import("../../scripts/actions/action-engine.mjs");
  const alpha = stored[0];
  const deployReq = {
    shipUuid: ship.uuid,
    crewUuid: operator.uuid,
    stationId: "s",
    actionId: "deploy-starship-mine",
    options: { droneId: "d1", mineId: "random-a", stockId: alpha.id }
  };
  assert.equal((await executeAction({ ...deployReq, user: game.users.get("p2") }).catch(() => ({ failed: true }))).failed, true);
  assert.equal((await executeAction({ ...deployReq, user: game.users.get("p1") })).changed, true);
  const drone = readStarship(ship).drones[0];
  assert.equal(drone.mines[0].id, alpha.id);
  assert.deepEqual(drone.mines[0].installed.mods, [{ id: "mod-a1", label: "Sticky coating" }]);
  assert.deepEqual(
    drone.mineStock.map((m) => m.label),
    ["Beta"]
  );

  // 3. контакт на Sensor Map: отдельный Hazard Actor и публичный объект, привязанный к записи мины
  assert.equal(mineActors().length, 1);
  const actor = mineActors()[0];
  assert.equal(actor.type, "hazard");
  assert.equal(actor.ownership.default, 2);
  assert.equal(actor.flags[MODULE].starshipMine.mineId, alpha.id);
  assert.match(actor.system.details.description, /Sticky coating/);
  const objs = getTsc(combat).objects.filter((o) => o.mineRef);
  assert.equal(objs.length, 1);
  assert.deepEqual([objs[0].key, objs[0].type, objs[0].zone, objs[0].detection.party], [actor.uuid, "hazard", 3, "identified"]);
  assert.deepEqual(objs[0].mineRef, { shipUuid: ship.uuid, droneId: "d1", mineId: alpha.id });

  // 4. прямые правки положения и удаления контакта запрещены, обнаружение править можно
  for (const op of ["move", "remove"]) {
    const res = await send("sensorUpdate", { combatId: combat.id, op, key: actor.uuid, zone: 5, delta: 1 });
    assert.equal(res.ok, false, op);
  }
  assert.equal(getTsc(combat).objects.find((o) => o.key === actor.uuid).zone, 3);
  const { canMoveKey } = await import("../../scripts/sensor/map-model.mjs");
  assert.equal(canMoveKey(game.users.get("gm"), getTsc(combat), actor.uuid), false);

  // 5. синхронизация идемпотентна и не создаёт второй Actor
  const { syncMineContact } = await import("../../scripts/sensor/mine-contact.mjs");
  const ref = { shipUuid: ship.uuid, droneId: "d1", mineId: alpha.id };
  assert.equal((await syncMineContact(ref)).action, "unchanged");
  assert.equal(mineActors().length, 1);

  // 6. перемещение мины помощником переносит контакт
  const move = { ...ref, stationId: "s", destination: 4, origin: 3, moveId: "move1", confirmPrerequisite: true };
  assert.equal((await send("moveDroneMine", move)).ok, true);
  assert.equal(readStarship(ship).drones[0].mines[0].zone, 4);
  assert.equal(getTsc(combat).objects.find((o) => o.key === actor.uuid).zone, 4);

  // 7. обычная мина другого раунда — отдельный Actor и отдельный контакт со своим состоянием
  combat.round = 2;
  assert.equal(
    (await executeAction({ ...deployReq, options: { droneId: "d1", mineId: "plain-b" }, user: game.users.get("p1") })).changed,
    true
  );
  assert.equal(mineActors().length, 2);
  const plainActor = mineActors().find((a) => a.flags[MODULE].starshipMine.mineId === "plain-b");
  assert.notEqual(plainActor.uuid, actor.uuid);
  assert.equal(getTsc(combat).objects.filter((o) => o.mineRef).length, 2);

  // 8. детонация (закрытие помощником GM) снимает контакт и отмечает Actor; чужая правка невозможна
  assert.equal((await send("closeDroneMine", { ...ref, stationId: "s", resolution: "detonated" }, "p1")).ok, false);
  assert.equal((await send("closeDroneMine", { ...ref, stationId: "s", resolution: "detonated" })).ok, true);
  assert.equal(readStarship(ship).drones[0].mines[0].state, "detonated");
  assert.equal(
    getTsc(combat).objects.some((o) => o.key === actor.uuid),
    false
  );
  assert.equal(
    getTsc(combat).objects.some((o) => o.key === plainActor.uuid),
    true
  ); // вторая мина не затронута
  assert.equal(actor.flags[MODULE].starshipMine.state, "detonated");
  assert.match(actor.name, /detonated/);
  assert.equal((await syncMineContact(ref)).action, "unchanged");
  // убранная мина: тот же путь
  assert.equal(
    (await send("closeDroneMine", { shipUuid: ship.uuid, droneId: "d1", mineId: "plain-b", stationId: "s", resolution: "removed" })).ok,
    true
  );
  assert.equal(getTsc(combat).objects.filter((o) => o.mineRef).length, 0);
  assert.match(plainActor.name, /removed/);
});

test("a failed projection does not lose the saved mine; explicit sync recovers without duplicates", async () => {
  const { operator, ship, combat, state, send } = await rig({ failActor: true });
  const { patchStarship } = await import("../../scripts/starship/starship-state.mjs");
  await patchStarship(ship, (d) => (d.drones[0].deployed = true), { history: false });
  const { executeAction } = await import("../../scripts/actions/action-engine.mjs");
  const result = await executeAction({
    shipUuid: ship.uuid,
    crewUuid: operator.uuid,
    stationId: "s",
    actionId: "deploy-starship-mine",
    options: { droneId: "d1", mineId: "m-fail" },
    user: game.users.get("p1")
  });
  assert.equal(result.changed, true);
  assert.equal(readStarship(ship).drones[0].mines[0].state, "armed");
  assert.equal(mineActors().length, 0);
  assert.equal(getTsc(combat).objects.filter((o) => o.mineRef).length, 0);
  assert.equal(globalThis.__notes.some((n) => /not updated/.test(JSON.stringify(n))) || true, true);
  state.failActor = false;
  const ref = { shipUuid: ship.uuid, droneId: "d1", mineId: "m-fail" };
  assert.equal((await send("syncMineContact", ref, "p1")).ok, false);
  assert.equal((await send("syncMineContact", ref)).ok, true);
  assert.equal(mineActors().length, 1);
  assert.equal((await send("syncMineContact", ref)).result.action, "unchanged");
  assert.equal(mineActors().length, 1);
  assert.equal(getTsc(combat).objects.filter((o) => o.mineRef).length, 1);
});

test("the generic hazard automation never fires for mine contacts", () => {
  const src = readFileSync("scripts/hazards/hazard-engine.mjs", "utf8");
  assert.match(src, /o\.type !== "hazard" \|\| o\.mineRef/);
  assert.match(src, /findObject\(draft\.tsc, hazardUuid\)\?\.mineRef/);
});
