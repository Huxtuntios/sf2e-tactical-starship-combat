import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";

const M = "sf2e-tactical-starship-combat";

async function env() {
  installFoundryMock();
  await loadContentFromDisk();
  (await import("../../scripts/crew/crew-service.mjs")).registerCrewHandlers();
  (await import("../../scripts/starship/ship-service.mjs")).registerShipHandlers();
  const drop = await import("../../scripts/starship/upgrade-drop.mjs");
  const loader = await import("../../scripts/content/loader.mjs");
  const state = await import("../../scripts/starship/starship-state.mjs");
  return { drop, loader, state };
}
const station = (id, type, grade) => ({ id, type, name: id, grade, helmedBy: null });

test("0.10.1 upgrade drop plan: right station type with a free slot, otherwise a reason", async () => {
  const { drop, loader } = await env();
  const entries = loader.upgradeCatalog();
  const gun = entries.find((e) => e.slot === "station" && e.station === "gunnery");
  assert.ok(gun, "the catalogue has a gunnery upgrade");
  const defs = loader.Content.stations;
  const data = {
    level: 5,
    stations: [station("g1", "gunnery", "advanced"), station("g2", "gunnery", "advanced"), station("p1", "pilot", "advanced")],
    upgrades: []
  };
  // first compatible station
  assert.deepEqual(
    [
      drop.planUpgradeDrop(data, gun, { entries, stationDefs: defs }).ok,
      drop.planUpgradeDrop(data, gun, { entries, stationDefs: defs }).stationId
    ],
    [true, "g1"]
  );
  // g1 full (2 slots) -> g2
  const full1 = {
    ...data,
    upgrades: [
      { id: "u1", ref: gun.ref, variant: gun.variant, stationId: "g1" },
      { id: "u2", ref: gun.ref, variant: gun.variant, stationId: "g1" }
    ]
  };
  assert.equal(drop.planUpgradeDrop(full1, gun, { entries, stationDefs: defs }).stationId, "g2");
  // everything full
  const fullAll = {
    ...full1,
    upgrades: [
      ...full1.upgrades,
      { id: "u3", ref: gun.ref, variant: gun.variant, stationId: "g2" },
      { id: "u4", ref: gun.ref, variant: gun.variant, stationId: "g2" }
    ]
  };
  assert.deepEqual(drop.planUpgradeDrop(fullAll, gun, { entries, stationDefs: defs }), {
    ok: false,
    code: "allFull",
    data: { type: "gunnery" }
  });
  // no station of that type at all
  assert.equal(
    drop.planUpgradeDrop({ ...data, stations: [station("p1", "pilot", "advanced")] }, gun, { entries, stationDefs: defs }).code,
    "noStation"
  );
  // unknown upgrade
  assert.equal(drop.planUpgradeDrop(data, null).code, "unknown");
  // a commercial station has no upgrade slots
  assert.equal(
    drop.planUpgradeDrop({ ...data, stations: [station("g1", "gunnery", "commercial")] }, gun, { entries, stationDefs: defs }).code,
    "allFull"
  );
});

test("0.10.1 upgrade drop: installed in the suitable station, or an error goes to the chat and nothing is installed", async () => {
  const { drop, loader, state } = await env();
  const entries = loader.upgradeCatalog();
  const gun = entries.find((e) => e.slot === "station" && e.station === "gunnery");
  const ship = makeShip({
    id: "sun",
    name: "Sunrise",
    role: "player",
    level: 5,
    stations: [station("g1", "gunnery", "advanced"), station("p1", "pilot", "advanced")]
  });
  assert.equal(drop.packUpgradeKey({ flags: { [M]: { upgrade: { key: gun.key } } } }), gun.key);
  assert.equal(drop.packUpgradeKey({ flags: {} }), null);

  assert.equal(await drop.addUpgradeToShip(ship, gun.key), true);
  const installed = state.readStarship(ship).upgrades;
  assert.deepEqual(
    installed.map((u) => [u.ref, u.stationId]),
    [[gun.ref, "g1"]]
  );

  // a ship without a gunnery station: nothing installed, error whispered to the user and the GM
  const bare = makeShip({ id: "bare", name: "Bare", role: "player", level: 5, stations: [station("p1", "pilot", "advanced")] });
  const before = game.messages.size ?? [...game.messages].length;
  assert.equal(await drop.addUpgradeToShip(bare, gun.key), false);
  assert.equal(state.readStarship(bare).upgrades.length, 0);
  const msgs = [...game.messages];
  const last = msgs.at(-1);
  assert.ok(msgs.length > before, "an error message was posted");
  assert.match(last.content, /tsc-drop-error/);
  assert.ok(Array.isArray(last.whisper) && last.whisper.length >= 1, "whispered, not public");
});

