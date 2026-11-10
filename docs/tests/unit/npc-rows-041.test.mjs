// 0.4.1 regression: NPC starship sheet crashed in strikeLine() ("Cannot read properties of undefined (reading 'kind')")
// because the catalogue "engaged-strike" action (builtin npc-strike, no `strike`) was rendered as a Strike.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";
installFoundryMock?.();
const { collectNpcActions, normalizeNpcStrike, bindNpcStrikeTemplate } = await import("../../scripts/actions/npc-rows.mjs");
const { buildNpcAction } = await import("../../scripts/actions/npc-inline.mjs");
const { strikeLine } = await import("../../scripts/utils/labels.mjs");
const { stationsFromContent } = await import("../../scripts/content/ship-docs.mjs");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", p), "utf8"));
const index = read("index.json");
const ships = index.starships.flatMap((f) => read(f).ships);
const actions = read(index.actions).actions;
const byId = new Map(actions.map((a) => [a.id, a]));
const catalog = { actions, get: (id) => byId.get(id) };
const sheetData = (s) => ({ stations: stationsFromContent(s), strikes: s.strikes, npcActions: s.actions, fortify: s.fortify ?? 0 });
const strikeRows = (entries) => entries.filter((e) => e.action?.builtin === "npc-strike");
const GUN = { id: "gunnery-1", type: "gunnery", name: "Gunnery", actions: [] };
const laser = { name: "laser", kind: "ranged", attack: 12, traits: ["range increment 2 zones"], damage: "2d6 fire" };
const ram = { name: "ram", kind: "melee", attack: 10, traits: ["unarmed"], damage: "1d10+4 bludgeoning" };

test("regression: the catalogue Engaged Strike template is never rendered without a Strike", () => {
  assert.equal(byId.get("engaged-strike").builtin, "npc-strike");
  assert.equal(byId.get("engaged-strike").strike, undefined); // the value that was undefined at labels.mjs:42
  const e = collectNpcActions({ stations: [], strikes: [], npcActions: [] }, catalog);
  assert.ok(!e.some((x) => x.id === "engaged-strike"), "not added to ships that do not list it");
});

test("all 74 shipped NPC ships: every Strike row has a valid Strike and strikeLine() works", () => {
  let strikes = 0;
  for (const s of ships) {
    const entries = collectNpcActions(sheetData(s), catalog);
    for (const e of strikeRows(entries)) {
      assert.ok(["melee", "ranged"].includes(e.action.strike.kind), `${s.id}/${e.id}`);
      assert.ok(Number.isFinite(e.action.strike.attack), `${s.id}/${e.id} attack`);
      assert.match(e.action.strike.damage, /\d+d\d+/);
      assert.doesNotThrow(() => strikeLine(e.action.strike));
      strikes++;
    }
    assert.deepEqual(
      entries.filter((e) => !e.action).map((e) => e.id),
      [],
      `${s.id} has no invalid rows`
    );
    // statblock Strikes keep their names and are runnable by id on the GM
    for (const st of s.strikes)
      assert.ok(
        entries.some((e) => e.action?.strike?.name === st.name),
        `${s.id}/${st.name} shown`
      );
  }
  assert.ok(strikes >= 97);
});

test("Engaged Strike is bound to the Strike named by the ship (Hivebound Clustership → cluster maw)", () => {
  const s = ships.find((x) => x.name === "Hivebound Clustership");
  const e = collectNpcActions(sheetData(s), catalog).find((x) => x.id === "engaged-strike");
  assert.ok(e?.action, "engaged strike row exists");
  assert.equal(e.action.strike.name, "cluster maw");
  assert.equal(e.action.strike.kind, "melee");
  assert.equal(e.action.cost, "reaction");
  assert.ok(!collectNpcActions(sheetData(s), catalog).some((x) => x.id === "inline:engaged-strike"), "not duplicated as a manual ability");
  const dragon = ships.find((x) => x.name === "Skyfire Star Dragon");
  assert.equal(collectNpcActions(sheetData(dragon), catalog).find((x) => x.id === "engaged-strike").action.strike.name, "claw");
});

test("Engaged Strike that cannot be bound becomes a warning row, not a crash or a player-weapon attack", () => {
  const data = {
    stations: [],
    strikes: [laser, { ...laser, name: "torpedo" }],
    npcActions: [{ name: "Engaged Strike", cost: "reaction", traits: [], text: "see page 208" }]
  };
  const e = collectNpcActions(data, catalog).find((x) => x.id === "engaged-strike");
  assert.equal(e.action, null);
  assert.equal(e.issues[0].code, "unboundStrike");
  assert.equal(bindNpcStrikeTemplate(byId.get("engaged-strike"), { strikes: [] }).action, null);
});

test("ship with ordinary attacks; attacks not linked to stations use the gunnery station", () => {
  const e = collectNpcActions({ stations: [GUN], strikes: [laser, ram], npcActions: [] }, catalog);
  const rows = strikeRows(e);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["npc-strike:laser", "npc-strike:ram"]
  );
  assert.ok(rows.every((r) => r.station === GUN && r.action.traits.includes("attack")));
  assert.equal(
    strikeLine(rows[1].action.strike).startsWith("SF2eTSC.ui.melee") || /melee|ближ/i.test(strikeLine(rows[1].action.strike)),
    true
  );
});

