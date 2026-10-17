import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

async function scenario({ combat = true } = {}) {
  installFoundryMock();
  await loadContentFromDisk();
  const si = await import("../../scripts/crew/station-items.mjs");
  const ava = makeCharacter({ id: "ava", name: "Ava", owners: ["p1"] });
  const ship = makeShip({
    id: "aurora",
    name: "Aurora",
    role: "player",
    stations: [
      { id: "pilot-1", type: "pilot", name: "Pilot", grade: "commercial", helmedBy: "Actor.ava" },
      { id: "gunnery-1", type: "gunnery", name: "Gunnery", grade: "commercial", helmedBy: null }
    ],
    crew: [{ actorUuid: "Actor.ava", name: "Ava", role: "crew", stationId: "pilot-1", userId: "p1" }]
  });
  const c = combat ? makeStarshipCombat({ objects: [{ key: ship.uuid, zone: 2 }] }) : null;
  return { si, ava, ship, combat: c };
}
const stationItems = (a) => a.items.filter((i) => i.flags?.[M]?.stationAction);

test("cost → sf2e action type", async () => {
  const { si } = await scenario({ combat: false });
  assert.deepEqual(si.actionTypeFor(1), { actionType: "action", actions: 1 });
  assert.deepEqual(si.actionTypeFor([1, 3]), { actionType: "action", actions: 1 });
  assert.deepEqual(si.actionTypeFor(5), { actionType: "action", actions: 3 });
  assert.deepEqual(si.actionTypeFor("reaction"), { actionType: "reaction", actions: null });
  assert.deepEqual(si.actionTypeFor("free"), { actionType: "free", actions: null });
});

test("station actions are created on the character sheet as sf2e action items during combat", async () => {
  const s = await scenario();
  await s.si.syncStationItems();
  const items = stationItems(s.ava);
  assert.ok(items.length > 0, "pilot actions added");
  for (const it of items) {
    assert.equal(it.type, "action");
    assert.ok(["action", "reaction", "free"].includes(it.system.actionType.value));
    assert.equal(it.flags[M].stationAction.stationId, "pilot-1");
    assert.match(it.system.description.value, /class="tsc-run-action"/);
    assert.match(it.img, /icons\/actions\//);
  }
  const n = items.length;
  await s.si.syncStationItems();
  assert.equal(stationItems(s.ava).length, n, "idempotent: no duplicates");
});

test("changing the station swaps the items; leaving removes them; ending the combat removes all", async () => {
  const s = await scenario();
  await s.si.syncStationItems();
  const pilotIds = stationItems(s.ava)
    .map((i) => i.flags[M].stationAction.actionId)
    .sort();
  const d = s.ship.flags[M].starship;
  d.stations[0].helmedBy = null;
  d.stations[1].helmedBy = "Actor.ava";
  await s.ship.update({ [`flags.${M}.starship`]: d });
  await s.si.syncStationItems();
  const now = stationItems(s.ava);
  assert.ok(now.length > 0 && now.every((i) => i.flags[M].stationAction.stationId === "gunnery-1"));
  assert.notDeepEqual(now.map((i) => i.flags[M].stationAction.actionId).sort(), pilotIds);
  d.stations[1].helmedBy = null;
  await s.ship.update({ [`flags.${M}.starship`]: d });
  await s.si.syncStationItems();
  assert.equal(stationItems(s.ava).length, 0);
  d.stations[0].helmedBy = "Actor.ava";
  await s.ship.update({ [`flags.${M}.starship`]: d });
  await s.si.syncStationItems();
  assert.ok(stationItems(s.ava).length > 0);
  game.combats.delete(s.combat.id);
  if (game.combat === s.combat) game.combat = null;
  await s.si.syncStationItems();
  assert.equal(stationItems(s.ava).length, 0, "combat over → removed");
});

test("no combat → no items; only the active GM writes; other items are untouched", async () => {
  const s = await scenario({ combat: false });
  await s.ava.createEmbeddedDocuments("Item", [{ name: "Own action", type: "action", system: {} }]);
  await s.si.syncStationItems();
  assert.equal(stationItems(s.ava).length, 0);
  assert.equal(s.ava.items.filter((i) => i.name === "Own action").length, 1);
  game.user = game.users.get("p1");
  assert.equal(await s.si.syncStationItems(), null, "players never write");
});

test("plan: duplicates and stale items removed, missing created", async () => {
  const { si } = await scenario({ combat: false });
  const f = (id, a, tags = ["starship"]) => ({
    id,
    system: { traits: { otherTags: tags, value: tags } },
    flags: { [M]: { stationAction: { shipUuid: "S", stationId: "p", actionId: a } } }
  });
  const plan = si.planStationItems(
    [f("1", "a"), f("2", "a"), f("3", "old")],
    [
      { shipUuid: "S", stationId: "p", actionId: "a" },
      { shipUuid: "S", stationId: "p", actionId: "b" }
    ]
  );
  assert.deepEqual(plan.remove.sort(), ["2", "3"]);
  assert.deepEqual(
    plan.create.map((d) => d.actionId),
    ["b"]
  );
});

test("0.10.1: station items made before the starship tag existed are replaced, not kept", async () => {
  const { si } = await scenario({ combat: false });
  const old = {
    id: "1",
    system: { traits: { otherTags: [] } },
    flags: { [M]: { stationAction: { shipUuid: "S", stationId: "p", actionId: "a" } } }
  };
  const plan = si.planStationItems([old], [{ shipUuid: "S", stationId: "p", actionId: "a" }]);
  assert.deepEqual(plan.remove, ["1"]);
  assert.deepEqual(
    plan.create.map((d) => d.actionId),
    ["a"]
  );
  assert.deepEqual(
    si.stationItemData({
      shipUuid: "S",
      stationId: "p",
      actionId: "strike",
      stationName: "Gunnery",
      action: { id: "strike", name: "Strike", cost: 1, traits: [] }
    }).system.traits.otherTags,
    ["starship"]
  );
});

test("0.6.0 UI: no go-to-station / set-location buttons, no action pool or counters, no map markers", () => {
  for (const f of ["templates/starship-sheet.hbs", "templates/crew-panel.hbs", "templates/station-hud.hbs"]) {
    const s = read(f);
    assert.doesNotMatch(s, /goStation|setLocation|spendAction|actionPool|tsc-pip/, f);
  }
  assert.ok(!fs.existsSync(new URL("../../scripts/ui/station-markers.mjs", import.meta.url)));
  assert.ok(!fs.existsSync(new URL("../../scripts/crew/token-helm.mjs", import.meta.url)));
  const settings = read("scripts/settings.mjs");
  assert.doesNotMatch(settings, /actionEconomyMode|automaticHelming|applyMultipleAttackPenalty/);
});