test("0.10.1 new ships get their station quality from the advancement table (not always commercial)", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const docs = await import("../../scripts/content/ship-docs.mjs");
  const { Content } = await import("../../scripts/content/loader.mjs");
  const frame = [...Content.frames.values()][0];
  const grades = (lv) =>
    Object.fromEntries(docs.buildPlayerShipData({ name: "T", frame, level: lv }).flags[M].starship.stations.map((s) => [s.type, s.grade]));
  assert.ok(
    Object.values(grades(1)).every((g) => g === "commercial"),
    "level 1 stays commercial"
  );
  const g5 = grades(5);
  assert.equal(g5.gunnery ?? "advanced", "advanced");
  if (g5.pilot) assert.equal(g5.pilot, "advanced");
  const g10 = grades(10);
  if (g10.gunnery) assert.equal(g10.gunnery, "superior");
  if (g10.pilot) assert.equal(g10.pilot, "superior");
  // catalogue NPC ships follow the same table
  const npc = docs.stationsFromContent({ level: 8, stations: [{ type: "pilot" }, { type: "gunnery" }, { type: "custom" }] });
  assert.deepEqual(
    npc.map((s) => s.grade),
    ["superior", "advanced", "commercial"]
  );
});

test("0.10.1 Piloting DC = 10 + the Piloting modifier of the pilot at the console; no pilot, no DC", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { computeShipStats } = await import("../../scripts/starship/stats.mjs");
  const pilot = (await import("../helpers/foundry-mock.mjs")).makeCharacter({ id: "pia", name: "Pia", owners: ["p1"] });
  pilot.skills = { piloting: { mod: 9 } };
  const ship = makeShip({
    id: "sun",
    name: "Sunrise",
    role: "player",
    ac: 14,
    stations: [{ id: "pilot-1", type: "pilot", grade: "commercial", helmedBy: null }],
    crew: [{ actorUuid: pilot.uuid, name: "Pia", role: "crew", stationId: null }]
  });
  assert.equal(computeShipStats(ship).pilotingDC, null, "nobody at the console");
  ship.flags[M].starship.stations[0].helmedBy = pilot.uuid;
  const stats = computeShipStats(ship);
  assert.equal(stats.pilotingDC, 19);
  assert.equal(stats.ac, 19, "AC is never lower than the Piloting DC");
  pilot.skills.piloting.mod = 12;
  assert.equal(computeShipStats(ship).pilotingDC, 22, "follows the pilot's skill");
});

test("0.10.1 overview rolls: saves and Perception are cells of the grid, the Checks list keeps only skills", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const rolls = await import("../../scripts/rolls/ship-rolls.mjs");
  const rows = [
    { slug: "perception", kind: "perception", modText: "+6" },
    { slug: "fortitude", kind: "save", modText: "+8" },
    { slug: "reflex", kind: "save", modText: "+8" },
    { slug: "will", kind: "save", modText: "+8" },
    { slug: "computers", kind: "skill", modText: "+10" }
  ];
  const cells = rolls.statCells(rows);
  assert.deepEqual(
    cells.map((c) => [c.slug, c.rollable]),
    [
      ["perception", true],
      ["fortitude", true],
      ["reflex", true],
      ["will", true]
    ]
  );
  assert.deepEqual(
    rolls.skillCheckRows(rows).map((r) => r.slug),
    ["computers"]
  );
  // a statistic the ship does not have is shown without a roll button; viewers who cannot roll get no buttons either
  assert.equal(rolls.statCells(rows.slice(1), {}).find((c) => c.slug === "perception").rollable, false);
  assert.ok(rolls.statCells(rows, { canRoll: false }).every((c) => !c.rollable));
});