test("ship without attacks / with only special abilities: abilities are never treated as attacks", () => {
  const data = {
    stations: [{ id: "c-1", type: "custom", name: "Core", actions: ["Hive Pulse"] }],
    strikes: [],
    npcActions: [
      { name: "Hive Pulse", cost: "two-actions", traits: ["mental"], text: "DC 20 Will save" },
      { name: "Living Starship", cost: "passive", traits: [], text: "x" },
      { name: "Shift", cost: "free-action", traits: [], text: "Move" }
    ]
  };
  const e = collectNpcActions(data, catalog);
  assert.equal(strikeRows(e).length, 0);
  const pulse = e.find((x) => x.id === "inline:hive-pulse");
  assert.equal(pulse.station.type, "custom"); // linked to its battle station
  assert.equal(pulse.action.builtin, undefined);
  assert.equal(pulse.action.cost, 2);
  assert.ok(e.some((x) => x.id === "inline:shift" && x.station === null));
  assert.ok(!e.some((x) => x.id === "inline:living-starship"), "passive ability outside stations is description only");
  assert.ok(e.some((x) => x.id === "repair-self") && e.some((x) => x.id === "seek-starships-npc"));
  assert.ok(!e.some((x) => x.id === "fortify-shield-points"), "fortify only with a fortify value");
});

test("custom Strikes with missing or invalid kind", () => {
  assert.equal(normalizeNpcStrike({ ...ram, kind: "Melee " }).strike.kind, "melee");
  const inferred = normalizeNpcStrike({ ...laser, kind: undefined });
  assert.equal(inferred.fatal, false);
  assert.equal(inferred.strike.kind, "ranged");
  assert.equal(inferred.issues[0].code, "kindInferred");
  const bad = normalizeNpcStrike({ ...ram, kind: "psychic" });
  assert.equal(bad.fatal, true);
  assert.equal(bad.issues[0].code, "badKind");
  const data = { stations: [GUN], strikes: [{ ...ram, kind: "psychic" }, { ...laser, kind: null }, laser], npcActions: [] };
  const src = structuredClone(data);
  const e = collectNpcActions(data, catalog);
  const invalid = e.find((x) => x.id === "npc-strike-invalid:0");
  assert.equal(invalid.action, null);
  assert.equal(invalid.name, "ram");
  assert.equal(invalid.issues[0].code, "badKind");
  const inf = e.find((x) => x.id === "npc-strike:laser");
  assert.equal(inf.action.strike.kind, "ranged");
  assert.equal(inf.issues[0].code, "kindInferred");
  assert.deepEqual(data, src, "game data is not modified");
  // GM-side rebuild refuses a Strike that cannot be rolled instead of rolling 1d6 untyped
  assert.equal(buildNpcAction({ strikes: [{ ...ram, kind: "psychic" }] }, "npc-strike:ram"), null);
  assert.equal(buildNpcAction({ strikes: [{ ...ram, attack: "x" }] }, "npc-strike:ram"), null);
  assert.equal(buildNpcAction({ strikes: [{ ...ram, damage: "lots" }] }, "npc-strike:ram"), null);
  assert.equal(buildNpcAction({ strikes: [{ ...ram, attack: "+10" }] }, "npc-strike:ram").strike.attack, 10);
});

test("empty or partially filled ship data does not throw", () => {
  for (const d of [
    {},
    { stations: null, strikes: "x", npcActions: 5 },
    {
      stations: [null, { type: "gunnery", actions: [null, "", { name: "laser" }] }],
      strikes: [null, {}, laser],
      npcActions: [null, { cost: "one-action" }]
    }
  ]) {
    const e = assert.doesNotThrow(() => collectNpcActions(d, catalog)) ?? collectNpcActions(d, catalog);
    for (const x of e) if (x.action?.builtin === "npc-strike") assert.doesNotThrow(() => strikeLine(x.action.strike));
  }
  const e = collectNpcActions(
    {
      stations: [{ id: "g", type: "gunnery", actions: [null, { name: "laser" }] }],
      strikes: [null, laser],
      npcActions: [{ cost: "one-action" }]
    },
    catalog
  );
  assert.ok(e.some((x) => x.issues.some((i) => i.code === "badStationAction")));
  assert.ok(e.some((x) => x.id === "npc-strike-invalid:0" && x.issues[0].code === "notObject"));
  assert.ok(
    e.some((x) => x.id === "npc-strike:laser" && x.station.type === "gunnery"),
    "valid rows still prepared"
  );
  assert.ok(e.some((x) => x.id === "ability-invalid:0"));
});

test("strikeLine reports malformed input with a clear error instead of reading undefined.kind", () => {
  assert.throws(() => strikeLine(undefined), /expected an NPC Strike object/);
  assert.throws(() => strikeLine({ name: "x", attack: 1, damage: "1d6" }), /invalid Strike kind/);
});
