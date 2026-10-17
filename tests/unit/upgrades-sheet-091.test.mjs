import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const flag = (a) => a.flags[M].starship;

async function setup() {
  installFoundryMock();
  await loadContentFromDisk();
  const socket = await import("../../scripts/socket.mjs");
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const emitted = [];
  const send = async (userId, type, payload) => {
    await socket.dispatchSocketMessage({ kind: "request", type, requestId: `r${emitted.length}`, payload }, userId, {
      users: game.users,
      selfId: "gm",
      isActiveGM: true,
      clientEvents: new Map(),
      emit: (m) => emitted.push(m)
    });
    return emitted.at(-1);
  };
  return { send };
}

test("stationUpgrade handler: install, persist stable ids, capacity for players, GM override, remove", async () => {
  const { send } = await setup();
  const ship = makeShip({
    id: "s1",
    name: "Sunrise",
    owners: ["p1"],
    level: 10,
    stations: [
      { id: "gen-1", type: "generator", grade: "tactical" },
      { id: "pilot-1", type: "pilot", grade: "commercial" }
    ]
  });
  let r = await send("p1", "stationUpgrade", { shipUuid: ship.uuid, op: "add", key: "gravity-toggle", stationId: "gen-1" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const rec = flag(ship).upgrades[0];
  assert.equal(rec.ref, "gravity-toggle");
  assert.equal(rec.stationId, "gen-1");
  assert.equal(rec.name, "Gravity Toggle");
  r = await send("p1", "stationUpgrade", { shipUuid: ship.uuid, op: "add", key: "tractor-beam", stationId: "gen-1", override: true });
  assert.equal(r.ok, false, "player cannot exceed capacity");
  r = await send("p1", "stationUpgrade", { shipUuid: ship.uuid, op: "add", key: "powerful-thrusters", stationId: "pilot-1" });
  assert.equal(r.ok, false, "commercial pilot console has no slots");
  r = await send("p1", "equipment", {
    shipUuid: ship.uuid,
    list: "upgrades",
    op: "add",
    item: { id: "x", ref: "tractor-beam", name: "Tractor Beam" }
  });
  assert.equal(r.ok, false, "raw list add is GM only");
  r = await send("p2", "stationUpgrade", { shipUuid: ship.uuid, op: "add", key: "tractor-beam", stationId: "gen-1" });
  assert.equal(r.ok, false, "no permission");
  r = await send("gm", "stationUpgrade", { shipUuid: ship.uuid, op: "add", key: "tractor-beam", stationId: "gen-1", override: true });
  assert.equal(r.ok, true);
  assert.equal(flag(ship).upgrades.length, 2);
  assert.equal(flag(ship).upgrades[1].override, true);
  r = await send("p1", "stationUpgrade", { shipUuid: ship.uuid, op: "add", key: "telepod", stationId: null });
  assert.equal(r.ok, true);
  assert.equal(flag(ship).upgrades[2].stationId, null);
  await send("gm", "removeStation", { shipUuid: ship.uuid, stationId: "gen-1" });
  assert.equal(flag(ship).upgrades.length, 3, "removing a station keeps its upgrades");
  assert.ok(
    flag(ship)
      .upgrades.slice(0, 2)
      .every((u) => u.stationId === null)
  );
  r = await send("p1", "stationUpgrade", { shipUuid: ship.uuid, op: "remove", id: flag(ship).upgrades[0].id });
  assert.equal(r.ok, true);
  assert.equal(flag(ship).upgrades.length, 2);
});

test("sheet views: used/capacity, warnings, remembered open details, localized EN and RU", async () => {
  for (const lang of ["en", "ru"]) {
    installFoundryMock({ lang });
    await loadContentFromDisk();
    const ci = await import("../../scripts/content/content-i18n.mjs");
    ci.setContentTranslations(
      lang,
      lang === "ru" ? JSON.parse(fs.readFileSync(path.join(root, "lang/content/ru.json"), "utf8")).strings : {}
    );
    const { stationUpgradeView, shipUpgradeView } = await import("../../scripts/ui/sheet/sheet-upgrades.mjs");
    const data = {
      level: 2,
      stations: [{ id: "gen-1", name: "Generator", type: "generator", grade: "commercial" }],
      upgrades: [
        { id: "u1", ref: "tractor-beam", variant: null, stationId: "gen-1" },
        { id: "u2", ref: "telepod", variant: null, stationId: null },
        { id: "u3", ref: "gone", variant: null, stationId: "nope" }
      ]
    };
    const sheet = { _openUpgrades: new Set(["u1"]) };
    const v = stationUpgradeView(sheet, data, data.stations[0], { isGM: false, canEdit: true });
    assert.deepEqual([v.capacity, v.used, v.over, v.canInstall], [0, 1, true, false]);
    assert.equal(v.items[0].open, true);
    assert.ok(v.items[0].html.includes(lang === "en" ? "Pull Starship" : "Притянуть звездолёт"));
    assert.ok(v.items[0].warnings.some((w) => w.text.includes(lang === "en" ? "above the ship level" : "выше уровня корабля")));
    assert.ok(v.compatible.length && v.compatible.every((o) => !o.override));
    const s = shipUpgradeView(sheet, data, { isGM: true, canEdit: true });
    assert.equal(s.pods.length, 1);
    assert.equal(s.unassigned.length, 1);
    assert.ok(s.unassigned[0].warnings[0].text.includes("gone"));
    if (lang === "ru") assert.equal(v.items[0].name, "Притягивающий луч");
  }
});

test("content dictionary: versioned, uncached URL; ru-RU falls back to ru", async () => {
  installFoundryMock({ lang: "ru" });
  game.modules.set(M, { version: "9.9.9" });
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push([url, opts]);
    return { ok: true, json: async () => ({ strings: { "Tractor Beam": "Притягивающий луч" } }) };
  };
  try {
    const ci = await import("../../scripts/content/content-i18n.mjs");
    assert.equal(await ci.loadContentTranslations("ru-RU"), 1);
    assert.equal(calls[0][0], `modules/${M}/lang/content/ru.json?v=9.9.9`);
    assert.equal(calls[0][1].cache, "no-cache");
    assert.equal(ci.ct("Tractor Beam"), "Притягивающий луч");
  } finally {
    globalThis.fetch = prev;
  }
});