test("0.10.1 a save at the Piloting DC is posted to the chat as a clickable check", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const rolls = await import("../../scripts/rolls/ship-rolls.mjs");
  const pilot = (await import("../helpers/foundry-mock.mjs")).makeCharacter({ id: "pia", name: "Pia" });
  pilot.skills = { piloting: { mod: 9 } };
  const ship = makeShip({
    id: "sun",
    name: "Sunrise",
    role: "player",
    stations: [{ id: "pilot-1", type: "pilot", grade: "commercial", helmedBy: pilot.uuid }],
    crew: [{ actorUuid: pilot.uuid, name: "Pia", role: "crew", stationId: "pilot-1" }]
  });
  await rolls.postPilotingSave(ship, "reflex");
  const msg = [...game.messages].at(-1);
  assert.match(msg.content, /@Check\[reflex\|dc:19\|showDC:all\]/);
  await assert.rejects(() => rolls.postPilotingSave(ship, "ac"));
  ship.flags[M].starship.stations[0].helmedBy = null;
  await assert.rejects(() => rolls.postPilotingSave(ship, "will"), /pilot/i);
  assert.deepEqual(
    rolls.pilotingSaveButtons(ship).map((b) => b.short),
    ["Fort", "Ref", "Will"]
  );
});

import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";

test(
  "0.10.1 every item and action the module ships carries the real starship trait and otherTags",
  { skip: !fs.existsSync("packs-src") },
  () => {
    let items = 0;
    const check = (d, where) => {
      items++;
      assert.ok(d?.system?.traits?.value?.includes("starship"), `${where}: ${d?.name} lacks real starship trait`);
      const tags = d?.system?.traits?.otherTags;
      assert.ok(Array.isArray(tags) && tags.includes("starship"), `${where}: ${d?.name} (${d?.type}) lacks the starship tag`);
    };
    for (const f of fs.readdirSync("packs-src", { recursive: true }).filter((x) => x.endsWith(".json"))) {
      const d = JSON.parse(fs.readFileSync(path.join("packs-src", f), "utf8"));
      if (["action", "weapon", "equipment", "melee"].includes(d?.type)) check(d, f);
      for (const it of d?.items ?? []) check(it, f);
    }
    assert.ok(items > 200, `${items} items checked`);
  }
);

test("0.10.1 overview markup: saves + Perception roll from the grid, Piloting DC shows its three chat-save buttons", () => {
  const hb = Handlebars.create();
  hb.registerHelper("localize", (k) => String(k).split(".").pop());
  hb.registerHelper("eq", (a, b) => a === b);
  hb.registerHelper("numberFormat", (n) => n);
  const render = (ctx) => hb.compile(fs.readFileSync("templates/starship-sheet.hbs", "utf8"))(ctx);
  const base = {
    tab: "overview",
    isNpc: false,
    canRoll: true,
    stats: { ac: 20, pilotingDC: 19 },
    ship: {},
    effects: [],
    log: [],
    sheetAttacks: [],
    pilotingSaves: [
      { slug: "fortitude", short: "СТК", title: "t" },
      { slug: "reflex", short: "РЕФ", title: "t" },
      { slug: "will", short: "ВОЛ", title: "t" }
    ],
    statCells: [
      { slug: "perception", label: "Perception", modText: "+6", rollable: true },
      { slug: "fortitude", label: "Fortitude", modText: "+8", rollable: true },
      { slug: "reflex", label: "Reflex", modText: "+8", rollable: true },
      { slug: "will", label: "Will", modText: "+8", rollable: true }
    ],
    shipChecks: [{ slug: "computers", label: "Computers", modText: "+9" }]
  };
  const html = render(base);
  for (const slug of ["perception", "fortitude", "reflex", "will"])
    assert.match(html, new RegExp(`class="tsc-stat-roll" data-action="rollShipCheck" data-slug="${slug}"`));
  assert.equal((html.match(/data-action="pilotingSave"/g) ?? []).length, 3);
  for (const save of ["fortitude", "reflex", "will"]) assert.ok(html.includes(`data-save="${save}"`));
  // the Checks list holds skills only: no save / perception row is rolled from there
  const checks = html.split('class="tsc-sheet-rolls"')[1].split("</section>")[0];
  assert.match(checks, /data-slug="computers"/);
  assert.doesNotMatch(checks, /data-slug="(perception|fortitude|reflex|will)"/);
  // no pilot at the console: no buttons, a hint instead; NPC ships have no Piloting DC cell at all
  const noPilot = render({ ...base, stats: { ac: 20, pilotingDC: null } });
  assert.doesNotMatch(noPilot, /pilotingSave/);
  assert.match(noPilot, /noPilot/);
  assert.doesNotMatch(render({ ...base, isNpc: true }), /tsc-pdc/);
  // viewers who cannot roll: plain cells
  assert.doesNotMatch(
    render({ ...base, canRoll: false, statCells: base.statCells.map((c) => ({ ...c, rollable: false })), shipChecks: [] }),
    /rollShipCheck|pilotingSave/
  );
});

test("0.10.1 contact chips keep their full name: the name wraps instead of being cut to one letter", () => {
  const css = fs.readFileSync("styles/main.css", "utf8");
  const rule = css.match(/\.tsc-obj-name \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /white-space: normal/);
  assert.doesNotMatch(rule, /text-overflow|nowrap|overflow: hidden/);
  assert.match(fs.readFileSync("templates/sensor-map-zones.hbs", "utf8"), /tsc-obj-name">\{\{label\}\}/);
});

test("0.10.2 several stations can take the upgrade: the player picks one; one candidate installs straight away; closing the dialog installs nothing", async () => {
  const { drop, loader, state } = await env();
  const entries = loader.upgradeCatalog();
  const gun = entries.find((e) => e.slot === "station" && e.station === "gunnery");
  const two = (id) =>
    makeShip({
      id,
      name: id,
      role: "player",
      level: 5,
      stations: [station("g1", "gunnery", "advanced"), station("g2", "gunnery", "advanced"), station("p1", "pilot", "advanced")]
    });
  const where = (ship) => state.readStarship(ship).upgrades.map((u) => u.stationId);

  // plan: every compatible station with a free slot is an option, in station order
  const data = state.readStarship(two("planonly"));
  const plan = drop.planUpgradeDrop(data, gun, { entries, stationDefs: loader.Content.stations });
  assert.deepEqual(
    plan.options.map((o) => [o.id, o.used, o.capacity]),
    [
      ["g1", 0, 2],
      ["g2", 0, 2]
    ]
  );
  assert.equal(plan.stationId, "g1");

  // two options: the chooser is asked and its answer decides
  const a = two("pick-a");
  let asked = null;
  assert.equal(
    await drop.addUpgradeToShip(a, gun.key, {
      choose: async (options, info) => {
        asked = { ids: options.map((o) => o.id), info };
        return "g2";
      }
    }),
    true
  );
  assert.deepEqual(asked.ids, ["g1", "g2"]);
  assert.equal(asked.info.ship, "pick-a");
  assert.deepEqual(where(a), ["g2"]);

  // dialog closed (null): nothing installed, no error message
  const b = two("pick-b");
  const before = [...game.messages].length;
  assert.equal(await drop.addUpgradeToShip(b, gun.key, { choose: async () => null }), false);
  assert.deepEqual(where(b), []);
  assert.equal([...game.messages].length, before, "cancelling is silent");

  // a full station is not an option: only one candidate left -> no dialog
  const c = makeShip({
    id: "pick-c",
    name: "pick-c",
    role: "player",
    level: 5,
    stations: [station("g1", "gunnery", "advanced"), station("g2", "gunnery", "commercial")]
  });
  let called = false;
  assert.equal(
    await drop.addUpgradeToShip(c, gun.key, {
      choose: async () => {
        called = true;
        return "g2";
      }
    }),
    true
  );
  assert.equal(called, false);
  assert.deepEqual(where(c), ["g1"]);
});

test("0.10.2 picker labels: station, quality and used slots", async () => {
  const { drop } = await env();
  const label = drop.stationOptionLabel({
    id: "g2",
    station: { type: "gunnery", name: "Gunnery 2", grade: "advanced" },
    used: 1,
    capacity: 2
  });
  assert.equal(label, "Gunnery 2 (Advanced) — 1/2 slots used");
});

test("0.10.3 the starship tag is added to the module's items that were made before it existed (migration) and at creation", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const wm = await import("../../scripts/content/world-maintenance.mjs");
  const mine = (type, extra = {}) => ({
    id: `i-${Math.random()}`,
    type,
    system: { traits: { otherTags: [] } },
    flags: { [M]: { stationAction: { actionId: "x" } } },
    ...extra
  });
  // ours: own flags / module compendium source / lives on a starship or hazard actor
  assert.deepEqual(wm.itemTagFix(mine("action"))["system.traits.otherTags"], ["starship"]);
  assert.ok(
    wm.itemTagFix({
      id: "a",
      type: "equipment",
      system: { traits: { otherTags: ["x"] } },
      flags: {},
      _stats: { compendiumSource: `Compendium.${M}.starship-upgrades.Item.abc` }
    })
  );
  assert.deepEqual(
    wm.itemTagFix(
      { id: "h", type: "melee", system: { traits: { otherTags: ["keep"] } }, flags: {} },
      { flags: { [M]: { starshipHazard: {} } } }
    )["system.traits.otherTags"],
    ["keep", "starship"]
  );
  // not ours, already tagged, or a type without tags: untouched
  assert.equal(wm.itemTagFix({ id: "p", type: "weapon", system: { traits: { otherTags: [] } }, flags: {} }, { flags: {} }), null);
  assert.equal(wm.itemTagFix(mine("action", { system: { traits: { otherTags: ["starship"], value: ["starship"] } } })), null);
  assert.equal(wm.itemTagFix(mine("effect")), null);

  // the one-time world repair walks world items, character items and unlinked token actors
  const calls = [];
  const actorWith = (items) => ({ flags: {}, items, updateEmbeddedDocuments: async (k, ups) => calls.push(["embedded", ups.length]) });
  globalThis.Item = { updateDocuments: async (ups) => calls.push(["world", ups.length]) };
  globalThis.Actor = { updateDocuments: async () => calls.push(["actors", 0]) };
  game.items = [mine("weapon")];
  game.actors = Object.assign(
    [actorWith([mine("action"), mine("action", { system: { traits: { otherTags: ["starship"], value: ["starship"] } } })])],
    { map: Array.prototype.map }
  );
  game.scenes = [
    {
      tokens: [
        { actorLink: false, actor: actorWith([mine("action")]) },
        { actorLink: true, actor: actorWith([mine("action")]) }
      ],
      updateEmbeddedDocuments: async () => {}
    }
  ];
  game.settings.set(M, "worldFixVersion", 0);
  const n = await wm.repairWorld();
  assert.deepEqual(
    calls.filter((c) => c[0] !== "actors"),
    [
      ["world", 1],
      ["embedded", 1],
      ["embedded", 1]
    ]
  );
  assert.ok(n >= 3);
  assert.equal(await wm.repairWorld(), 0, "runs once");
});

test("0.10.3 class-restricted upgrades say so in their description (EN and RU), others do not", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { upgradeCatalog } = await import("../../scripts/content/loader.mjs");
  const { upgradeMeta } = await import("../../scripts/content/upgrade-docs.mjs");
  const entries = upgradeCatalog();
  const byClass = {};
  for (const e of entries) if (e.classes.length) (byClass[e.ref] ??= new Set()).add(e.classes.join());
  assert.deepEqual(Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, [...v][0]])), {
    "gunnery-turret-mount": "mechanic",
    "mine-deployment-shell": "mechanic",
    "mechanic-generator-module": "mechanic",
    "mystic-magic-module": "mystic",
    "technomancer-magic-module": "technomancer",
    "witchwarper-magic-module": "witchwarper",
    "solar-generator-crystal": "solarian",
    "weapon-crystal": "solarian",
    "solar-thrusters": "solarian",
    "nova-prow": "solarian"
  });
  for (const e of entries) {
    const row = upgradeMeta(e, { classLabel: (c) => `CLASS:${c}` }).find((r) => r.key === "requirements");
    if (e.classes.length) assert.equal(row?.value, `CLASS:${e.classes[0]}`, e.key);
    else assert.equal(row, undefined, `${e.key} has no class row`);
  }
  // the built compendium descriptions carry the localized phrase
  if (fs.existsSync("packs-src")) {
    const docs = (pack) =>
      fs
        .readdirSync(path.join("packs-src", pack), { recursive: true })
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join("packs-src", pack, f), "utf8")));
    const items = docs("starship-upgrades").filter((d) => d.type === "equipment");
    const mystic = items.find(
      (d) => d.flags?.[M]?.upgrade?.ref === "mystic-magic-module" && /Mystic class/.test(d.system.description.value)
    );
    assert.ok(mystic, "English description: Mystic class");
    assert.ok(
      items.some((d) => d.flags?.[M]?.upgrade?.ref === "nova-prow" && /класс соляриан/.test(d.system.description.value)),
      "Russian description: класс соляриан"
    );
    assert.ok(
      !items.some(
        (d) => d.flags?.[M]?.upgrade?.ref === "powerful-thrusters" && /(Mystic|Mechanic|Solarian) class/.test(d.system.description.value)
      )
    );
  }
});

test("0.10.3 Magic Conduit: full station text; the three rank 1 cosmic spells say which slot is spent, the cantrip says it spends none", async () => {
  const station = JSON.parse(fs.readFileSync("data/stations/stations.json", "utf8")).stations.find((s) => s.id === "magic-conduit");
  for (const part of [
    "amplifies spellcasters’ magic",
    "spell repository containing starship spells",
    "If you have the spellcasting feature, you can cast starship spells, expending your own spell slots as needed",
    "allows you to learn spells of the same tradition"
  ])
    assert.ok(station.passive.includes(part), part);
  const acts = Object.fromEntries(
    JSON.parse(fs.readFileSync("data/actions/station-actions.json", "utf8")).actions.map((a) => [a.id, a.text])
  );
  for (const id of ["cosmic-bombardment", "cosmic-fortification", "cosmic-repairs"])
    assert.match(acts[id], /rank 1 spell: the caster expends a spell slot of the rank they choose/, id);
  assert.match(acts["cosmic-cannon"], /cantrip: casting it does not expend a spell slot/);
  assert.doesNotMatch(acts["cosmic-cannon"], /expends a spell slot/);
  const ru = JSON.parse(fs.readFileSync("lang/content/ru.json", "utf8")).strings;
  assert.match(ru[acts["cosmic-repairs"]], /ячейку заклинаний того ранга, который выберет/);
  assert.match(ru[acts["cosmic-cannon"]], /не тратит ячейку заклинаний/);
  assert.match(ru[station.passive], /«Колдовство»[\s\S]*колдовского обычая/);
});

test("0.10.3 diagnostics list module items that still lack the starship tag", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { collectDiagnostics } = await import("../../scripts/ui/diagnostics.mjs");
  const item = (name, tags) => ({
    name,
    id: name,
    type: "action",
    system: { traits: { otherTags: tags, value: tags } },
    flags: { [M]: { stationAction: {} } }
  });
  const fake = {
    version: "14",
    system: { id: "sf2e", version: "1.6.0" },
    modules: new Map(),
    users: [{ active: true, isGM: true }],
    actors: [{ name: "Ava", flags: {}, items: [item("Strike", []), item("Boost", ["starship"])] }],
    items: [item("Loose", [])]
  };
  const row = collectDiagnostics({ game: fake }).find((r) => /tag/i.test(r.label));
  assert.equal(row.level, "warn");
  assert.match(row.label, /2 module item/);
  assert.match(row.detail, /Ava: Strike/);
  assert.match(row.detail, /Loose/);
  fake.actors[0].items = [item("Boost", ["starship"])];
  fake.items = [];
  assert.equal(collectDiagnostics({ game: fake }).find((r) => /tag/i.test(r.label)).level, "ok");
});
